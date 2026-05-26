/**
 * Admin all-uploads review page.
 *
 * Admin-only list of every citizen upload across the platform with status
 * pills (Pending / In Progress / Completed / Failed) and per-upload links to
 * the deep-dive processing review and event map. Reachable via
 * /admin/uploads and the legacy alias /admin/reports.
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { FileText, RefreshCw, Clock, CheckCircle2, AlertCircle, AlertTriangle, ChevronLeft, ChevronRight, ChevronRight as Arrow } from "lucide-react";
import { adminApi } from "../api/client";

const PAGE_SIZE = 5;

function statusLabel(s) {
    if (s === "Done") return "Completed";
    if (s === "Queued") return "Pending";
    if (s === "Processing") return "In Progress";
    if (s === "Failed") return "Failed";
    return s;
}
function statusClass(s) {
    if (s === "Done") return "ar-pill-resolved";
    if (s === "Queued") return "ar-pill-pending";
    if (s === "Processing") return "ar-pill-progress";
    if (s === "Failed") return "ar-pill-critical";
    return "";
}
function severityClass(s) {
    if (s === "High") return "ar-sev-high";
    if (s === "Medium") return "ar-sev-medium";
    if (s === "Low") return "ar-sev-low";
    return "ar-sev-na";
}

function getInitial(name) { return (name || "?").charAt(0).toUpperCase(); }

const AVATAR_COLORS = ["#6366f1", "#f59e0b", "#10b981", "#3b82f6", "#ec4899", "#8b5cf6", "#ef4444"];

export default function AdminUploadsPage() {
    const [uploads, setUploads] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [lastUpdated, setLastUpdated] = useState(null);
    const [statusFilter, setStatusFilter] = useState("");
    const [currentPage, setCurrentPage] = useState(1);

    const fetchUploads = () => {
        setLoading(true); setError("");
        adminApi.listUploads()
            .then((res) => { setUploads(res.data || []); setLastUpdated(new Date()); })
            .catch(() => setError("Failed to load reports."))
            .finally(() => setLoading(false));
    };

    useEffect(() => { fetchUploads(); }, []);
    useEffect(() => { setCurrentPage(1); }, [statusFilter]);

    const filtered = useMemo(() => {
        return uploads.filter((u) => {
            if (statusFilter && u.status !== statusFilter) return false;
            return true;
        });
    }, [uploads, statusFilter]);

    const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    const paginated = useMemo(() => {
        const start = (currentPage - 1) * PAGE_SIZE;
        return filtered.slice(start, start + PAGE_SIZE);
    }, [filtered, currentPage]);

    const stats = useMemo(() => ({
        total: uploads.length,
        pending: uploads.filter(u => u.status === "Queued").length,
        progress: uploads.filter(u => u.status === "Processing").length,
        resolved: uploads.filter(u => u.status === "Done").length,
        critical: uploads.filter(u => u.status === "Failed").length,
    }), [uploads]);

    function getVisiblePages() {
        if (totalPages <= 3) return Array.from({ length: totalPages }, (_, i) => i + 1);
        if (currentPage <= 2) return [1, 2, 3];
        if (currentPage >= totalPages - 1) return [totalPages - 2, totalPages - 1, totalPages];
        return [currentPage - 1, currentPage, currentPage + 1];
    }

    return (
        <div className="ar-page">
            <div className="ar-header">
                <div>
                    <h1 className="ar-title"><FileText size={24} /> Report Processing</h1>
                    <p className="ar-sub">
                        Monitor and review pipeline processing for citizen reports
                        {lastUpdated && <span className="ar-updated"> · Updated {lastUpdated.toLocaleTimeString()}</span>}
                    </p>
                </div>
                <button className="btn btn-outline" onClick={fetchUploads}><RefreshCw size={15} /> Refresh</button>
            </div>

            {error && <p className="error">{error}</p>}

            {/* Stats */}
            <div className="ar-stats">
                <div className="ar-stat ar-stat-total adm-stat-click" onClick={() => setStatusFilter("")}>
                    <div className="ar-stat-top"><span>Total</span><div className="ar-stat-icon-wrap"><FileText size={22} /></div></div>
                    <strong>{stats.total}</strong>
                </div>
                <div className="ar-stat ar-stat-pending adm-stat-click" onClick={() => setStatusFilter("Queued")}>
                    <div className="ar-stat-top"><span>Pending</span><div className="ar-stat-icon-wrap"><Clock size={22} /></div></div>
                    <strong>{stats.pending}</strong>
                </div>
                <div className="ar-stat ar-stat-progress adm-stat-click" onClick={() => setStatusFilter("Processing")}>
                    <div className="ar-stat-top"><span>In Progress</span><div className="ar-stat-icon-wrap"><AlertCircle size={22} /></div></div>
                    <strong>{stats.progress}</strong>
                </div>
                <div className="ar-stat ar-stat-resolved adm-stat-click" onClick={() => setStatusFilter("Done")}>
                    <div className="ar-stat-top"><span>Completed</span><div className="ar-stat-icon-wrap"><CheckCircle2 size={22} /></div></div>
                    <strong>{stats.resolved}</strong>
                </div>
                <div className="ar-stat ar-stat-critical adm-stat-click" onClick={() => setStatusFilter("Failed")}>
                    <div className="ar-stat-top"><span>Failed</span><div className="ar-stat-icon-wrap"><AlertTriangle size={22} /></div></div>
                    <strong>{stats.critical}</strong>
                </div>
            </div>

            {/* Table Card */}
            <div className="ar-table-card">
                {/* Filter — left aligned */}
                <div className="ar-filters">
                    <div className="ar-filter-item">
                        <label>Status</label>
                        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                            <option value="">All</option>
                            <option value="Queued">Pending</option>
                            <option value="Processing">In Progress</option>
                            <option value="Done">Completed</option>
                            <option value="Failed">Failed</option>
                        </select>
                    </div>
                </div>

                {/* Table header */}
                <div className="ar-thead">
                    <span className="ar-col-report">Report</span>
                    <span className="ar-col-status">Processing Status</span>
                    <span className="ar-col-date">Date Reported</span>
                    <span className="ar-col-action"></span>
                </div>

                {/* Rows */}
                {loading ? (
                    <p className="text-muted" style={{ padding: "2rem 1.75rem" }}>Loading reports...</p>
                ) : filtered.length === 0 ? (
                    <p className="text-muted" style={{ padding: "2rem 1.75rem", textAlign: "center" }}>No reports match the current filters.</p>
                ) : paginated.map((u, i) => {
                    const color = AVATAR_COLORS[i % AVATAR_COLORS.length];
                    const created = u.created_at ? new Date(u.created_at) : null;
                    return (
                        <div key={u.upload_id} className="ar-row">
                            <div className="ar-col-report">
                                <div className="ar-avatar" style={{ background: color }}>{getInitial(u.uploader_name)}</div>
                                <div>
                                    <strong className="ar-name">{u.uploader_name || "Unknown"}</strong>
                                    <span className="ar-upload-id">Upload ID: {u.upload_id.slice(0, 7)}</span>
                                    <span className="ar-events">Pipeline events persisted: {u.processing_stats?.events_persisted ?? 0}</span>
                                </div>
                            </div>
                            <div className="ar-col-status">
                                <span className={`ar-status-pill ${statusClass(u.status)}`}>{statusLabel(u.status)}</span>
                            </div>
                            <div className="ar-col-date">
                                <strong>{created ? created.toLocaleDateString() : "—"}</strong>
                                <span>{created ? created.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : ""}</span>
                            </div>
                            <div className="ar-col-action">
                                <Link to={`/admin/uploads/${u.upload_id}/review`} className="ar-view-btn">View Details <Arrow size={14} /></Link>
                            </div>
                        </div>
                    );
                })}

                {/* Footer */}
                <div className="ar-footer">
                    <span className="ar-showing">Showing {((currentPage - 1) * PAGE_SIZE) + 1}–{Math.min(currentPage * PAGE_SIZE, filtered.length)} of {filtered.length} reports</span>
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
            </div>
        </div>
    );
}
