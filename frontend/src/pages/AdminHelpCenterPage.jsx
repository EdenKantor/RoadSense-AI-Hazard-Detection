/**
 * Admin help center page.
 *
 * Admin-only landing with guided resource cards (Dashboard, Users, Approvals,
 * Reports, Zones/Teams) and the Admin support-ticket queue. Tickets routed
 * to target_team_type=Admin are visible here; Officials' team-leader queue
 * is separate and not surfaced on this page.
 */
import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { LayoutDashboard, Users, ShieldCheck, FileText, Activity, ChevronLeft, ChevronRight, ChevronDown, Eye, RefreshCw, X, Send } from "lucide-react";
import { supportApi } from "../api/client";

const PAGE_SIZE = 5;

const RESOURCES = [
    {
        icon: LayoutDashboard, color: "#6366f1", bg: "#ede9fe",
        title: "Dashboard Overview",
        desc: "Get real-time counts of citizens, authorities, pending verifications, and reports.",
        linkText: "Dashboard", to: "/admin/dashboard",
    },
    {
        icon: Users, color: "#16a34a", bg: "#dcfce7",
        title: "User Management",
        desc: "Suspend / un-suspend users and manage permissions.",
        linkText: "User Management", to: "/admin/users",
    },
    {
        icon: ShieldCheck, color: "#2563eb", bg: "#dbeafe",
        title: "Official Verification",
        desc: "Check pending government official registrations.",
        linkText: "Verify Officials", to: "/admin/officials/verify",
    },
    {
        icon: FileText, color: "#ea580c", bg: "#ffedd5",
        title: "Report Processing",
        desc: "Browse and manage uploaded citizen reports and pipeline runs.",
        linkText: "Report Processing", to: "/admin/reports",
    },
    {
        icon: Activity, color: "#10b981", bg: "#d1fae5",
        title: "System Status",
        desc: "Monitor overall system health. Sidebar shows status as 'Active' or 'Degraded'.",
        linkText: null, to: null,
    },
];

