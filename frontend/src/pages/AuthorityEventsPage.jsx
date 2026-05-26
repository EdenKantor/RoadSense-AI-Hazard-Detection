/**
 * Authority events list page ("Assigned Reports").
 *
 * Authority/Admin browseable list of pothole events visible to the signed-in
 * user — backend auto-scopes results to the user's zone (and to assigned-only
 * for non-leader members; team leaders see all events in the zone). Shows
 * five clickable stat tiles (Total / Pending / In Progress / Resolved /
 * High Priority) that act as one-click filters, plus a search-by-id input
 * and dropdowns for status and severity. Reads the initial status filter
 * from the `?status=` query string (so dashboard KPIs can deep-link here).
 * Each row links to AuthorityStatusUpdatePage; this page is view-only and
 * does not mutate data.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { authorityApi } from "../api/client";
import AddressLabel from "../components/AddressLabel";
import { ClipboardList, AlertTriangle, Clock, CheckCircle2, MapPin, RefreshCw, ChevronLeft, ChevronRight, Eye, ShieldCheck } from "lucide-react";

const PAGE_SIZE = 6;

/** Map event severity to its dot color. */
function severityColor(s) {
    if (s === "High") return "#ef4444";
    if (s === "Medium") return "#f59e0b";
    return "#10b981";
}

