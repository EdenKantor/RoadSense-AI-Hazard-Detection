/**
 * Citizen Help Center page.
 *
 * Citizen-only support hub combining a searchable FAQ accordion, a
 * ticket-creation form (routed to either the Authority team-leader of the
 * related report's zone or to Admin Support based on a tab toggle), and a
 * paginated list of the user's existing tickets. Selecting a ticket opens
 * a modal that loads the full conversation via supportApi.get and lets the
 * citizen post additional replies (status changes are reserved for
 * Authority/Admin). Supports deep-linking from notifications via the
 * `?ticket=<id>` query param: the matching row is auto-paged into view,
 * highlighted, and the param is cleared after ~4.5s.
 */

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Search, Shield, Headphones, Send, ChevronLeft, ChevronRight, Eye, ChevronDown, Plus, Minus, RefreshCw, X } from "lucide-react";
import { supportApi, uploadsApi } from "../api/client";

const PAGE_SIZE = 4;

const FAQS = [
    { q: "How do I report a pothole?", a: "Open Report Issue, upload an MP4 video and GPX track, then submit. You can track status in My Reports." },
    { q: "How long does processing take?", a: "Most uploads finish within a few minutes, depending on video length and worker queue load." },
    { q: "Can I track my submissions?", a: "Yes. Open My Reports and select any upload to view live processing status." },
    { q: "What issue type is supported?", a: "This deployment is potholes-only." },
    { q: "What if processing fails?", a: "Open the upload tracker to view the failure status, then re-upload with valid MP4 and GPX files." },
];

const OFFICIAL_SUBJECTS = [
    "Request update on my report",
    "My pothole report was not handled",
    "Wrong report status",
    "Road issue still exists",
    "Duplicate report submitted",
    "Wrong location on map",
    "Severity seems incorrect",
    "Other report-related issue",
];

const ADMIN_SUBJECTS = [
    "Login or account issue",
    "Cannot submit a report",
    "Upload failed",
    "Map is not loading",
    "App bug or unexpected behavior",
    "Notification issue",
    "Profile issue",
    "Performance issue",
    "Other technical issue",
];

/** Map a backend ticket status enum to its user-facing label. */
function statusLabel(s) {
    if (s === "Open") return "Open";
    if (s === "InReview") return "In Review";
    if (s === "WaitingForResponse") return "Waiting for Response";
    if (s === "Resolved") return "Resolved";
    if (s === "Closed") return "Closed";
    return s;
}
/** Map a backend ticket status enum to its CSS pill class. */
function statusClass(s) {
    if (s === "Open") return "hc-pill-open";
    if (s === "InReview") return "hc-pill-review";
    if (s === "WaitingForResponse") return "hc-pill-waiting";
    if (s === "Resolved") return "hc-pill-resolved";
    if (s === "Closed") return "hc-pill-closed";
    return "";
}

