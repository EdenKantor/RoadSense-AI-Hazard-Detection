/**
 * Authority help center page.
 *
 * Authority-role landing for guided onboarding (resource cards linking to
 * Dashboard / Reports / Map / Notifications / Profile) and ticket workflows.
 * Team leaders see additional team-management resources and the assigned
 * support-ticket queue with status updates and threaded responses.
 */
import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { LayoutDashboard, ClipboardList, RefreshCw, ChevronLeft, ChevronRight, ChevronDown, Eye, X, Send, History, Activity, Edit3, Info } from "lucide-react";
import { authorityApi, supportApi } from "../api/client";

const PAGE_SIZE = 5;

const RESOURCES = [
    {
        icon: LayoutDashboard, color: "#6366f1", bg: "#ede9fe",
        title: "Dashboard Overview",
        desc: "Monitor assigned and pending reports.",
        linkText: "Dashboard", to: "/authority/dashboard",
    },
    {
        icon: ClipboardList, color: "#2563eb", bg: "#dbeafe",
        title: "Managing Reports",
        desc: "Review detailed issues in pending and active reports.",
        linkText: "Assigned Reports", to: "/authority/events",
    },
    {
        icon: Edit3, color: "#16a34a", bg: "#dcfce7",
        title: "Updating Status",
        desc: "Change report status through its lifecycle.",
        linkText: "Assigned Reports", to: "/authority/events",
    },
    {
        icon: History, color: "#ea580c", bg: "#ffedd5",
        title: "Status History",
        desc: "View all status changes of each report in the Status History.",
        linkText: null, to: null,
    },
    {
        icon: Activity, color: "#10b981", bg: "#d1fae5",
        title: "Efficiency & Active Cases",
        desc: "Check how many reports are assigned, in progress, and resolved on the sidebar.",
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

export default function AuthorityHelpCenterPage() {
    // Team leader detection
    const [searchParams, setSearchParams] = useSearchParams();
    const targetTicketParam = searchParams.get("ticket");
    const [highlightedTicket, setHighlightedTicket] = useState(null);
    const [isLeader, setIsLeader] = useState(false);
    const [teamLoaded, setTeamLoaded] = useState(false);

    // Tickets
    const [tickets, setTickets] = useState([]);
    const [loading, setLoading] = useState(true);
    const [lastUpdated, setLastUpdated] = useState(null);
    const [statusFilter, setStatusFilter] = useState("");
    const [currentPage, setCurrentPage] = useState(1);

    // Modal
    const [openTicket, setOpenTicket] = useState(null);
    const [ticketDetail, setTicketDetail] = useState(null);
    const [responseText, setResponseText] = useState("");
    const [actionLoading, setActionLoading] = useState(false);
    const [actionError, setActionError] = useState("");

    useEffect(() => {
        // Detect team leader status
        authorityApi.myTeam()
            .then((res) => {
                setIsLeader(res.data?.is_leader === true);
            })
            .catch(() => setIsLeader(false))
            .finally(() => setTeamLoaded(true));
    }, []);

    const loadTickets = () => {
        setLoading(true);
        supportApi.list()
            .then((res) => { setTickets(res.data || []); setLastUpdated(new Date()); })
            .catch(() => {})
            .finally(() => setLoading(false));
    };

    useEffect(() => {
        if (isLeader) loadTickets();
        else setLoading(false);
    }, [isLeader]);

    useEffect(() => { setCurrentPage(1); }, [statusFilter]);

    useEffect(() => {
        if (!targetTicketParam || tickets.length === 0) return;
        const idx = tickets.findIndex(t => t.ticket_id === targetTicketParam);
        if (idx === -1) return;
        if (statusFilter) setStatusFilter("");
        setCurrentPage(Math.floor(idx / PAGE_SIZE) + 1);
        setHighlightedTicket(targetTicketParam);
        setTimeout(() => {
            document.getElementById(`auth-ticket-row-${targetTicketParam}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
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
                <h1 className="hc-banner-title">Authority Help Center</h1>
                <p className="hc-banner-sub">Guides and support for government authorities</p>
            </div>

            {/* Authority Resources */}
            <div className="hc-card">
                <h2 className="hc-section-title">Authority Resources</h2>
                <div className="auth-hc-resources">
                    {RESOURCES.map((r) => {
                        const Icon = r.icon;
                        return (
                            <div key={r.title} className="auth-hc-resource">
                                <div className="auth-hc-icon" style={{ background: r.bg, color: r.color }}>
                                    <Icon size={22} />
                                </div>
                                <div>
                                    <h3>{r.title}</h3>
                                    <p>
                                        {r.desc}
                                        {r.to && r.linkText && <> Go to <Link to={r.to} className="auth-hc-link"><strong>{r.linkText}</strong></Link>.</>}
                                    </p>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Tickets — only for Team Leaders */}
            {teamLoaded && !isLeader && (
                <div className="hc-card auth-hc-info">
                    <Info size={18} />
                    <span>Support ticket management is available only for team leaders.</span>
                </div>
            )}

            {teamLoaded && isLeader && (
                <div className="hc-card">
                    <div className="hc-tickets-header">
                        <h2 className="hc-section-title" style={{ margin: 0 }}>Report Support Tickets</h2>
                        <div className="hc-tickets-controls">
                            {lastUpdated && <span className="hc-last-updated">Updated {lastUpdated.toLocaleTimeString()}</span>}
                            <button type="button" className="hc-refresh-btn" onClick={loadTickets} disabled={loading}>
                                <RefreshCw size={15} className={loading ? "hc-spin" : ""} />
                                Refresh
                            </button>
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
                        </div>
                    </div>

                    {loading ? (
                        <p className="text-muted" style={{ padding: "1rem" }}>Loading tickets...</p>
                    ) : filtered.length === 0 ? (
                        <p className="text-muted" style={{ padding: "1rem", textAlign: "center" }}>
                            {statusFilter ? `No tickets with status "${statusLabel(statusFilter)}".` : "No tickets assigned to you."}
                        </p>
                    ) : (
                        <>
                            <div className="auth-hc-tickets">
                                <div className="auth-hc-thead">
                                    <span>Ticket ID</span>
                                    <span>Subject</span>
                                    <span>Related Report</span>
                                    <span>Status</span>
                                    <span>Last Updated</span>
                                    <span>View</span>
                                </div>
                                {paginated.map((t) => (
                                    <div key={t.ticket_id} id={`auth-ticket-row-${t.ticket_id}`} className={`auth-hc-row${highlightedTicket === t.ticket_id ? " hc-row-highlight" : ""}`}>
                                        <span className="hc-tid">{t.ticket_id.slice(0, 5).toUpperCase()}</span>
                                        <div className="auth-hc-subject-cell">
                                            <strong>{t.subject}</strong>
                                            <span>by {t.author_name || "Unknown"}</span>
                                        </div>
                                        <span className="auth-hc-related">
                                            {t.related_report_id ? (
                                                <>
                                                    <strong>{t.related_zone || "Pothole report"}</strong>
                                                    <span>{t.related_report_id.slice(0, 8)}</span>
                                                </>
                                            ) : "—"}
                                        </span>
                                        <span><span className={`hc-status-pill ${statusClass(t.status)}`}>{statusLabel(t.status)}</span></span>
                                        <span className="hc-tupdated">{timeAgo(t.updated_at)}</span>
                                        <button className="hc-view-btn" type="button" onClick={() => openTicketDetail(t)}><Eye size={14} /></button>
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
            )}

            {/* Ticket Detail Modal — same style as admin */}
            {openTicket && (
                <div className="auth-hc-overlay" onClick={closeModal}>
                    <div className="auth-hc-modal" onClick={(e) => e.stopPropagation()}>
                        <div className="auth-hc-modal-head">
                            <div>
                                <h2>{openTicket.subject}</h2>
                                <p>Ticket {openTicket.ticket_id.slice(0, 5).toUpperCase()} · Official Support</p>
                            </div>
                            <button className="auth-hc-close" onClick={closeModal}><X size={20} /></button>
                        </div>

                        {ticketDetail ? (
                            <div className="auth-hc-modal-body">
                                <div className="auth-hc-meta">
                                    <div><span>Author</span><strong>{ticketDetail.author_name || "Unknown"}</strong></div>
                                    <div><span>Status</span><strong><span className={`hc-status-pill ${statusClass(ticketDetail.status)}`}>{statusLabel(ticketDetail.status)}</span></strong></div>
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

                                <div className="auth-hc-actions">
                                    <div className="auth-hc-status-actions">
                                        <span>Update status:</span>
                                        {["Open", "InReview", "WaitingForResponse", "Resolved", "Closed"].map(s => (
                                            <button key={s} type="button"
                                                className={`auth-hc-status-btn ${ticketDetail.status === s ? "auth-hc-status-active" : ""}`}
                                                onClick={() => handleStatusChange(s)} disabled={actionLoading}>
                                                {statusLabel(s)}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                {actionError && <p className="error" style={{ marginTop: "0.75rem" }}>{actionError}</p>}

                                <form onSubmit={handleAddResponse} className="auth-hc-response-form">
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