/** Filterable, paginated table of authority events with stat-tile shortcuts. */
export default function AuthorityEventsPage() {
    const [events, setEvents] = useState([]);
    const [loading, setLoading] = useState(true);
    const [lastUpdated, setLastUpdated] = useState(null);
    const [error, setError] = useState("");

    const [searchParams] = useSearchParams();
    const [search, setSearch] = useState("");
    const [statusFilter, setStatusFilter] = useState(searchParams.get("status") || "");
    const [severityFilter, setSeverityFilter] = useState("");
    const [currentPage, setCurrentPage] = useState(1);

    const fetchEvents = useCallback(() => {
        setLoading(true); setError("");
        authorityApi.events()
            .then((res) => { setEvents(res.data || []); setLastUpdated(new Date()); })
            .catch(() => setError("Failed to load assigned reports."))
            .finally(() => setLoading(false));
    }, []);

    useEffect(() => { fetchEvents(); }, [fetchEvents]);
    useEffect(() => { setCurrentPage(1); }, [search, statusFilter, severityFilter]);

    const filtered = useMemo(() => {
        return events.filter((e) => {
            if (statusFilter && e.lifecycle_status !== statusFilter) return false;
            if (severityFilter && e.severity !== severityFilter) return false;
            if (search) {
                const q = search.toLowerCase();
                if (!(e.event_id || "").toLowerCase().includes(q)) return false;
            }
            return true;
        });
    }, [events, search, statusFilter, severityFilter]);

    const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    const paginated = useMemo(() => {
        const start = (currentPage - 1) * PAGE_SIZE;
        return filtered.slice(start, start + PAGE_SIZE);
    }, [filtered, currentPage]);

    const stats = useMemo(() => ({
        total: events.length,
        pending: events.filter(e => e.lifecycle_status === "Reported").length,
        inProgress: events.filter(e => ["UnderReview", "Scheduled"].includes(e.lifecycle_status)).length,
        resolved: events.filter(e => ["Resolved", "Closed"].includes(e.lifecycle_status)).length,
        high: events.filter(e => e.severity === "High").length,
    }), [events]);

    function getVisiblePages() {
        if (totalPages <= 3) return Array.from({ length: totalPages }, (_, i) => i + 1);
        if (currentPage <= 2) return [1, 2, 3];
        if (currentPage >= totalPages - 1) return [totalPages - 2, totalPages - 1, totalPages];
        return [currentPage - 1, currentPage, currentPage + 1];
    }

    return (
        <div className="auth-events-page">
            <div className="auth-events-header">
                <div>
                    <h1 className="auth-events-title"><ClipboardList size={24} /> Assigned Reports</h1>
                    <p className="auth-events-sub">
                        Manage and resolve assigned reports
                        {lastUpdated && <span className="auth-events-updated"> · Updated {lastUpdated.toLocaleTimeString()}</span>}
                    </p>
                </div>
                <button className="btn btn-outline" onClick={fetchEvents} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <RefreshCw size={15} /> Refresh
                </button>
            </div>

            {error && <p className="error">{error}</p>}

            {/* Stat Cards — clickable to filter */}
            <div className="auth-events-stats">
                <div className="auth-events-stat auth-estat-clickable" onClick={() => { setStatusFilter(""); setSeverityFilter(""); }}>
                    <div className="auth-estat-icon" style={{ background: "#dbeafe", color: "#2563eb", boxShadow: "0 4px 12px rgba(37,99,235,0.2)" }}><ClipboardList size={22} /></div>
                    <div><span className="auth-estat-label">Total Reports</span><strong className="auth-estat-value">{stats.total}</strong></div>
                </div>
                <div className="auth-events-stat auth-estat-clickable" onClick={() => { setStatusFilter("Reported"); setSeverityFilter(""); }}>
                    <div className="auth-estat-icon" style={{ background: "#fef3c7", color: "#d97706", boxShadow: "0 4px 12px rgba(217,119,6,0.2)" }}><Clock size={22} /></div>
                    <div><span className="auth-estat-label">Pending</span><strong className="auth-estat-value">{stats.pending}</strong></div>
                </div>
                <div className="auth-events-stat auth-estat-clickable" onClick={() => { setStatusFilter("UnderReview"); setSeverityFilter(""); }}>
                    <div className="auth-estat-icon" style={{ background: "#ede9fe", color: "#7c3aed", boxShadow: "0 4px 12px rgba(124,58,237,0.2)" }}><AlertTriangle size={22} /></div>
                    <div><span className="auth-estat-label">In Progress</span><strong className="auth-estat-value">{stats.inProgress}</strong></div>
                </div>
                <div className="auth-events-stat auth-estat-clickable" onClick={() => { setStatusFilter("Resolved"); setSeverityFilter(""); }}>
                    <div className="auth-estat-icon" style={{ background: "#dcfce7", color: "#16a34a", boxShadow: "0 4px 12px rgba(22,163,106,0.2)" }}><CheckCircle2 size={22} /></div>
                    <div><span className="auth-estat-label">Resolved</span><strong className="auth-estat-value">{stats.resolved}</strong></div>
                </div>
                <div className="auth-events-stat auth-estat-clickable" onClick={() => { setSeverityFilter("High"); setStatusFilter(""); }}>
                    <div className="auth-estat-icon" style={{ background: "#fee2e2", color: "#dc2626", boxShadow: "0 4px 12px rgba(220,38,38,0.2)" }}><ShieldCheck size={22} /></div>
                    <div><span className="auth-estat-label">High Priority</span><strong className="auth-estat-value">{stats.high}</strong></div>
                </div>
            </div>

            {/* Filters + Search + Table */}
            <div className="auth-events-table-card">
                <div className="auth-events-filters">
                    <input
                        className="auth-events-search"
                        type="text"
                        placeholder="Search by pothole ID..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                    />
                    <select className="auth-events-select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                        <option value="">All Status</option>
                        <option value="Reported">Reported</option>
                        <option value="UnderReview">Under Review</option>
                        <option value="Scheduled">Scheduled</option>
                        <option value="Resolved">Resolved</option>
                        <option value="Closed">Closed</option>
                    </select>
                    <select className="auth-events-select" value={severityFilter} onChange={(e) => setSeverityFilter(e.target.value)}>
                        <option value="">All Severity</option>
                        <option value="High">High</option>
                        <option value="Medium">Medium</option>
                        <option value="Low">Low</option>
                    </select>
                </div>

                {loading ? (
                    <p className="text-muted" style={{ padding: "2rem 1.75rem" }}>Loading reports...</p>
                ) : filtered.length === 0 ? (
                    <p className="text-muted" style={{ padding: "2rem 1.75rem", textAlign: "center" }}>No reports match the current filters.</p>
                ) : (
                    <>
                        <div className="auth-events-table-wrap">
                            <table className="auth-events-table">
                                <thead>
                                    <tr>
                                        <th>Pothole ID</th>
                                        <th>Status</th>
                                        <th>Severity</th>
                                        <th>Location</th>
                                        <th>Date</th>
                                        <th>Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {paginated.map((e) => (
                                        <tr key={e.event_id}>
                                            <td style={{ fontFamily: "monospace", fontWeight: 600, color: "var(--primary)" }}>{(e.event_id || "").slice(0, 8)}</td>
                                            <td><span className={`auth-events-status auth-es-${(e.lifecycle_status || "").toLowerCase()}`}>{e.lifecycle_status}</span></td>
                                            <td>
                                                <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                                                    <span style={{ width: 8, height: 8, borderRadius: "50%", background: severityColor(e.severity) }} />
                                                    {e.severity}
                                                </span>
                                            </td>
                                            <td className="auth-events-loc">
                                                {e.location?.coordinates ? (
                                                    <AddressLabel lat={e.location.coordinates[1]} lon={e.location.coordinates[0]} />
                                                ) : "—"}
                                            </td>
                                            <td>{e.detected_at ? new Date(e.detected_at).toLocaleDateString() : "—"}</td>
                                            <td>
                                                <Link to={`/authority/events/${e.event_id}/update`} className="auth-events-view-btn">
                                                    View Details
                                                </Link>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>

                        <div className="auth-events-footer">
                            <span className="auth-events-showing">Showing {((currentPage - 1) * PAGE_SIZE) + 1}–{Math.min(currentPage * PAGE_SIZE, filtered.length)} of {filtered.length} reports</span>
                            {totalPages > 1 && (
                                <div className="ref-pagination">
                                    <button className="ref-page-link" disabled={currentPage === 1} onClick={() => setCurrentPage(p => p - 1)}><ChevronLeft size={16} /></button>
                                    {getVisiblePages().map(p => (
                                        <button key={p} className={`ref-page-num${p === currentPage ? " active" : ""}`} onClick={() => setCurrentPage(p)}>{p}</button>
                                    ))}
                                    <button className="ref-page-link" disabled={currentPage === totalPages} onClick={() => setCurrentPage(p => p + 1)}><ChevronRight size={16} /></button>
                                </div>
                            )}
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