function statusLabel(s) {
    if (s === "Open") return "Open";
    if (s === "InReview") return "In Review";
    if (s === "WaitingForResponse") return "Waiting for Response";
    if (s === "Resolved") return "Resolved";
    if (s === "Closed") return "Closed";
    return s;
}
function statusClass(s) {
    if (s === "Open") return "hc-pill-open";
    if (s === "InReview") return "hc-pill-review";
    if (s === "WaitingForResponse") return "hc-pill-waiting";
    if (s === "Resolved") return "hc-pill-resolved";
    if (s === "Closed") return "hc-pill-closed";
    return "";
}
function timeAgo(d) {
    if (!d) return "—";
    const diff = Date.now() - new Date(d).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `Today, ${new Date(d).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days === 1) return "Yesterday";
    if (days < 7) return `${days} days ago`;
    return new Date(d).toLocaleDateString();
}

export default function AdminHelpCenterPage() {
    const [searchParams, setSearchParams] = useSearchParams();
    const targetTicketParam = searchParams.get("ticket");
    const [highlightedTicket, setHighlightedTicket] = useState(null);
    const [tickets, setTickets] = useState([]);
    const [loading, setLoading] = useState(true);
    const [lastUpdated, setLastUpdated] = useState(null);
    const [statusFilter, setStatusFilter] = useState("");
    const [currentPage, setCurrentPage] = useState(1);
    const [openTicket, setOpenTicket] = useState(null);
    const [ticketDetail, setTicketDetail] = useState(null);
    const [responseText, setResponseText] = useState("");
    const [actionLoading, setActionLoading] = useState(false);
    const [actionError, setActionError] = useState("");

    const loadTickets = () => {
        setLoading(true);
        supportApi.list()
            .then((res) => { setTickets(res.data || []); setLastUpdated(new Date()); })
            .catch(() => {})
            .finally(() => setLoading(false));
    };

    useEffect(() => { loadTickets(); }, []);
    useEffect(() => { setCurrentPage(1); }, [statusFilter]);

    useEffect(() => {
        if (!targetTicketParam || tickets.length === 0) return;
        const idx = tickets.findIndex(t => t.ticket_id === targetTicketParam);
        if (idx === -1) return;
        if (statusFilter) setStatusFilter("");
        setCurrentPage(Math.floor(idx / PAGE_SIZE) + 1);
        setHighlightedTicket(targetTicketParam);
        setTimeout(() => {
            document.getElementById(`adm-ticket-row-${targetTicketParam}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
        }, 200);
        const timer = setTimeout(() => {
            setHighlightedTicket(null);
            const next = new URLSearchParams(searchParams);
            next.delete("ticket");
            setSearchParams(next, { replace: true });
        }, 4500);
        return () => clearTimeout(timer);
    }, [targetTicketParam, tickets]); // eslint-disable-line react-hooks/exhaustive-deps

    const filtered = useMemo(() => {
        if (!statusFilter) return tickets;
        return tickets.filter(t => t.status === statusFilter);
    }, [tickets, statusFilter]);

    const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    const paginated = useMemo(() => {
        const start = (currentPage - 1) * PAGE_SIZE;
        return filtered.slice(start, start + PAGE_SIZE);
    }, [filtered, currentPage]);

    function getVisiblePages() {
        if (totalPages <= 3) return Array.from({ length: totalPages }, (_, i) => i + 1);
        if (currentPage <= 2) return [1, 2, 3];
        if (currentPage >= totalPages - 1) return [totalPages - 2, totalPages - 1, totalPages];
        return [currentPage - 1, currentPage, currentPage + 1];
    }

    const openTicketDetail = async (t) => {
        setOpenTicket(t);
        setActionError("");
        setResponseText("");
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

    const handleStatusChange = async (newStatus) => {
        if (!openTicket) return;
        setActionLoading(true); setActionError("");
        try {
            await supportApi.updateStatus(openTicket.ticket_id, newStatus);
            await refreshTicketDetail();
            loadTickets();
        } catch (err) {
            setActionError(err.response?.data?.detail || "Failed to update status.");
        } finally { setActionLoading(false); }
    };

    const handleAddResponse = async (e) => {
        e.preventDefault();
        if (!responseText.trim() || !openTicket) return;
        setActionLoading(true); setActionError("");
        try {
            await supportApi.addResponse(openTicket.ticket_id, responseText.trim());
            setResponseText("");
            await refreshTicketDetail();
        } catch (err) {
            setActionError(err.response?.data?.detail || "Failed to add response.");
        } finally { setActionLoading(false); }
    };

    return (
        <div className="hc-page">
            {/* Banner */}
            <div className="hc-banner">
                <h1 className="hc-banner-title">Admin Help Center</h1>
                <p className="hc-banner-sub">Guides, resources and support ticket management for system administrators</p>
            </div>

            {/* Admin Resources */}
            <div className="hc-card">
                <h2 className="hc-section-title">Admin Resources</h2>
                <div className="adm-hc-resources">
                    {RESOURCES.map((r) => {
                        const Icon = r.icon;
                        return (
                            <div key={r.title} className="adm-hc-resource">
                                <div className="adm-hc-icon" style={{ background: r.bg, color: r.color }}>
                                    <Icon size={22} />
                                </div>
                                <div>
                                    <h3>{r.title}</h3>
                                    <p>
                                        {r.desc}
                                        {r.to && r.linkText && <> Go to <Link to={r.to} className="adm-hc-link"><strong>{r.linkText}</strong></Link>.</>}
                                    </p>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Support Tickets */}
            <div className="hc-card">
                <div className="hc-tickets-header">
                    <h2 className="hc-section-title" style={{ margin: 0 }}>Support Tickets</h2>
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
                        <button type="button" className="hc-refresh-btn" onClick={loadTickets} disabled={loading}>
                            <RefreshCw size={15} className={loading ? "hc-spin" : ""} />
                            Refresh
                        </button>
                    </div>
                </div>

                {loading ? (
                    <p className="text-muted" style={{ padding: "1rem" }}>Loading tickets...</p>
                ) : filtered.length === 0 ? (
                    <p className="text-muted" style={{ padding: "1rem", textAlign: "center" }}>
                        {statusFilter ? `No tickets with status "${statusLabel(statusFilter)}".` : "No tickets to manage."}
                    </p>
                ) : (
                    <>
                        <div className="adm-hc-tickets">
                            <div className="adm-hc-thead">
                                <span>Ticket ID</span>
                                <span>Subject</span>
                                <span>Status</span>
                                <span>Last Updated</span>
                                <span></span>
                            </div>
                            {paginated.map((t) => (
                                <div key={t.ticket_id} id={`adm-ticket-row-${t.ticket_id}`} className={`adm-hc-row${highlightedTicket === t.ticket_id ? " hc-row-highlight" : ""}`}>
                                    <span className="hc-tid">{t.ticket_id.slice(0, 5).toUpperCase()}</span>
                                    <div className="adm-hc-subject-cell">
                                        <strong>{t.subject}</strong>
                                        <span>by {t.author_name || "Unknown"}</span>
                                    </div>
                                    <span><span className={`hc-status-pill ${statusClass(t.status)}`}>{statusLabel(t.status)}</span></span>
                                    <span className="hc-tupdated">{timeAgo(t.updated_at)}</span>
                                    <button className="hc-view-btn" type="button" onClick={() => openTicketDetail(t)} title="View"><Eye size={14} /></button>
                                </div>
                            ))}
                        </div>

                        {totalPages > 1 && (
                            <div className="hc-tickets-footer">
                                <span className="hc-showing">Showing {((currentPage - 1) * PAGE_SIZE) + 1}–{Math.min(currentPage * PAGE_SIZE, filtered.length)} of {filtered.length} tickets</span>
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

            {/* Ticket Detail Modal */}
            {openTicket && (
                <div className="adm-hc-overlay" onClick={closeModal}>
                    <div className="adm-hc-modal" onClick={(e) => e.stopPropagation()}>
                        <div className="adm-hc-modal-head">
                            <div>
                                <h2>{openTicket.subject}</h2>
                                <p>Ticket {openTicket.ticket_id.slice(0, 5).toUpperCase()} · Admin Support</p>
                            </div>
                            <button className="adm-hc-close" onClick={closeModal}><X size={20} /></button>
                        </div>

                        {ticketDetail ? (
                            <div className="adm-hc-modal-body">
                                <div className="adm-hc-meta">
                                    <div><span>Author</span><strong>{ticketDetail.author_name || "Unknown"}</strong></div>
                                    <div><span>Status</span><strong><span className={`hc-status-pill ${statusClass(ticketDetail.status)}`}>{statusLabel(ticketDetail.status)}</span></strong></div>
                                    {ticketDetail.related_report_id && <div><span>Related Report</span><strong>{ticketDetail.related_report_id.slice(0, 8)}</strong></div>}
                                    {ticketDetail.related_zone && <div><span>Zone</span><strong>{ticketDetail.related_zone}</strong></div>}
                                </div>

                                <div className="adm-hc-message-block">
                                    <h4>Original message</h4>
                                    <p>{ticketDetail.message}</p>
                                </div>

                                {(ticketDetail.responses || []).length > 0 && (
                                    <div className="adm-hc-responses">
                                        <h4>Conversation</h4>
                                        {ticketDetail.responses.map((r, i) => (
                                            <div key={i} className="adm-hc-response">
                                                <div className="adm-hc-response-head">
                                                    <strong>{r.author_name}</strong>
                                                    <span className="adm-hc-response-role">{r.author_role}</span>
                                                    <span className="adm-hc-response-time">{new Date(r.created_at).toLocaleString()}</span>
                                                </div>
                                                <p>{r.text}</p>
                                            </div>
                                        ))}
                                    </div>
                                )}

                                {/* Status update actions */}
                                <div className="adm-hc-actions">
                                    <div className="adm-hc-status-actions">
                                        <span>Update status:</span>
                                        {["Open", "InReview", "WaitingForResponse", "Resolved", "Closed"].map(s => (
                                            <button key={s} type="button"
                                                className={`adm-hc-status-btn ${ticketDetail.status === s ? "adm-hc-status-active" : ""}`}
                                                onClick={() => handleStatusChange(s)} disabled={actionLoading}>
                                                {statusLabel(s)}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                {actionError && <p className="error" style={{ marginTop: "0.75rem" }}>{actionError}</p>}

                                {/* Response form */}
                                <form onSubmit={handleAddResponse} className="adm-hc-response-form">
                                    <textarea
                                        placeholder="Write a response..."
                                        value={responseText}
                                        onChange={(e) => setResponseText(e.target.value)}
                                        rows={3}
                                    />
                                    <button type="submit" className="hc-submit-btn" disabled={actionLoading || !responseText.trim()}>
                                        <Send size={15} /> Send
                                    </button>
                                </form>
                            </div>
                        ) : (
                            <p className="text-muted" style={{ padding: "2rem" }}>Loading ticket details...</p>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
