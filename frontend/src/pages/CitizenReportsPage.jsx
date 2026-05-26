/**
 * Citizen "My Reports" page.
 *
 * Authenticated citizen-facing list of the user's own uploads at
 * /citizen/reports. Loads via uploadsApi.mine, supports a status filter
 * (read from the ?status= query param so dashboard stat-card links land
 * pre-filtered) and a sort selector (newest / most-events), paginates the
 * results, and renders each report as a card with view, comments, and hide
 * actions. The inline comment panel lets users add, edit, and delete their
 * comments via uploadsApi.addComment / editComment / deleteComment, and
 * "Hide" calls uploadsApi.hideReport (only enabled for Done uploads —
 * removes the report from the user's list without affecting the system
 * record). View also calls uploadsApi.markSeen before navigating to clear
 * the unread badge.
 */
import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams, useNavigate } from "react-router-dom";
import { FileText, Eye, MessageSquare, Trash2, ChevronLeft, ChevronRight, Send, Pencil, X, Check } from "lucide-react";
import { uploadsApi } from "../api/client";
import mapBg from "../assets/map-bg.png";

const STATUS_MAP = {
    Queued: "Pending",
    Processing: "In Progress",
    Done: "Resolved",
    Failed: "Failed",
};

const PAGE_SIZE = 4;

/** Map a backend upload status to the CSS suffix used by the status pill. */
function statusClass(status) {
    if (status === "Done") return "resolved";
    if (status === "Processing") return "processing";
    if (status === "Queued") return "pending";
    return "failed";
}