/** Render a relative time string for ticket "Last Updated" cells. */
function timeAgo(dateStr) {
    if (!dateStr) return "—";
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "Just now";
    if (mins < 60) return `Today, ${new Date(dateStr).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    return new Date(dateStr).toLocaleDateString();
}

/** Citizen Help Center: FAQ + ticket creation + ticket history with detail modal. */
export default function CitizenHelpCenterPage() {
    const [searchParams, setSearchParams] = useSearchParams();
    const targetTicketParam = searchParams.get("ticket");
    const [highlightedTicket, setHighlightedTicket] = useState(null);
    const [query, setQuery] = useState("");
    const [expanded, setExpanded] = useState(0);

    // Ticket form
    const [target, setTarget] = useState("Official");
    const [subject, setSubject] = useState(OFFICIAL_SUBJECTS[0]);
    const [relatedReport, setRelatedReport] = useState("");
    const [message, setMessage] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [submitError, setSubmitError] = useState("");
    const [reports, setReports] = useState([]);

    // My tickets
    const [tickets, setTickets] = useState([]);
    const [ticketsLoading, setTicketsLoading] = useState(true);
    const [lastUpdated, setLastUpdated] = useState(null);
    const [currentPage, setCurrentPage] = useState(1);
    const [statusFilter, setStatusFilter] = useState("");

    // Ticket detail modal
    const [openTicket, setOpenTicket] = useState(null);
    const [ticketDetail, setTicketDetail] = useState(null);
    const [responseText, setResponseText] = useState("");
    const [actionLoading, setActionLoading] = useState(false);
    const [actionError, setActionError] = useState("");

    const openTicketDetail = async (t) => {
        setOpenTicket(t);
        setActionError("");
        setResponseText("");
        setTicketDetail(null);
        try {
            const res = await supportApi.get(t.ticket_id);
            setTicketDetail(res.data);
        } catch {
            setActionError("Failed to load ticket details.");
        }
    };

    const closeModal = () => {
        setOpenTicket(null);
        setTicketDetail(null);
        setResponseText("");
        setActionError("");
    };

    const refreshTicketDetail = async () => {
        if (!openTicket) return;
        try {
            const res = await supportApi.get(openTicket.ticket_id);
            setTicketDetail(res.data);
        } catch {}
    };

    const handleAddResponse = async (e) => {
        e.preventDefault();
        if (!responseText.trim() || !openTicket) return;
        setActionLoading(true); setActionError("");
        try {
            await supportApi.addResponse(openTicket.ticket_id, responseText.trim());
            setResponseText("");
            await refreshTicketDetail();
            loadTickets();
        } catch (err) {
            setActionError(err.response?.data?.detail || "Failed to send response.");
        } finally { setActionLoading(false); }
    };

    useEffect(() => {
        // Load citizen's reports for the related-report dropdown
        uploadsApi.mine().then((res) => {
            const arr = Array.isArray(res.data) ? res.data : (res.data?.uploads || []);
            setReports(arr);
        }).catch(() => {});
        loadTickets();
    }, []);

    function loadTickets() {
        setTicketsLoading(true);
        supportApi.listMine()
            .then((res) => { setTickets(res.data || []); setLastUpdated(new Date()); })
            .catch(() => {})
            .finally(() => setTicketsLoading(false));
    }

    const filteredFaqs = useMemo(() => {
        if (!query) return FAQS;
        const q = query.toLowerCase();
        return FAQS.filter(f => f.q.toLowerCase().includes(q) || f.a.toLowerCase().includes(q));
    }, [query]);

    const subjectsForTarget = target === "Official" ? OFFICIAL_SUBJECTS : ADMIN_SUBJECTS;

    // Reset subject when target changes
    useEffect(() => {
        setSubject(target === "Official" ? OFFICIAL_SUBJECTS[0] : ADMIN_SUBJECTS[0]);
        if (target === "Admin") setRelatedReport("");
    }, [target]);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setSubmitError("");
        if (!message.trim()) { setSubmitError("Message is required."); return; }
        if (target === "Official" && !relatedReport) {
            setSubmitError("A related report is required to route an Authority ticket to the correct team leader.");
            return;
        }
        setSubmitting(true);
        try {
            await supportApi.create({
                target_team_type: target,
                subject,
                message: message.trim(),
                related_report_id: relatedReport || null,
            });
            setMessage("");
            setRelatedReport("");
            loadTickets();
        } catch (err) {
            setSubmitError(err.response?.data?.detail || "Failed to submit ticket.");
        } finally {
            setSubmitting(false);
        }
    };

    const filteredTickets = useMemo(() => {
        if (!statusFilter) return tickets;
        return tickets.filter(t => t.status === statusFilter);
    }, [tickets, statusFilter]);

    useEffect(() => { setCurrentPage(1); }, [statusFilter]);

    const totalPages = Math.max(1, Math.ceil(filteredTickets.length / PAGE_SIZE));
    const paginatedTickets = useMemo(() => {
        const start = (currentPage - 1) * PAGE_SIZE;
        return filteredTickets.slice(start, start + PAGE_SIZE);
    }, [filteredTickets, currentPage]);

    // When arriving from a notification with ?ticket=ID, clear filter, jump to its page, highlight + scroll
    useEffect(() => {
        if (!targetTicketParam || tickets.length === 0) return;
        const idx = tickets.findIndex(t => t.ticket_id === targetTicketParam);
        if (idx === -1) return;
        if (statusFilter) setStatusFilter("");
        const targetPage = Math.floor(idx / PAGE_SIZE) + 1;
        setCurrentPage(targetPage);
        setHighlightedTicket(targetTicketParam);
        setTimeout(() => {
            document.getElementById(`ticket-row-${targetTicketParam}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
        }, 200);
        const timer = setTimeout(() => {
            setHighlightedTicket(null);
            const next = new URLSearchParams(searchParams);
            next.delete("ticket");
            setSearchParams(next, { replace: true });
        }, 4500);
        return () => clearTimeout(timer);
    }, [targetTicketParam, tickets]); // eslint-disable-line react-hooks/exhaustive-deps

    function getVisiblePages() {
        if (totalPages <= 3) return Array.from({ length: totalPages }, (_, i) => i + 1);
        if (currentPage <= 2) return [1, 2, 3];
        if (currentPage >= totalPages - 1) return [totalPages - 2, totalPages - 1, totalPages];
        return [currentPage - 1, currentPage, currentPage + 1];
    }

    return (
        <div className="hc-page">
            {/* Banner */}
            <div className="hc-banner">
                <h1 className="hc-banner-title">Help Center</h1>
                <p className="hc-banner-sub">Get help, report issues, or contact the right support team</p>
            </div>

            {/* Search */}
            <div className="hc-search-card">
                <Search size={18} className="hc-search-icon" />
                <input
                    className="hc-search-input"
                    placeholder="Search help articles..."
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                />
            </div>

            {/* FAQ */}
            <div className="hc-card">
                <h2 className="hc-section-title">Frequently Asked Questions</h2>
                <div className="hc-faq-list">
                    {filteredFaqs.length === 0 ? (
                        <p className="text-muted" style={{ textAlign: "center", padding: "1rem" }}>No FAQs match your search.</p>
                    ) : filteredFaqs.map((item, idx) => (
                        <div key={item.q} className={`hc-faq-item ${expanded === idx ? "hc-faq-open" : ""}`}>
                            <button
                                type="button"
                                className="hc-faq-header"
                                onClick={() => setExpanded(expanded === idx ? null : idx)}
                            >
                                <div>
                                    <strong>{item.q}</strong>
                                    {expanded === idx && <p className="hc-faq-answer">{item.a}</p>}
                                </div>
                                {expanded === idx ? <Minus size={18} /> : <Plus size={18} />}
                            </button>
                        </div>
                    ))}
                </div>
            </div>

            {/* 2-column: Submit + My Tickets */}
            <div className="hc-cols">
                {/* Left: Submit a Ticket */}
                <div className="hc-card">
                    <h2 className="hc-section-title">Submit a Support Ticket</h2>

                    {/* Target Team tabs */}
                    <div className="hc-tabs">
                        <button
                            type="button"
                            className={`hc-tab ${target === "Official" ? "hc-tab-active" : ""}`}
                            onClick={() => setTarget("Official")}
                        >
                            <Shield size={16} /> Authority
                        </button>
                        <button
                            type="button"
                            className={`hc-tab ${target === "Admin" ? "hc-tab-active" : ""}`}
                            onClick={() => setTarget("Admin")}
                        >
                            <Headphones size={16} /> Admin Support
                        </button>
                    </div>

                    <form onSubmit={handleSubmit} className="hc-form">
                        <div className="hc-form-group">
                            <label>Subject</label>
                            <div className="hc-select-wrap">
                                <select value={subject} onChange={(e) => setSubject(e.target.value)}>
                                    {subjectsForTarget.map(s => <option key={s} value={s}>{s}</option>)}
                                </select>
                                <ChevronDown size={16} className="hc-select-chevron" />
                            </div>
                        </div>

                        {target === "Official" && (
                            <div className="hc-form-group">
                                <label>Related Report</label>
                                <div className="hc-select-wrap">
                                    <select value={relatedReport} onChange={(e) => setRelatedReport(e.target.value)}>
                                        <option value="">— Select a report —</option>
                                        {reports.map(r => {
                                            const id = r.upload_id || r.id || r._id;
                                            return <option key={id} value={id}>{(r.original_video_filename || `Report ${id?.slice(0, 8)}`)}{r.status ? ` · ${r.status}` : ""}</option>;
                                        })}
                                    </select>
                                    <ChevronDown size={16} className="hc-select-chevron" />
                                </div>
                            </div>
                        )}

                        <div className="hc-form-group">
                            <label>Message</label>
                            <textarea
                                placeholder="Describe your issue or question in detail..."
                                value={message}
                                onChange={(e) => setMessage(e.target.value)}
                                rows={5}
                            />
                        </div>

                        {submitError && <p className="error">{submitError}</p>}

                        <button type="submit" className="hc-submit-btn" disabled={submitting}>
                            <Send size={16} /> {submitting ? "Submitting..." : "Submit Ticket"}
                        </button>
                    </form>
                </div>

                {/* Right: My Tickets */}
                <div className="hc-card">
                    <div className="hc-tickets-header">
                        <h2 className="hc-section-title" style={{ margin: 0 }}>My Support Tickets</h2>
                        <div className="hc-tickets-controls">
                            {lastUpdated && <span className="hc-last-updated">Updated {lastUpdated.toLocaleTimeString()}</span>}
                            <div className="hc-select-wrap" style={{ minWidth: 160 }}>
                                <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                                    <option value="">All</option>
                                    <option value="Open">Open</option>
                                    <option value="InReview">In Review</option>
                                    <option value="WaitingForResponse">Waiting for Response</option>
                                    <option value="Resolved">Resolved</option>
                                    <option value="Closed">Closed</option>
                                </select>
                                <ChevronDown size={16} className="hc-select-chevron" />
                            </div>
                            <button type="button" className="hc-refresh-btn" onClick={loadTickets} title="Refresh" disabled={ticketsLoading}>
                                <RefreshCw size={15} className={ticketsLoading ? "hc-spin" : ""} />
                                Refresh
                            </button>
                        </div>
                    </div>

                    {ticketsLoading ? (
                        <p className="text-muted" style={{ padding: "1rem" }}>Loading tickets...</p>
                    ) : filteredTickets.length === 0 ? (
                        <p className="text-muted" style={{ padding: "1rem", textAlign: "center" }}>
                            {statusFilter ? `No tickets with status "${statusLabel(statusFilter)}".` : "No tickets yet. Submit one to get help."}
                        </p>
                    ) : (
                        <>
                            <div className="hc-tickets-table">
                                <div className="hc-tickets-head">
                                    <span>Ticket ID</span>
                                    <span>Subject</span>
                                    <span>Target Team</span>
                                    <span>Status</span>
                                    <span>Last Updated</span>
                                    <span></span>
                                </div>
                                {paginatedTickets.map((t) => (
                                    <div key={t.ticket_id} id={`ticket-row-${t.ticket_id}`} className={`hc-ticket-row${highlightedTicket === t.ticket_id ? " hc-row-highlight" : ""}`}>
                                        <span className="hc-tid">{t.ticket_id.slice(0, 5).toUpperCase()}</span>
                                        <span className="hc-tsubject" title={t.subject}>{t.subject}</span>
                                        <span className="hc-ttarget">{t.target_team_type === "Admin" ? "Admin Support" : "Authority"}</span>
                                        <span><span className={`hc-status-pill ${statusClass(t.status)}`}>{statusLabel(t.status)}</span></span>
                                        <span className="hc-tupdated">{timeAgo(t.updated_at)}</span>
                                        <button className="hc-view-btn" type="button" title="View" onClick={() => openTicketDetail(t)}><Eye size={14} /></button>
                                    </div>
                                ))}
                            </div>

                            {totalPages > 1 && (
                                <div className="hc-tickets-footer">
                                    <span className="hc-showing">Showing {((currentPage - 1) * PAGE_SIZE) + 1}–{Math.min(currentPage * PAGE_SIZE, filteredTickets.length)} of {filteredTickets.length} tickets</span>
                                    <div className="ref-pagination">
                                        <button className="ref-page-link" disabled={currentPage === 1} onClick={() => setCurrentPage(p => p - 1)}><ChevronLeft size={16} /></button>
                                        {getVisiblePages().map(p => (
                                            <button key={p} className={`ref-page-num${p === currentPage ? " active" : ""}`} onClick={() => setCurrentPage(p)}>{p}</button>
                                        ))}
                                        <button className="ref-page-link" disabled={currentPage === totalPages} onClick={() => setCurrentPage(p => p + 1)}><ChevronRight size={16} /></button>
                                    </div>
                                </div>
                            )}
                        </>
                    )}
                </div>
            </div>

            {/* Ticket Detail Modal */}
            {openTicket && (
                <div className="auth-hc-overlay" onClick={closeModal}>
                    <div className="auth-hc-modal" onClick={(e) => e.stopPropagation()}>
                        <div className="auth-hc-modal-head">
                            <div>
                                <h2>{openTicket.subject}</h2>
                                <p>Ticket {openTicket.ticket_id.slice(0, 5).toUpperCase()} · {openTicket.target_team_type === "Admin" ? "Admin Support" : "Authority"}</p>
                            </div>
                            <button className="auth-hc-close" onClick={closeModal}><X size={20} /></button>
                        </div>

                        {ticketDetail ? (
                            <div className="auth-hc-modal-body">
                                <div className="auth-hc-meta">
                                    <div><span>Status</span><strong><span className={`hc-status-pill ${statusClass(ticketDetail.status)}`}>{statusLabel(ticketDetail.status)}</span></strong></div>
                                    <div><span>Target</span><strong>{ticketDetail.target_team_type === "Admin" ? "Admin Support" : "Authority"}</strong></div>
                                    {ticketDetail.related_report_id && <div><span>Related Report</span><strong>{ticketDetail.related_report_id.slice(0, 8)}</strong></div>}
                                    {ticketDetail.related_zone && <div><span>Zone</span><strong>{ticketDetail.related_zone}</strong></div>}
                                </div>

                                <div className="auth-hc-message-block">
                                    <h4>Original message</h4>
                                    <p>{ticketDetail.message}</p>
                                </div>

                                {(ticketDetail.responses || []).length > 0 && (
                                    <div className="auth-hc-responses">
                                        <h4>Conversation</h4>
                                        {ticketDetail.responses.map((r, i) => (
                                            <div key={i} className="auth-hc-response">
                                                <div className="auth-hc-response-head">
                                                    <strong>{r.author_name}</strong>
                                                    <span className="auth-hc-response-role">{r.author_role}</span>
                                                    <span className="auth-hc-response-time">{new Date(r.created_at).toLocaleString()}</span>
                                                </div>
                                                <p>{r.text}</p>
                                            </div>
                                        ))}
                                    </div>
                                )}

                                {actionError && <p className="error" style={{ marginTop: "0.75rem" }}>{actionError}</p>}

                                {/* Citizen can reply but cannot change status */}
                                {ticketDetail.status !== "Closed" && (
                                    <form onSubmit={handleAddResponse} className="auth-hc-response-form">
                                        <textarea
                                            placeholder="Reply to support..."
                                            value={responseText}
                                            onChange={(e) => setResponseText(e.target.value)}
                                            rows={3}
                                        />
                                        <button type="submit" className="hc-submit-btn" disabled={actionLoading || !responseText.trim()}>
                                            <Send size={15} /> Send
                                        </button>
                                    </form>
                                )}
                            </div>
                        ) : (
                            <p className="text-muted" style={{ padding: "2rem" }}>{actionError || "Loading ticket details..."}</p>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
