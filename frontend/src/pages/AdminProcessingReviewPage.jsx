/**
 * Admin per-upload processing review page.
 *
 * Admin-only deep-dive into a single upload's pipeline output: annotated
 * frames carousel with lightbox, processing stats (frames sampled / raw
 * detections / clusters / events / duplicates), the events table, and a link
 * to the per-upload event map. Loads everything from GET
 * /api/admin/uploads/{upload_id}/processing-review.
 */
import { useEffect, useMemo, useState, useRef } from "react";
import { Link, useParams } from "react-router-dom";
import { adminApi } from "../api/client";
import { ArrowLeft, FileText, ChevronLeft, ChevronRight, MapPin, Activity, Image, CheckCircle2, X } from "lucide-react";

const EVENTS_PER_PAGE = 5;
const FRAMES_PER_PAGE = 4;

function statusPillClass(s) {
    if (s === "Done" || s === "Resolved") return "ar-pill-resolved";
    if (s === "Failed") return "ar-pill-critical";
    if (s === "Processing" || s === "UnderReview" || s === "Scheduled") return "ar-pill-progress";
    return "ar-pill-pending";
}
function statusLabel(s) {
    if (s === "Done") return "Completed";
    if (s === "Queued" || s === "Reported") return "Pending";
    if (s === "Processing") return "In Progress";
    if (s === "Failed") return "Failed";
    return s;
}
function severityColor(s) {
    if (s === "High") return "#ef4444";
    if (s === "Medium") return "#f59e0b";
    return "#22c55e";
}
function getInitial(name) { return (name || "?").charAt(0).toUpperCase(); }

