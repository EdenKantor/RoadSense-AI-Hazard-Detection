/**
 * Authenticated interactive map page.
 *
 * Logged-in users' view of the hazard map at /citizen/map (citizens) — the
 * authenticated counterpart to the public SharedHazardMapPage. Renders MapView
 * full-screen with severity + status filter pills, a live stats overlay, a
 * Refresh button, and a "Report Issue" CTA that deep-links to /upload. Fetches
 * events from eventsApi.list scoped to the current viewport bounds (debounced
 * 300ms, in-flight requests aborted on each new fetch). When opened with a
 * ?upload=<id> query param (typically from UploadStatusPage's "View on Map"
 * link), it auto-centers the map on that upload's detection cluster on first
 * load only.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { eventsApi } from "../api/client";
import MapView from "../components/MapView";
import { RefreshCw, AlertTriangle } from "lucide-react";

/**
 * Map the backend lifecycle_status enum to the three UI status labels used by
 * the filter pills and stats ("Pending", "In Progress", "Resolved"). Unknown
 * statuses fall back to "Pending" to keep events visible.
 */
function mapLifecycleToUiStatus(lifecycleStatus) {
    if (lifecycleStatus === "Reported") return "Pending";
    if (lifecycleStatus === "UnderReview" || lifecycleStatus === "Scheduled") return "In Progress";
    if (lifecycleStatus === "Resolved" || lifecycleStatus === "Closed") return "Resolved";
    return "Pending";
}

