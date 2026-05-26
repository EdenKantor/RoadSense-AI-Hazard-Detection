/**
 * Public hazard map page (anonymous-accessible).
 *
 * Public-facing read-only version of the hazard map at /map for anyone
 * (logged-out visitors and the general public). Renders the shared MapView
 * component with verified pothole events fetched via eventsApi.list, plus a
 * sticky navbar/footer, theme toggle, status + severity filter pills, live
 * stats overlay, and a "Report Issue" CTA pointing into /register. The map
 * fetches events for the current viewport bounds and refetches as the user
 * pans/zooms (debounced). Unlike InteractiveMapPage there is no edit
 * affordance — this is purely view-only.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { eventsApi } from "../api/client";
import MapView from "../components/MapView";
import {
    ShieldCheck,
    Zap,
    MapPin,
    AlertTriangle,
    ArrowRight,
    RefreshCw,
} from "lucide-react";
import logoImg from "../assets/logo.png";

const ISRAEL_CENTER = [32.0731, 34.7898];

/**
 * Collapses the backend lifecycle_status enum into the three coarse UI
 * buckets used by the filter pills and stats counters: pending, inProgress,
 * resolved. Unknown statuses fall through to "pending" so they remain visible.
 */
function statusBucket(status) {
    if (status === "Reported" || status === "Pending") return "pending";
    if (status === "UnderReview" || status === "Scheduled" || status === "In Progress") return "inProgress";
    if (status === "Resolved" || status === "Closed") return "resolved";
    return "pending";
}