export default function AdminProcessingReviewPage() {
    const { uploadId } = useParams();
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [framePage, setFramePage] = useState(0);
    const [eventsPage, setEventsPage] = useState(1);
    const [highlightedEvent, setHighlightedEvent] = useState(null);
    const [lightboxIdx, setLightboxIdx] = useState(null);
    const tableRef = useRef(null);

    useEffect(() => {
        setLoading(true); setError("");
        adminApi.processingReview(uploadId)
            .then((res) => setData(res.data))
            .catch((err) => setError(err.response?.data?.detail || "Failed to load."))
            .finally(() => setLoading(false));
    }, [uploadId]);

    const stats = data?.processing_stats || {};
    const events = data?.events || [];
    const previews = data?.preview_urls || [];

    const frameTotalPages = Math.max(1, Math.ceil(previews.length / FRAMES_PER_PAGE));
    const visibleFrames = useMemo(() => {
        const start = framePage * FRAMES_PER_PAGE;
        return previews.slice(start, start + FRAMES_PER_PAGE).map((url, i) => ({ url, globalIdx: start + i }));
    }, [previews, framePage]);

    const eventsTotalPages = Math.max(1, Math.ceil(events.length / EVENTS_PER_PAGE));
    const paginatedEvents = useMemo(() => {
        const start = (eventsPage - 1) * EVENTS_PER_PAGE;
        return events.slice(start, start + EVENTS_PER_PAGE);
    }, [events, eventsPage]);

    function getVisiblePages() {
        if (eventsTotalPages <= 3) return Array.from({ length: eventsTotalPages }, (_, i) => i + 1);
        if (eventsPage <= 2) return [1, 2, 3];
        if (eventsPage >= eventsTotalPages - 1) return [eventsTotalPages - 2, eventsTotalPages - 1, eventsTotalPages];
        return [eventsPage - 1, eventsPage, eventsPage + 1];
    }

    const handleFrameClick = (globalIdx) => {
        if (events[globalIdx]) {
            const eventPage = Math.floor(globalIdx / EVENTS_PER_PAGE) + 1;
            setEventsPage(eventPage);
            setHighlightedEvent(events[globalIdx].event_id);
            setTimeout(() => {
                tableRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
            }, 100);
            setTimeout(() => setHighlightedEvent(null), 3500);
        }
    };

    if (loading) return <div className="rd-page"><p className="text-muted" style={{ padding: "2rem" }}>Loading report details...</p></div>;
    if (error) return <div className="rd-page"><p className="error" style={{ padding: "2rem" }}>{error}</p></div>;
    if (!data) return <div className="rd-page"><p className="error" style={{ padding: "2rem" }}>No data available.</p></div>;

    const created = data.created_at ? new Date(data.created_at) : null;
    const uploaderName = data.uploader_name || "Unknown";

    const statItems = [
        { label: "GPX Points", value: stats.gpx_points },
        { label: "Frames Sampled", value: stats.frames_sampled },
        { label: "Raw Detections", value: stats.raw_detections },
        { label: "Filtered", value: stats.filtered_detections },
        { label: "Aligned", value: stats.aligned_detections },
        { label: "Clusters", value: stats.clusters },
        { label: "Persisted Events", value: stats.events_persisted },
        { label: "Duplicates Suppressed", value: stats.duplicates_suppressed },
    ];

    return (
        <div className="rd-page">
            <Link to="/admin/reports" className="rd-back"><ArrowLeft size={16} /> Back to Reports</Link>

            <h1 className="rd-title"><FileText size={24} /> Report Details</h1>

            {/* ── Report Info Card ── */}
            <div className="rd-card rd-info-card">
                <div className="rd-info-left">
                    <div className="rd-avatar">{getInitial(uploaderName)}</div>
                    <div>
                        <strong className="rd-uploader">{uploaderName}</strong>
                        <span className="rd-uid">Upload ID: {data.upload_id?.slice(0, 7)}</span>
                        <span className="rd-events-hint">Pipeline events persisted: {stats.events_persisted ?? 0}</span>
                    </div>
                </div>
                <div className="rd-info-stat">
                    <span className="rd-info-label">Processing Status</span>
                    <span className={`ar-status-pill ${statusPillClass(data.status)}`}>
                        <CheckCircle2 size={14} style={{ verticalAlign: "middle", marginRight: 3 }} />
                        {statusLabel(data.status)}
                    </span>
                </div>
                <div className="rd-info-stat">
                    <span className="rd-info-label">Detections</span>
                    <strong>{events.length}</strong>
                </div>
                <div className="rd-info-stat">
                    <span className="rd-info-label">Reported</span>
                    <strong>{created ? `${created.toLocaleDateString()} · ${created.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "—"}</strong>
                </div>
            </div>

            {/* ── Annotated Frames Carousel ── */}
            {previews.length > 0 && (
                <div className="rd-card">
                    <h2 className="rd-section-title"><Image size={18} /> Annotated Frames</h2>
                    <div className="rd-carousel">
                        <button className="rd-carousel-btn rd-carousel-left" onClick={() => setFramePage(p => Math.max(0, p - 1))} disabled={framePage === 0}>
                            <ChevronLeft size={24} />
                        </button>
                        <div className="rd-carousel-track">
                            {visibleFrames.map(({ url, globalIdx }) => (
                                <div key={url} className="rd-carousel-item"
                                    title="Click to find in events table">
                                    <img src={url} alt={`Frame ${globalIdx + 1}`} loading="lazy"
                                        onClick={() => setLightboxIdx(globalIdx)}
                                        style={{ cursor: "zoom-in" }} />
                                    <button className="rd-frame-link" onClick={() => handleFrameClick(globalIdx)}>
                                        Event #{globalIdx + 1}
                                    </button>
                                </div>
                            ))}
                        </div>
                        <button className="rd-carousel-btn rd-carousel-right" onClick={() => setFramePage(p => Math.min(frameTotalPages - 1, p + 1))} disabled={framePage >= frameTotalPages - 1}>
                            <ChevronRight size={24} />
                        </button>
                    </div>
                    {frameTotalPages > 1 && (
                        <div className="rd-carousel-paging">
                            {framePage + 1} / {frameTotalPages}
                        </div>
                    )}
                </div>
            )}

            {/* ── Lightbox with navigation ── */}
            {lightboxIdx !== null && previews[lightboxIdx] && (
                <div className="rd-lightbox" onClick={() => setLightboxIdx(null)}>
                    <button className="rd-lightbox-close" onClick={() => setLightboxIdx(null)}><X size={24} /></button>
                    {lightboxIdx > 0 && (
                        <button className="rd-lightbox-nav rd-lightbox-prev" onClick={e => { e.stopPropagation(); setLightboxIdx(i => i - 1); }}>
                            <ChevronLeft size={28} />
                        </button>
                    )}
                    <img src={previews[lightboxIdx]} alt={`Frame ${lightboxIdx + 1}`} onClick={e => e.stopPropagation()} />
                    {lightboxIdx < previews.length - 1 && (
                        <button className="rd-lightbox-nav rd-lightbox-next" onClick={e => { e.stopPropagation(); setLightboxIdx(i => i + 1); }}>
                            <ChevronRight size={28} />
                        </button>
                    )}
                    <div className="rd-lightbox-counter" onClick={e => e.stopPropagation()}>
                        {lightboxIdx + 1} / {previews.length}
                    </div>
                </div>
            )}

            {/* ── Pipeline Statistics ── */}
            <div className="rd-card">
                <h2 className="rd-section-title"><Activity size={18} /> Pipeline Statistics</h2>
                <div className="rd-pipeline-grid">
                    {statItems.map((s) => (
                        <div key={s.label} className="rd-pipeline-item">
                            <span className="rd-pipeline-label">{s.label}</span>
                            <strong className="rd-pipeline-value">{s.value ?? 0}</strong>
                        </div>
                    ))}
                </div>
            </div>

            {/* ── Detected Events Table ── */}
            <div className="rd-card" ref={tableRef}>
                <div className="rd-section-head">
                    <h2 className="rd-section-title"><MapPin size={18} /> Detected Events ({events.length})</h2>
                    <Link to={`/admin/uploads/${uploadId}/map`} className="btn btn-outline" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <MapPin size={15} /> View on Map
                    </Link>
                </div>
                <div className="rd-table-wrap">
                    <table className="pr-table">
                        <thead>
                            <tr>
                                <th>Event</th>
                                <th>Severity</th>
                                <th>Confidence</th>
                                <th>Detections</th>
                                <th>Status</th>
                            </tr>
                        </thead>
                        <tbody>
                            {paginatedEvents.map((ev) => (
                                <tr key={ev.event_id} className={highlightedEvent === ev.event_id ? "rd-row-highlight" : ""}>
                                    <td style={{ fontFamily: "monospace", fontWeight: 600, color: "var(--primary)" }}>{ev.event_id.slice(0, 8)}</td>
                                    <td><span style={{ color: severityColor(ev.severity), fontWeight: 600 }}>{ev.severity}</span></td>
                                    <td>{(ev.avg_confidence * 100).toFixed(1)}%</td>
                                    <td>{ev.detection_count}</td>
                                    <td><span className={`ar-status-pill ${statusPillClass(ev.lifecycle_status)}`}>{statusLabel(ev.lifecycle_status)}</span></td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
                <div className="rd-table-footer">
                    <span className="rd-showing">Showing {((eventsPage - 1) * EVENTS_PER_PAGE) + 1}–{Math.min(eventsPage * EVENTS_PER_PAGE, events.length)} of {events.length} events</span>
                    {eventsTotalPages > 1 && (
                        <div className="ref-pagination">
                            <button className="ref-page-link" disabled={eventsPage === 1} onClick={() => setEventsPage(p => p - 1)}><ChevronLeft size={16} /></button>
                            {getVisiblePages().map(p => (
                                <button key={p} className={`ref-page-num${p === eventsPage ? " active" : ""}`} onClick={() => setEventsPage(p)}>{p}</button>
                            ))}
                            <button className="ref-page-link" disabled={eventsPage === eventsTotalPages} onClick={() => setEventsPage(p => p + 1)}><ChevronRight size={16} /></button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