/** Renders the authenticated full-screen interactive hazard map. */
export default function InteractiveMapPage() {
    const [searchParams] = useSearchParams();
    const focusUploadId = searchParams.get("upload");
    const [initialFocusDone, setInitialFocusDone] = useState(false);
    const [events, setEvents] = useState([]);
    const [bounds, setBounds] = useState(null);
    const [loading, setLoading] = useState(false);
    const [lastUpdated, setLastUpdated] = useState(null);

    const [severityFilters, setSeverityFilters] = useState({
        High: false,
        Medium: false,
        Low: false,
    });
    const [statusFilters, setStatusFilters] = useState({
        Pending: false,
        "In Progress": false,
        Resolved: false,
    });

    const abortControllerRef = useRef(null);
    const debounceTimeoutRef = useRef(null);

    // Abort the previous in-flight request before each new one — pan/zoom
    // emits bounds rapidly and we only want the newest viewport's results.
    const fetchEvents = useCallback(async () => {
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
        }

        abortControllerRef.current = new AbortController();

        setLoading(true);
        try {
            const params = {};
            if (bounds) {
                params.min_lat = bounds.min_lat;
                params.max_lat = bounds.max_lat;
                params.min_lon = bounds.min_lon;
                params.max_lon = bounds.max_lon;
            }
            const res = await eventsApi.list({ ...params, signal: abortControllerRef.current.signal });
            setEvents(res.data || []);
            setLastUpdated(new Date());
        } catch (err) {
            if (err.name !== "AbortError" && err.code !== "ERR_CANCELED") {
                console.error("Failed to load map events", err);
            }
        } finally {
            setLoading(false);
        }
    }, [bounds]);

    // 300ms debounce on bounds-driven fetches — long enough to coalesce a
    // continuous drag, short enough that the map feels live after the user
    // releases. Depends on fetchEvents because that closure captures `bounds`.
    useEffect(() => {
        if (debounceTimeoutRef.current) {
            clearTimeout(debounceTimeoutRef.current);
        }

        debounceTimeoutRef.current = setTimeout(() => {
            fetchEvents();
        }, 300);

        return () => clearTimeout(debounceTimeoutRef.current);
    }, [fetchEvents]);

    const filteredEvents = useMemo(() => {
        return events.filter((event) => {
            const mappedStatus = mapLifecycleToUiStatus(event.lifecycle_status);
            const anySeverityFilter = Object.values(severityFilters).some(Boolean);
            const anyStatusFilter = Object.values(statusFilters).some(Boolean);

            const severityMatch = !anySeverityFilter || Boolean(severityFilters[event.severity]);
            const statusMatch = !anyStatusFilter || Boolean(statusFilters[mappedStatus]);

            return severityMatch && statusMatch;
        });
    }, [events, severityFilters, statusFilters]);

    // Compute initial center from focused upload (only used once on first load)
    const focusCenter = useMemo(() => {
        if (!focusUploadId || initialFocusDone || events.length === 0) return null;
        const uploadEvents = events.filter(e => e.upload_id === focusUploadId);
        if (uploadEvents.length === 0) return null;
        const lats = uploadEvents.map(e => e.location?.coordinates?.[1]).filter(Boolean);
        const lons = uploadEvents.map(e => e.location?.coordinates?.[0]).filter(Boolean);
        if (lats.length === 0) return null;
        return [lats.reduce((a, b) => a + b, 0) / lats.length, lons.reduce((a, b) => a + b, 0) / lons.length];
    }, [focusUploadId, events, initialFocusDone]);

    // Mark focus as done after first render with center
    useEffect(() => {
        if (focusCenter && !initialFocusDone) {
            setInitialFocusDone(true);
        }
    }, [focusCenter, initialFocusDone]);

    const stats = useMemo(() => {
        const next = {
            total: filteredEvents.length,
            pending: 0,
            inProgress: 0,
            resolved: 0,
        };

        filteredEvents.forEach((event) => {
            const mappedStatus = mapLifecycleToUiStatus(event.lifecycle_status);
            if (mappedStatus === "Pending") next.pending += 1;
            else if (mappedStatus === "In Progress") next.inProgress += 1;
            else if (mappedStatus === "Resolved") next.resolved += 1;
        });

        return next;
    }, [filteredEvents]);

    return (
        <div className="fullmap-page">
            {/* ── Header overlay ── */}
            <header className="fullmap-header">
                <div>
                    <h1 className="fullmap-title">Interactive Map</h1>
                    <p className="fullmap-subtitle">
                        View and explore nearby road issues in real-time
                        {lastUpdated && <span className="fullmap-last-update"> · Updated {lastUpdated.toLocaleTimeString()}</span>}
                    </p>
                </div>
                <div className="fullmap-actions">
                    <button className="btn btn-outline" type="button" onClick={fetchEvents}>
                        <RefreshCw size={15} className={loading ? "fullmap-spin" : ""} />
                        Refresh
                    </button>
                    <Link to="/upload" className="btn btn-primary">
                        <AlertTriangle size={15} />
                        Report Issue
                    </Link>
                </div>
            </header>

            {/* ── Map fills entire area ── */}
            <div className="fullmap-container">
                <MapView
                    events={filteredEvents}
                    onBoundsChange={setBounds}
                    center={focusCenter || undefined}
                    zoom={focusCenter ? 14 : 8}
                />

                {/* ── Stats overlay — top right ── */}
                <div className="fullmap-stats">
                    <div className="fullmap-stat">
                        <span className="fullmap-stat-icon" style={{ color: "#3b82f6" }}>
                            <AlertTriangle size={20} />
                        </span>
                        <span className="fullmap-stat-label">Total Issues</span>
                        <strong className="fullmap-stat-num" style={{ color: "#3b82f6" }}>{stats.total}</strong>
                    </div>
                    <div className="fullmap-stat-divider" />
                    <div className="fullmap-stat">
                        <span className="fullmap-stat-dot" style={{ background: "#f59e0b" }} />
                        <span className="fullmap-stat-label">Pending</span>
                        <strong className="fullmap-stat-num" style={{ color: "#f59e0b" }}>{stats.pending}</strong>
                    </div>
                    <div className="fullmap-stat-divider" />
                    <div className="fullmap-stat">
                        <span className="fullmap-stat-dot" style={{ background: "#f97316" }} />
                        <span className="fullmap-stat-label">In Progress</span>
                        <strong className="fullmap-stat-num" style={{ color: "#f97316" }}>{stats.inProgress}</strong>
                    </div>
                    <div className="fullmap-stat-divider" />
                    <div className="fullmap-stat">
                        <span className="fullmap-stat-dot" style={{ background: "#10b981" }} />
                        <span className="fullmap-stat-label">Resolved</span>
                        <strong className="fullmap-stat-num" style={{ color: "#10b981" }}>{stats.resolved}</strong>
                    </div>
                </div>

                {/* ── Bottom filter bar ── */}
                <div className="fullmap-bottom-bar">
                    <div className="fullmap-filter-group">
                        <span className="fullmap-filter-label">Status</span>
                        {Object.entries({ Pending: "#f59e0b", "In Progress": "#f97316", Resolved: "#10b981" }).map(([status, color]) => (
                            <label key={status} className="fullmap-filter-pill">
                                <input
                                    type="checkbox"
                                    checked={statusFilters[status]}
                                    onChange={(e) =>
                                        setStatusFilters((prev) => ({
                                            ...prev,
                                            [status]: e.target.checked,
                                        }))
                                    }
                                />
                                <span className="fullmap-filter-dot" style={{ background: color }} />
                                {status}
                            </label>
                        ))}
                    </div>

                    <div className="fullmap-filter-group">
                        <span className="fullmap-filter-label">Severity</span>
                        {Object.keys(severityFilters).map((severity) => (
                            <label key={severity} className="fullmap-filter-pill">
                                <input
                                    type="checkbox"
                                    checked={severityFilters[severity]}
                                    onChange={(e) =>
                                        setSeverityFilters((prev) => ({
                                            ...prev,
                                            [severity]: e.target.checked,
                                        }))
                                    }
                                />
                                {severity}
                            </label>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}