/** Renders the citizen "My Reports" list with filters, comments, and pagination. */
export default function CitizenReportsPage() {
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();
    const [uploads, setUploads] = useState([]);
    const [loading, setLoading] = useState(true);
    const [statusFilter, setStatusFilter] = useState(searchParams.get("status") || "");
    const [sortBy, setSortBy] = useState("newest");
    const [currentPage, setCurrentPage] = useState(1);
    const [commentOpenId, setCommentOpenId] = useState(null);
    const [commentText, setCommentText] = useState("");

    useEffect(() => {
        const fetchData = async () => {
            setLoading(true);
            try {
                const res = await uploadsApi.mine();
                const payload = res?.data ?? [];
                const items = Array.isArray(payload) ? payload : payload.uploads || [];
                setUploads(items);
            } finally {
                setLoading(false);
            }
        };
        fetchData();
    }, []);

    // Reset to page 1 whenever the active filter or sort changes — otherwise
    // the user could land on a now-empty page index after narrowing results.
    useEffect(() => {
        setCurrentPage(1);
    }, [statusFilter, sortBy]);

    const reports = useMemo(() => {
        const filtered = [...uploads]
            .filter((upload) => (statusFilter ? upload.status === statusFilter : true));

        if (sortBy === "most-events") filtered.sort((a, b) => (b.event_count ?? 0) - (a.event_count ?? 0));
        else filtered.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

        return filtered;
    }, [uploads, statusFilter, sortBy]);

    const totalPages = Math.max(1, Math.ceil(reports.length / PAGE_SIZE));

    const paginatedReports = useMemo(() => {
        const start = (currentPage - 1) * PAGE_SIZE;
        return reports.slice(start, start + PAGE_SIZE);
    }, [reports, currentPage]);

    const handleView = async (uploadId) => {
        try {
            await uploadsApi.markSeen(uploadId);
        } catch {
            // Ignore mark-seen failures
        }
        navigate(`/uploads/${uploadId}/status`);
    };

    const handleHide = async (uploadId) => {
        const confirmed = window.confirm(
            "Hide this resolved report from My Reports? This will only remove it from your list \u2014 the report remains in the system."
        );
        if (!confirmed) return;
        try {
            await uploadsApi.hideReport(uploadId);
            setUploads((prev) => prev.filter((u) => {
                const id = u.upload_id || u.id || u._id;
                return id !== uploadId;
            }));
        } catch {
            // Ignore hide failures
        }
    };

    const [editingComment, setEditingComment] = useState(null);
    const [editCommentText, setEditCommentText] = useState("");

    const toggleComments = (uploadId) => {
        setCommentOpenId((prev) => prev === uploadId ? null : uploadId);
        setCommentText("");
        setEditingComment(null);
    };

    const handleAddComment = async (uploadId) => {
        if (!commentText.trim()) return;
        try {
            const res = await uploadsApi.addComment(uploadId, commentText.trim());
            const newComment = res?.data?.comment;
            if (newComment) {
                setUploads((prev) =>
                    prev.map((u) => {
                        const id = u.upload_id || u.id || u._id;
                        if (id === uploadId) return { ...u, comments: [...(u.comments || []), newComment] };
                        return u;
                    })
                );
            }
            setCommentText("");
        } catch (err) {
            console.error("Failed to add comment:", err?.response?.data || err);
        }
    };

    const handleEditComment = async (uploadId, commentId) => {
        if (!editCommentText.trim()) return;
        try {
            await uploadsApi.editComment(uploadId, commentId, editCommentText.trim());
            setUploads((prev) =>
                prev.map((u) => {
                    const id = u.upload_id || u.id || u._id;
                    if (id === uploadId) {
                        return { ...u, comments: (u.comments || []).map((c) => c.id === commentId ? { ...c, text: editCommentText.trim() } : c) };
                    }
                    return u;
                })
            );
            setEditingComment(null);
            setEditCommentText("");
        } catch { /* Ignore */ }
    };

    const handleDeleteComment = async (uploadId, commentId) => {
        try {
            await uploadsApi.deleteComment(uploadId, commentId);
            setUploads((prev) =>
                prev.map((u) => {
                    const id = u.upload_id || u.id || u._id;
                    if (id === uploadId) {
                        return { ...u, comments: (u.comments || []).filter((c) => c.id !== commentId) };
                    }
                    return u;
                })
            );
        } catch { /* Ignore */ }
    };

    /**
     * Compute up to three page numbers to render in the pagination strip,
     * sliding the window so the current page stays roughly centered.
     */
    const getVisiblePages = () => {
        if (totalPages <= 3) {
            return Array.from({ length: totalPages }, (_, i) => i + 1);
        }
        if (currentPage <= 2) return [1, 2, 3];
        if (currentPage >= totalPages - 1) return [totalPages - 2, totalPages - 1, totalPages];
        return [currentPage - 1, currentPage, currentPage + 1];
    };

    /** Render the Prev/Next + numbered page links for the report list. */
    const renderPagination = () => {
        const visiblePages = getVisiblePages();
        return (
            <div className="ref-pagination">
                <button
                    className="ref-page-link"
                    disabled={currentPage === 1}
                    onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                >
                    <ChevronLeft size={16} /> Previous
                </button>
                {visiblePages.map((p) => (
                    <button
                        key={p}
                        className={`ref-page-num ${p === currentPage ? "active" : ""}`}
                        onClick={() => setCurrentPage(p)}
                    >
                        {p}
                    </button>
                ))}
                <button
                    className="ref-page-link"
                    disabled={currentPage === totalPages}
                    onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                >
                    Next <ChevronRight size={16} />
                </button>
            </div>
        );
    };

    return (
        <div className="page">
            <div className="reports-main-card">
                {/* Header */}
                <div className="reports-title-area">
                    <div className="reports-title-left">
                        <h2>
                            <FileText size={24} className="title-icon" /> My Reports Dashboard
                        </h2>
                        <p>Track and manage all your submissions</p>
                    </div>
                    <Link to="/upload" className="btn btn-primary">+ New Report</Link>
                </div>

                {/* Filters */}
                <div className="filters-panel">
                    <div className="filters-header">
                        <h3>Filters</h3>
                    </div>
                    <div className="filter-controls">
                        <div className="select-wrapper">
                            <select
                                value={statusFilter}
                                onChange={(e) => setStatusFilter(e.target.value)}
                            >
                                <option value="">All Status</option>
                                <option value="Queued">Queued</option>
                                <option value="Processing">Processing</option>
                                <option value="Done">Done</option>
                                <option value="Failed">Failed</option>
                            </select>
                            <i className="fa-solid fa-chevron-down select-icon" />
                        </div>
                        <div className="select-wrapper">
                            <select
                                value={sortBy}
                                onChange={(e) => setSortBy(e.target.value)}
                            >
                                <option value="newest">Newest</option>
                                <option value="most-events">Relevance</option>
                            </select>
                            <i className="fa-solid fa-chevron-down select-icon" />
                        </div>
                    </div>
                </div>

                {/* Report List */}
                {loading ? (
                    <div className="reports-list">Loading reports...</div>
                ) : reports.length === 0 ? (
                    <div className="reports-list">No reports match this filter.</div>
                ) : (
                    <>
                        <div className="reports-list">
                            {paginatedReports.map((upload) => {
                                const uploadId = upload.upload_id || upload.id || upload._id;
                                const date = upload.created_at ? new Date(upload.created_at).toLocaleDateString() : "\u2014";
                                const sc = statusClass(upload.status);

                                return (
                                    <div key={uploadId}>
                                        <div className="ref-report-card">
                                            <div className="ref-report-map">
                                                <img src={mapBg} alt="Map" />
                                            </div>
                                            <div className="ref-report-details">
                                                <div className="ref-report-id">Report ID #{uploadId?.slice(0, 8)}</div>
                                                <div className="ref-report-title">{upload.original_video_filename || "Road report"}</div>
                                                <div className="ref-report-meta">
                                                    <span className="ref-report-date">{date}</span>
                                                    <span className={`ref-report-status ref-status-${sc}`}>{STATUS_MAP[upload.status] || upload.status}</span>
                                                </div>
                                            </div>
                                            <div className="ref-report-right">
                                                <div className="ref-events-count">
                                                    <strong>{upload.event_count ?? 0}</strong>
                                                    <span>events</span>
                                                </div>
                                                <div className="ref-report-actions">
                                                    <button className="ref-action-btn" onClick={() => handleView(uploadId)} title="View"><Eye size={15} /></button>
                                                    <button className="ref-action-btn" onClick={() => toggleComments(uploadId)} title="Comments">
                                                        <MessageSquare size={15} />
                                                        {(upload.comments || []).length > 0 && (
                                                            <span className="ref-comment-count">{(upload.comments || []).length}</span>
                                                        )}
                                                    </button>
                                                    <button className={`ref-action-btn action-trash`} onClick={() => handleHide(uploadId)} disabled={upload.status !== "Done"} title="Hide"><Trash2 size={15} /></button>
                                                </div>
                                            </div>
                                        </div>

                                        {/* Inline Comments Panel */}
                                        {commentOpenId === uploadId && (
                                            <div className="ref-comments-panel">
                                                {(upload.comments || []).length > 0 && (
                                                    <div className="ref-comments-list">
                                                        {(upload.comments || []).map((c) => (
                                                            <div key={c.id || c.created_at} className="ref-comment-item">
                                                                {editingComment === c.id ? (
                                                                    <div className="ref-comment-edit-row">
                                                                        <input
                                                                            type="text"
                                                                            value={editCommentText}
                                                                            onChange={(e) => setEditCommentText(e.target.value)}
                                                                            onKeyDown={(e) => e.key === "Enter" && handleEditComment(uploadId, c.id)}
                                                                            autoFocus
                                                                        />
                                                                        <button className="ref-comment-action" onClick={() => handleEditComment(uploadId, c.id)} title="Save"><Check size={14} /></button>
                                                                        <button className="ref-comment-action" onClick={() => setEditingComment(null)} title="Cancel"><X size={14} /></button>
                                                                    </div>
                                                                ) : (
                                                                    <>
                                                                        <div className="ref-comment-header">
                                                                            <strong>{c.author}</strong>
                                                                            <div className="ref-comment-header-right">
                                                                                <span>{c.created_at ? new Date(c.created_at).toLocaleString() : ""}</span>
                                                                                <button className="ref-comment-action" onClick={() => { setEditingComment(c.id); setEditCommentText(c.text); }} title="Edit"><Pencil size={12} /></button>
                                                                                <button className="ref-comment-action ref-comment-delete" onClick={() => handleDeleteComment(uploadId, c.id)} title="Delete"><Trash2 size={12} /></button>
                                                                            </div>
                                                                        </div>
                                                                        <p>{c.text}</p>
                                                                    </>
                                                                )}
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}
                                                <div className="ref-comment-input">
                                                    <input
                                                        type="text"
                                                        value={commentText}
                                                        onChange={(e) => setCommentText(e.target.value)}
                                                        placeholder="Add a comment..."
                                                        onKeyDown={(e) => e.key === "Enter" && handleAddComment(uploadId)}
                                                    />
                                                    <button className="btn btn-primary" onClick={() => handleAddComment(uploadId)} disabled={!commentText.trim()}>
                                                        <Send size={14} />
                                                    </button>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>

                        {/* Pagination */}
                        {totalPages > 1 && renderPagination()}
                    </>
                )}
            </div>
        </div>
    );
}
