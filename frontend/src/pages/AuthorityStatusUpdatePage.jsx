/**
 * Authority event detail + status update page.
 *
 * Authority/Admin per-event page that loads a single pothole event by the
 * `:eventId` URL param and shows: the detection thumbnail, report info
 * (severity, location with reverse-geocoded address, detection count,
 * average confidence, timestamps, uploader), a status-update form that
 * advances the lifecycle Reported -> UnderReview -> Scheduled -> Resolved
 * with an optional note, a real-time-style comments chat tied to the
 * upload, and the full status-history audit log. Status changes POST to
 * authorityApi.updateStatus; existing history rows can be edited or
 * deleted (the backend authorizes — typically reserved for team leaders).
 * Comments support add/edit/delete via uploadsApi.
 */

import { useState, useEffect, useRef } from "react";
import { useParams, Link } from "react-router-dom";
import { FileText, ArrowLeft, MapPin, Eye, BarChart3, Calendar, User, MessageSquare, Send, Pencil, Trash2, Check, X } from "lucide-react";
import { authorityApi, uploadsApi } from "../api/client";
import AddressLabel from "../components/AddressLabel";

const STATUSES = ["Reported", "UnderReview", "Scheduled", "Resolved"];
const STATUS_LABELS = { Reported: "Reported", UnderReview: "Under Review", Scheduled: "Scheduled", Resolved: "Resolved" };
const STATUS_COLORS = { Reported: "#f59e0b", UnderReview: "#f97316", Scheduled: "#f97316", Resolved: "#10b981" };
const SEVERITY_COLORS = { High: "#ef4444", Medium: "#f59e0b", Low: "#22c55e" };

/** Build a static URL for the event's detection thumbnail, or null if unavailable. */
function thumbnailUrl(event) {
    const path = event?.frame_thumbnail_path;
    if (!path || !event?.upload_id) return null;
    const cleaned = path.replace(/\\/g, "/");
    const fileName = cleaned.split("/").filter(Boolean).pop();
    return `http://127.0.0.1:8000/static/output/${event.upload_id}/${fileName}`;
}

