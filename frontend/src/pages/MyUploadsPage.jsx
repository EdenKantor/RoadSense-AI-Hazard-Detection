/**
 * Citizen dashboard / "My Uploads" landing page.
 *
 * Authenticated citizens (route /uploads/mine) see a personalized welcome
 * banner, three action cards (Report New Pothole, Explore Map,
 * Notifications), four stat cards (Total / Pending / In Progress / Resolved
 * — each linking to /citizen/reports filtered by the corresponding status),
 * and a paginated "Recent Reports" table backed by uploadsApi.mine. The
 * "Avg Response" widget shows the average end-to-end pipeline time computed
 * from created_at → updated_at across the user's Done uploads. Clicking a
 * row navigates to /uploads/:uploadId/status.
 */
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { uploadsApi } from "../api/client";
import { Award, ArrowUpRight, FileText, ChevronLeft, ChevronRight, MessageSquare } from "lucide-react";
import mapPreview from "../assets/map-preview.png";

const PAGE_SIZE = 4;
const STATUS_MAP = { Queued: "Pending", Processing: "In Progress", Done: "Done", Failed: "Failed" };

/** Map a backend upload status to the CSS class used by the status pill. */
function statusClass(status) {
    if (status === "Done") return "dash-status-done";
    if (status === "Processing") return "dash-status-progress";
    if (status === "Queued") return "dash-status-pending";
    return "dash-status-failed";
}