/** Renders the public map page (read-only) with stats + filter overlays. */
export default function SharedHazardMapPage() {
    const [scrolled, setScrolled] = useState(false);
    const [theme, setTheme] = useState(() => localStorage.getItem("roadsense_theme") || "light");
    const [events, setEvents] = useState([]);
    const [bounds, setBounds] = useState(null);
    const [loading, setLoading] = useState(false);
    const [lastUpdated, setLastUpdated] = useState(null);

    const [statusFilters, setStatusFilters] = useState({ Pending: true, "In Progress": true, Resolved: true });
    const [severityFilters, setSeverityFilters] = useState({ High: true, Medium: true, Low: true });

    const abortControllerRef = useRef(null);
    const debounceRef = useRef(null);

    useEffect(() => {
        document.documentElement.setAttribute("data-theme", theme);
        localStorage.setItem("roadsense_theme", theme);
    }, [theme]);

    useEffect(() => {
        const handler = () => setScrolled(window.scrollY > 20);
        window.addEventListener("scroll", handler);
        return () => window.removeEventListener("scroll", handler);
    }, []);

    // Cancel any in-flight request before issuing a new one — pan/zoom can
    // fire many times in quick succession and we only care about the latest.
    const fetchEvents = useCallback(async (currentBounds) => {
        if (abortControllerRef.current) abortControllerRef.current.abort();
        abortControllerRef.current = new AbortController();
        setLoading(true);
        try {
            const params = {};
            if (currentBounds) {
                params.min_lat = currentBounds.min_lat;
                params.max_lat = currentBounds.max_lat;
                params.min_lon = currentBounds.min_lon;
                params.max_lon = currentBounds.max_lon;
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
    }, []);

    // 250ms debounce: short enough to feel responsive after a pan ends,
    // long enough to coalesce the rapid-fire bounds updates Leaflet emits
    // during a continuous drag.
    useEffect(() => {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => fetchEvents(bounds), 250);
        return () => clearTimeout(debounceRef.current);
    }, [bounds, fetchEvents]);

    const filteredEvents = useMemo(() => {
        return events.filter((e) => {
            const bucket = statusBucket(e.lifecycle_status);
            if (bucket === "pending" && !statusFilters.Pending) return false;
            if (bucket === "inProgress" && !statusFilters["In Progress"]) return false;
            if (bucket === "resolved" && !statusFilters.Resolved) return false;
            if (e.severity && !severityFilters[e.severity]) return false;
            return true;
        });
    }, [events, statusFilters, severityFilters]);

    const stats = useMemo(() => {
        let pending = 0, inProgress = 0, resolved = 0;
        events.forEach((e) => {
            const b = statusBucket(e.lifecycle_status);
            if (b === "pending") pending++;
            else if (b === "inProgress") inProgress++;
            else resolved++;
        });
        return { total: events.length, pending, inProgress, resolved };
    }, [events]);

    return (
        <div className="pm-page">
            {/* ── Navbar ── */}
            <nav className={`lp-nav ${scrolled ? "lp-nav-s" : ""}`}>
                <Link to="/" className="lp-brand">
                    <img src={logoImg} alt="" className="lp-brand-img" />
                    <div>
                        <div className="lp-brand-name">RoadSenseAI</div>
                        <div className="lp-brand-tag">Report. Track. Resolve.</div>
                    </div>
                </Link>
                <div className="lp-nav-mid">
                    <Link to="/" className="lp-link">Home</Link>
                    <Link to="/about" className="lp-link">About</Link>
                    <Link to="/map" className="lp-link lp-link-on">Public Map</Link>
                    <Link to="/help" className="lp-link">Help Center</Link>
                </div>
                <div className="lp-nav-right">
                    <div className="theme-toggle">
                        <div className={`sun-wrapper${theme === "light" ? " active" : ""}`} onClick={() => setTheme("light")} title="Light mode">
                            <i className="fa-solid fa-sun" />
                        </div>
                        <div className={`moon-wrapper${theme === "dark" ? " active" : ""}`} onClick={() => setTheme("dark")} title="Dark mode">
                            <i className="fa-solid fa-moon" />
                        </div>
                    </div>
                    <Link to="/login" className="lp-login">Login</Link>
                    <Link to="/register" className="lp-cta-nav">Sign Up</Link>
                </div>
            </nav>

            {/* ── Hero ── */}
            <section className="pm-hero">
                <h1>Public Road Issues Map</h1>
                <p>View all reported road issues in real-time. Track status, severity, and resolution progress.</p>
                <div className="pm-meta">
                    <span>{loading ? "Updating..." : `${stats.total} issues visible`}</span>
                    <span className="pm-dot" />
                    <span>Updated in real-time</span>
                </div>
            </section>

            {/* ── Map with overlays ── */}
            <section className="pm-map-section">
            <div className="pm-map-full">
                <MapView
                    events={filteredEvents}
                    onBoundsChange={setBounds}
                    center={ISRAEL_CENTER}
                    zoom={8}
                />

                {/* ── Stats overlay — top right ── */}
                <div className="fullmap-stats">
                    <div className="fullmap-stat">
                        <span className="fullmap-stat-icon" style={{ color: "#3b82f6" }}><AlertTriangle size={20} /></span>
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
                                    onChange={(e) => setStatusFilters((prev) => ({ ...prev, [status]: e.target.checked }))}
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
                                    onChange={(e) => setSeverityFilters((prev) => ({ ...prev, [severity]: e.target.checked }))}
                                />
                                {severity}
                            </label>
                        ))}
                    </div>
                </div>
            </div>

            {/* Report CTA */}
            <div className="pm-report-cta">
                <div className="pm-report-left">
                    <AlertTriangle size={20} />
                    <div>
                        <strong>See a pothole?</strong>
                        <p>Help make roads safer by reporting it through our platform.</p>
                    </div>
                </div>
                <Link to="/register" className="lp-cta-hero" style={{ fontSize: "0.85rem", padding: "0.6rem 1.4rem" }}>
                    Report Issue <ArrowRight size={15} />
                </Link>
            </div>
            </section>

            {/* ── Footer ── */}
            <footer className="lp-footer">
                <div className="lp-footer-inner">
                    <div className="lp-footer-brand">
                        <img src={logoImg} alt="" className="lp-footer-logo" />
                        <div>
                            <div className="lp-footer-name">RoadSenseAI</div>
                            <p>Empowering citizens and authorities to collaborate on safer roads.</p>
                        </div>
                    </div>
                    <div className="lp-footer-col">
                        <h4><Zap size={13} /> Product</h4>
                        <Link to="/about">About</Link>
                        <Link to="/map">Public Map</Link>
                    </div>
                    <div className="lp-footer-col">
                        <h4><ShieldCheck size={13} /> Support</h4>
                        <Link to="/help">Help Center</Link>
                    </div>
                </div>
                <div className="lp-footer-bot">&copy; 2026 RoadSenseAI. All rights reserved.</div>
            </footer>
        </div>
    );
}