/** Authority event detail page with status workflow, comments, and history audit log. */
export default function AuthorityStatusUpdatePage() {
    const { eventId } = useParams();
    const [eventData, setEventData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [newStatus, setNewStatus] = useState("");
    const [note, setNote] = useState("");
    const [saving, setSaving] = useState(false);
    const [success, setSuccess] = useState("");
    const [editingHistory, setEditingHistory] = useState(null);
    const [editNote, setEditNote] = useState("");
    // Auto-clear the status-update success banner after 4 seconds. Mirrors the
    // flashSavedIndicator pattern on the profile pages so the success message
    // doesn't linger forever.
    const successTimerRef = useRef(null);

    // Comments
    const [comments, setComments] = useState([]);
    const [commentText, setCommentText] = useState("");
    const [commentLoading, setCommentLoading] = useState(false);
    const [editingCommentId, setEditingCommentId] = useState(null);
    const [editCommentText, setEditCommentText] = useState("");

    useEffect(() => {
        authorityApi.eventDetail(eventId)
            .then((res) => { setEventData(res.data); setNewStatus(res.data.lifecycle_status); })
            .catch(() => setError("Failed to load event details."))
            .finally(() => setLoading(false));
    }, [eventId]);

    // Load comments when we have the upload_id
    useEffect(() => {
        if (!eventData?.upload_id) return;
        uploadsApi.getComments(eventData.upload_id)
            .then((res) => setComments(res.data || []))
            .catch(() => {});
    }, [eventData?.upload_id]);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setSaving(true); setError(""); setSuccess("");
        try {
            await authorityApi.updateStatus(eventId, { new_status: newStatus, note: note || undefined });
            const refreshed = await authorityApi.eventDetail(eventId);
            setEventData(refreshed.data);
            setNote("");
            setSuccess("Status updated successfully.");
            if (successTimerRef.current) clearTimeout(successTimerRef.current);
            successTimerRef.current = setTimeout(() => setSuccess(""), 4000);
        } catch {
            setError("Failed to update status.");
        } finally {
            setSaving(false);
        }
    };

    // Cancel the success-clear timer if the user navigates away before it fires.
    useEffect(() => () => {
        if (successTimerRef.current) clearTimeout(successTimerRef.current);
    }, []);

    const handleEditNote = async (historyId) => {
        try {
            await authorityApi.updateHistoryNote(historyId, editNote);
            const refreshed = await authorityApi.eventDetail(eventId);
            setEventData(refreshed.data); setEditingHistory(null); setEditNote("");
        } catch { setError("Failed to update note."); }
    };

    const handleDeleteHistory = async (historyId) => {
        if (!window.confirm("Delete this status history entry?")) return;
        try {
            await authorityApi.deleteHistoryEntry(historyId);
            const refreshed = await authorityApi.eventDetail(eventId);
            setEventData(refreshed.data);
        } catch { setError("Failed to delete history entry."); }
    };

    const handleAddComment = async () => {
        if (!commentText.trim() || !eventData?.upload_id) return;
        setCommentLoading(true);
        try {
            const res = await uploadsApi.addComment(eventData.upload_id, commentText.trim());
            if (res.data?.comment) setComments(prev => [...prev, res.data.comment]);
            setCommentText("");
        } catch { /* ignore */ }
        finally { setCommentLoading(false); }
    };

    const handleEditComment = async (commentId) => {
        if (!editCommentText.trim() || !eventData?.upload_id) return;
        try {
            await uploadsApi.editComment(eventData.upload_id, commentId, editCommentText.trim());
            setComments(prev => prev.map(c => c.id === commentId ? { ...c, text: editCommentText.trim() } : c));
            setEditingCommentId(null); setEditCommentText("");
        } catch { /* ignore */ }
    };

    const handleDeleteComment = async (commentId) => {
        if (!eventData?.upload_id) return;
        try {
            await uploadsApi.deleteComment(eventData.upload_id, commentId);
            setComments(prev => prev.filter(c => c.id !== commentId));
        } catch { /* ignore */ }
    };

    if (loading) return <div className="auth-report-page"><p className="text-muted" style={{ padding: "2rem" }}>Loading event details...</p></div>;
    if (!eventData) return <div className="auth-report-page"><p className="error" style={{ padding: "2rem" }}>Event not found</p></div>;

    const thumbUrl = thumbnailUrl(eventData);
    const coords = eventData.location?.coordinates;

    return (
        <div className="auth-report-page">
            <Link to="/authority/events" className="auth-rp-back"><ArrowLeft size={16} /> Back to Reports</Link>

            <h1 className="auth-rp-title"><FileText size={22} /> Pothole Report #{eventData.event_id.slice(0, 8)}</h1>

            <div className="auth-rp-badges">
                <span className="auth-rp-badge" style={{ background: STATUS_COLORS[eventData.lifecycle_status] || "#94a3b8", color: "#fff" }}>
                    {STATUS_LABELS[eventData.lifecycle_status] || eventData.lifecycle_status}
                </span>
                <span className="auth-rp-badge" style={{ background: SEVERITY_COLORS[eventData.severity] || "#94a3b8", color: "#fff" }}>
                    {eventData.severity}
                </span>
            </div>

            {/* Image */}
            {thumbUrl && (
                <div className="auth-rp-image-card">
                    <img src={thumbUrl} alt="Detection preview" onError={(e) => { e.currentTarget.parentElement.style.display = "none"; }} />
                </div>
            )}

            {/* Report Info */}
            <div className="auth-rp-card">
                <div className="auth-rp-section-row">
                    <h2 className="auth-rp-section" style={{ margin: 0 }}>Report Info</h2>
                    <Link to={`/map?upload=${eventData.upload_id}`} className="auth-rp-map-btn">
                        <MapPin size={15} /> View in Map
                    </Link>
                </div>
                <div className="auth-rp-info-grid">
                    <div className="auth-rp-info-row">
                        <span className="auth-rp-info-icon" style={{ color: SEVERITY_COLORS[eventData.severity] }}><Eye size={16} /></span>
                        <span className="auth-rp-info-label">Severity</span>
                        <span className="auth-rp-info-value">
                            <span className="auth-rp-sev-pill" style={{ background: SEVERITY_COLORS[eventData.severity], color: "#fff" }}>{eventData.severity}</span>
                        </span>
                    </div>
                    <div className="auth-rp-info-row">
                        <span className="auth-rp-info-icon" style={{ color: "#3b82f6" }}><MapPin size={16} /></span>
                        <span className="auth-rp-info-label">Location</span>
                        <span className="auth-rp-info-value">
                            {coords ? <>{coords[1].toFixed(5)}, {coords[0].toFixed(5)} <AddressLabel lat={coords[1]} lon={coords[0]} /></> : "—"}
                        </span>
                    </div>
                    <div className="auth-rp-info-row">
                        <span className="auth-rp-info-icon" style={{ color: "#8b5cf6" }}><BarChart3 size={16} /></span>
                        <span className="auth-rp-info-label">Detections</span>
                        <span className="auth-rp-info-value">{eventData.detection_count || 0}</span>
                    </div>
                    <div className="auth-rp-info-row">
                        <span className="auth-rp-info-icon" style={{ color: "#6366f1" }}><Eye size={16} /></span>
                        <span className="auth-rp-info-label">Confidence</span>
                        <span className="auth-rp-info-value">{eventData.avg_confidence ? `${(eventData.avg_confidence * 100).toFixed(1)}%` : "—"}</span>
                    </div>
                    <div className="auth-rp-info-row">
                        <span className="auth-rp-info-icon" style={{ color: "#10b981" }}><Calendar size={16} /></span>
                        <span className="auth-rp-info-label">Creation Date</span>
                        <span className="auth-rp-info-value">{eventData.created_at ? new Date(eventData.created_at).toLocaleString() : "—"}</span>
                    </div>
                    <div className="auth-rp-info-row">
                        <span className="auth-rp-info-icon" style={{ color: "#f59e0b" }}><User size={16} /></span>
                        <span className="auth-rp-info-label">Uploaded By</span>
                        <span className="auth-rp-info-value">{eventData.uploader_name || "Unknown"} <span className="text-muted" style={{ fontSize: "0.78rem" }}>({eventData.upload_id?.slice(0, 8)})</span></span>
                    </div>
                </div>
            </div>

            {/* Update Status */}
            <div className="auth-rp-card">
                <h2 className="auth-rp-section">Update Status</h2>
                {error && <p className="error">{error}</p>}
                {success && <p className="auth-rp-success">{success}</p>}
                <form onSubmit={handleSubmit} className="auth-rp-status-form">
                    <div className="auth-rp-form-row">
                        <div className="auth-rp-form-group">
                            <label>Current Status</label>
                            <select value={newStatus} onChange={(e) => setNewStatus(e.target.value)}>
                                {STATUSES.map(s => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
                            </select>
                        </div>
                        <div className="auth-rp-form-group" style={{ flex: 2 }}>
                            <label>Note (optional)</label>
                            <input type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a note..." />
                        </div>
                        <button className="auth-rp-update-btn" type="submit" disabled={saving}>{saving ? "Updating..." : "Update Status"}</button>
                    </div>
                </form>
            </div>

            {/* Comments */}
            <div className="auth-rp-card">
                <h2 className="auth-rp-section"><MessageSquare size={18} /> Comments Chat</h2>
                <div className="auth-rp-comments">
                    {comments.length === 0 && <p className="text-muted" style={{ textAlign: "center", padding: "0.75rem" }}>No comments yet</p>}
                    {comments.map((c) => (
                        <div key={c.id || c.created_at} className="auth-rp-comment">
                            {editingCommentId === c.id ? (
                                <div className="auth-rp-comment-edit">
                                    <input
                                        type="text"
                                        value={editCommentText}
                                        onChange={(e) => setEditCommentText(e.target.value)}
                                        onKeyDown={(e) => e.key === "Enter" && handleEditComment(c.id)}
                                        autoFocus
                                    />
                                    <button className="auth-rp-comment-action" onClick={() => handleEditComment(c.id)} title="Save"><Check size={14} /></button>
                                    <button className="auth-rp-comment-action" onClick={() => setEditingCommentId(null)} title="Cancel"><X size={14} /></button>
                                </div>
                            ) : (
                                <>
                                    <div className="auth-rp-comment-head">
                                        <strong>{c.author}</strong>
                                        <div className="auth-rp-comment-right">
                                            <span>{c.created_at ? new Date(c.created_at).toLocaleString() : ""}</span>
                                            <button className="auth-rp-comment-action" onClick={() => { setEditingCommentId(c.id); setEditCommentText(c.text); }} title="Edit"><Pencil size={12} /></button>
                                            <button className="auth-rp-comment-action auth-rp-comment-del" onClick={() => handleDeleteComment(c.id)} title="Delete"><Trash2 size={12} /></button>
                                        </div>
                                    </div>
                                    <p>{c.text}</p>
                                </>
                            )}
                        </div>
                    ))}
                </div>
                <div className="auth-rp-comment-input">
                    <input
                        type="text"
                        value={commentText}
                        onChange={(e) => setCommentText(e.target.value)}
                        placeholder="Add a comment..."
                        onKeyDown={(e) => e.key === "Enter" && handleAddComment()}
                    />
                    <button onClick={handleAddComment} disabled={commentLoading || !commentText.trim()} className="auth-rp-send-btn">
                        <Send size={15} />
                    </button>
                </div>
            </div>

            {/* Status History */}
            {eventData.status_history && eventData.status_history.length > 0 && (
                <div className="auth-rp-card">
                    <h2 className="auth-rp-section">Status History</h2>
                    <div className="auth-rp-history">
                        {eventData.status_history.map((entry, index) => (
                            <div key={index} className="auth-rp-history-item">
                                <div className="auth-rp-history-badges">
                                    {entry.old_status && <span className="auth-rp-history-pill" style={{ background: "#f1f5f9", color: "#475569" }}>{STATUS_LABELS[entry.old_status] || entry.old_status}</span>}
                                    {entry.old_status && <span style={{ color: "var(--text-muted)" }}>→</span>}
                                    <span className="auth-rp-history-pill" style={{ background: STATUS_COLORS[entry.new_status] || "#94a3b8", color: "#fff" }}>{STATUS_LABELS[entry.new_status] || entry.new_status}</span>
                                </div>
                                <div className="auth-rp-history-meta">
                                    <strong>{entry.changed_by_name || entry.changed_by_role || "System"}</strong>
                                    <span>{entry.changed_at ? new Date(entry.changed_at).toLocaleString() : "—"}</span>
                                </div>
                                {editingHistory === entry.history_id ? (
                                    <div className="auth-rp-history-edit">
                                        <input value={editNote} onChange={(e) => setEditNote(e.target.value)} />
                                        <button className="btn btn-primary btn-sm" onClick={() => handleEditNote(entry.history_id)}>Save</button>
                                        <button className="btn btn-outline btn-sm" onClick={() => setEditingHistory(null)}>Cancel</button>
                                    </div>
                                ) : (
                                    <>
                                        {entry.note && <p className="auth-rp-history-note">{entry.note}</p>}
                                        <div className="auth-rp-history-actions">
                                            <button onClick={() => { setEditingHistory(entry.history_id); setEditNote(entry.note || ""); }}>Edit</button>
                                            <button className="auth-rp-del" onClick={() => handleDeleteHistory(entry.history_id)}>Delete</button>
                                        </div>
                                    </>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