/** Renders the citizen dashboard with stats, action cards, and recent uploads. */
export default function MyUploadsPage() {
    const { user } = useAuth();
    const navigate = useNavigate();
    const [uploads, setUploads] = useState([]);
    const [loading, setLoading] = useState(true);
    const [currentPage, setCurrentPage] = useState(1);

    useEffect(() => {
        const fetchUploads = async () => {
            setLoading(true);
            try {
                const res = await uploadsApi.mine();
                const payload = res?.data ?? [];
                const arr = Array.isArray(payload) ? payload : payload.uploads || [];
                setUploads(arr);
            } finally {
                setLoading(false);
            }
        };
        fetchUploads();
    }, []);

    const stats = useMemo(() => {
        return {
            total: uploads.length,
            pending: uploads.filter((u) => u.status === "Queued").length,
            inProgress: uploads.filter((u) => u.status === "Processing").length,
            resolved: uploads.filter((u) => u.status === "Done").length,
        };
    }, [uploads]);

    const avgResponse = useMemo(() => {
        const done = uploads.filter((u) => u.status === "Done" && u.created_at && u.updated_at);
        if (done.length === 0) return null;
        const totalMs = done.reduce((sum, u) => {
            return sum + (new Date(u.updated_at) - new Date(u.created_at));
        }, 0);
        const avgMs = totalMs / done.length;
        const avgSec = Math.round(avgMs / 1000);
        if (avgSec < 60) return `${avgSec}s`;
        if (avgSec < 3600) return `${Math.round(avgSec / 60)}m`;
        if (avgSec < 86400) return `${Math.round(avgSec / 3600)}h`;
        return `${Math.round(avgSec / 86400)}d`;
    }, [uploads]);

    const sortedUploads = useMemo(() => {
        return [...uploads].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    }, [uploads]);

    const totalPages = Math.ceil(sortedUploads.length / PAGE_SIZE);
    const paginatedUploads = useMemo(() => {
        const start = (currentPage - 1) * PAGE_SIZE;
        return sortedUploads.slice(start, start + PAGE_SIZE);
    }, [sortedUploads, currentPage]);

    const today = new Date().toLocaleDateString("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
    });

    /**
     * Compute up to three page numbers to render in the pagination strip,
     * sliding the window so the current page stays roughly centered.
     */
    function getVisiblePages() {
        if (totalPages <= 3) return Array.from({ length: totalPages }, (_, i) => i + 1);
        if (currentPage <= 2) return [1, 2, 3];
        if (currentPage >= totalPages - 1) return [totalPages - 2, totalPages - 1, totalPages];
        return [currentPage - 1, currentPage, currentPage + 1];
    }

    /** Render the Prev/Next + numbered page links. Hidden when there's one page. */
    function renderPagination() {
        if (totalPages <= 1) return null;
        const pages = getVisiblePages();
        return (
            <div className="ref-pagination">
                <button className="ref-page-link" disabled={currentPage === 1} onClick={() => setCurrentPage((p) => p - 1)}>
                    <ChevronLeft size={16} /> Prev
                </button>
                {pages.map((p) => (
                    <button key={p} className={`ref-page-num${p === currentPage ? " active" : ""}`} onClick={() => setCurrentPage(p)}>
                        {p}
                    </button>
                ))}
                <button className="ref-page-link" disabled={currentPage === totalPages} onClick={() => setCurrentPage((p) => p + 1)}>
                    Next <ChevronRight size={16} />
                </button>
            </div>
        );
    }

    return (
        <div className="dashboard-page">
            {/* ── Welcome Banner ── */}
            <div className="dash-welcome">
                <div>
                    <h1 className="dash-welcome-title">Welcome back, {user?.full_name || "Citizen"}!</h1>
                    <p className="dash-welcome-date">{today}</p>
                    <p className="dash-welcome-contrib">
                        <Award size={16} />
                        You've contributed to {stats.total} pothole report{stats.total !== 1 ? "s" : ""}!
                    </p>
                </div>
                <div className="dash-welcome-avg">
                    <div className="dash-welcome-avg-text">
                        <span className="dash-welcome-avg-label">Avg Response</span>
                        <span className="dash-welcome-avg-value">{avgResponse || "-"}</span>
                    </div>
                    <svg className="dash-sparkline" viewBox="0 0 100 40" fill="none">
                        <defs>
                            <linearGradient id="sparkGrad" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor="currentColor" stopOpacity="0.3" />
                                <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
                            </linearGradient>
                        </defs>
                        <path d="M0 32 L5 28 L15 30 L25 18 L35 22 L45 12 L55 16 L65 8 L75 14 L85 6 L95 10 L100 8" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                        <path d="M0 32 L5 28 L15 30 L25 18 L35 22 L45 12 L55 16 L65 8 L75 14 L85 6 L95 10 L100 8 L100 40 L0 40 Z" fill="url(#sparkGrad)" />
                    </svg>
                </div>
            </div>

            {/* ── Action Cards Row ── */}
            <div className="dash-card-row">
                <Link to="/upload" className="dash-action-card dash-card-report">
                    <div className="dash-card-icon-wrap dash-icon-blue">
                        <FileText size={24} />
                    </div>
                    <h3>Report New Pothole</h3>
                    <p>Submit a new pothole report</p>
                </Link>
                <Link to="/citizen/map" className="dash-action-card dash-card-map">
                    <img src={mapPreview} alt="Map preview" className="dash-card-map-img" />
                    <div className="dash-card-map-overlay">
                        <span className="dash-card-map-title">Explore Map</span>
                        <span className="dash-card-map-badge">View Nearby Issues</span>
                    </div>
                </Link>
                <Link to="/citizen/notifications" className="dash-action-card dash-card-notif">
                    <div className="dash-card-icon-wrap dash-icon-amber">
                        <i className="fa-regular fa-bell" style={{ fontSize: 24 }} />
                    </div>
                    <h3>Notifications</h3>
                    <p>Check status updates</p>
                </Link>
            </div>

            {/* ── Stats Cards ── */}
            <div className="dash-stats-row">
                <Link to="/citizen/reports" className="dash-stat-card dash-stat-total">
                    <div className="dash-stat-head">
                        <span>Total Reports</span>
                        <ArrowUpRight size={16} />
                    </div>
                    <strong>{stats.total}</strong>
                </Link>
                <Link to="/citizen/reports?status=Queued" className="dash-stat-card dash-stat-pending">
                    <div className="dash-stat-head">
                        <span>Pending</span>
                        <ArrowUpRight size={16} />
                    </div>
                    <strong>{stats.pending}</strong>
                </Link>
                <Link to="/citizen/reports?status=Processing" className="dash-stat-card dash-stat-progress">
                    <div className="dash-stat-head">
                        <span>In Progress</span>
                        <ArrowUpRight size={16} />
                    </div>
                    <strong>{stats.inProgress}</strong>
                </Link>
                <Link to="/citizen/reports?status=Done" className="dash-stat-card dash-stat-resolved">
                    <div className="dash-stat-head">
                        <span>Resolved</span>
                        <ArrowUpRight size={16} />
                    </div>
                    <strong>{stats.resolved}</strong>
                </Link>
            </div>

            {/* ── Recent Reports Table ── */}
            <div className="dash-table-card">
                <h2 className="dash-table-title">
                    <FileText size={20} />
                    Recent Reports
                </h2>

                {loading ? (
                    <p className="text-muted" style={{ padding: "1.5rem" }}>Loading your reports...</p>
                ) : sortedUploads.length === 0 ? (
                    <div className="text-center" style={{ padding: "2rem 0" }}>
                        <p className="text-muted" style={{ marginBottom: "0.75rem" }}>No reports yet.</p>
                        <Link to="/upload" className="btn btn-primary">Report your first pothole</Link>
                    </div>
                ) : (
                    <>
                        <div className="dash-table-wrap">
                            <table className="dash-table">
                                <thead>
                                    <tr>
                                        <th>ID</th>
                                        <th>Created</th>
                                        <th>Comments</th>
                                        <th>Severity</th>
                                        <th>Updated</th>
                                        <th>Status</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {paginatedUploads.map((upload) => {
                                        const uploadId = upload.upload_id || upload._id || upload.id;
                                        const created = upload.created_at ? new Date(upload.created_at) : null;
                                        const updated = upload.updated_at ? new Date(upload.updated_at) : null;
                                        const commentCount = (upload.comments || []).length;

                                        return (
                                            <tr key={uploadId} className="dash-table-row" onClick={() => navigate(`/uploads/${uploadId}/status`)}>
                                                <td className="dash-td-id">{uploadId?.slice(0, 8)}</td>
                                                <td>{created ? `${created.toLocaleDateString()} ${created.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "—"}</td>
                                                <td>
                                                    {commentCount > 0 ? (
                                                        <span className="dash-comment-badge">
                                                            <MessageSquare size={13} />
                                                            {commentCount}
                                                        </span>
                                                    ) : (
                                                        <span className="text-muted">0</span>
                                                    )}
                                                </td>
                                                <td>
                                                    <span className="dash-severity">Medium</span>
                                                </td>
                                                <td>{updated ? `${updated.toLocaleDateString()} ${updated.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "—"}</td>
                                                <td>
                                                    <span className={`dash-status-pill ${statusClass(upload.status)}`}>
                                                        {STATUS_MAP[upload.status] || upload.status}
                                                    </span>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                        {renderPagination()}
                    </>
                )}
            </div>
        </div>
    );
}
