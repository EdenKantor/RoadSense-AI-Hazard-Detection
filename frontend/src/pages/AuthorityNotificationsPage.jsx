/**
 * Authority notifications page.
 *
 * Surfaces assigned-event activity (status changes, new comments) and
 * support-ticket replies for the current Authority user. Read state is
 * persisted server-side via `/api/notifications/reads` so the unread
 * badge stays in sync across devices.
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Bell, BellOff, AlertTriangle, MessageSquare, Loader2, CheckCheck, Inbox, ExternalLink, ChevronLeft, ChevronRight, CheckCircle2 } from "lucide-react";
import { authorityApi, supportApi, notificationsApi } from "../api/client";

const PAGE_SIZE = 5;

function timeAgo(dateStr) {
    if (!dateStr) return "";
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "Just now";
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    return new Date(dateStr).toLocaleDateString();
}

function severityMeta(s) {
    if (s === "High") return { color: "#dc2626", bg: "#fee2e2" };
    if (s === "Medium") return { color: "#d97706", bg: "#fef3c7" };
    return { color: "#16a34a", bg: "#dcfce7" };
}

export default function AuthorityNotificationsPage() {
    const [items, setItems] = useState([]);
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState("all");
    const [readIds, setReadIds] = useState(() => new Set());
    const [currentPage, setCurrentPage] = useState(1);

    useEffect(() => {
        const load = async () => {
            setLoading(true);
            const collected = [];
            // Seed read-state from the server before computing unread counts.
            try {
                const r = await notificationsApi.getReads();
                setReadIds(new Set(r?.data?.read_keys || []));
            } catch { /* keep empty set on failure; user can still click around */ }
            try {
                // Events visible to this authority (auto-filtered by backend by zone/assignment)
                const ev = await authorityApi.events();
                (ev.data || []).slice(0, 30).forEach((e) => {
                    const meta = severityMeta(e.severity);
                    collected.push({
                        id: `ev-${e.event_id || e._id}`,
                        type: "event",
                        title: `${e.severity || "Medium"} severity pothole event`,
                        message: `Status: ${e.lifecycle_status || "Reported"} · zone: ${e.zone || "—"}`,
                        createdAt: e.updated_at || e.created_at,
                        link: `/authority/events/${e.event_id || e._id}/update`,
                        icon: AlertTriangle,
                        color: meta.color,
                        bg: meta.bg,
                    });
                });
            } catch {}
            try {
                // Support tickets assigned to this authority (only if team leader)
                const t = await supportApi.list();
                (t.data || []).slice(0, 10).forEach((tk) => {
                    collected.push({
                        id: `tk-${tk.ticket_id}`,
                        type: "support_ticket",
                        title: `Support ticket: ${tk.subject}`,
                        message: `From ${tk.author_name || "Citizen"} · status: ${tk.status}`,
                        createdAt: tk.created_at,
                        link: `/authority/help?ticket=${tk.ticket_id}`,
                        icon: MessageSquare,
                        color: "#7c3aed",
                        bg: "#ede9fe",
                    });
                });
            } catch {}

            collected.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
            setItems(collected);
            setLoading(false);
        };
        load();
    }, []);

    const notifications = useMemo(() => items.map((n) => ({ ...n, unread: !readIds.has(n.id) })), [items, readIds]);
    const filtered = notifications.filter((n) => filter === "unread" ? n.unread : filter === "read" ? !n.unread : true);
    const unreadCount = notifications.filter((n) => n.unread).length;
    const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
    const paginated = useMemo(() => {
        const start = (currentPage - 1) * PAGE_SIZE;
        return filtered.slice(start, start + PAGE_SIZE);
    }, [filtered, currentPage]);
    useEffect(() => { setCurrentPage(1); }, [filter]);

    // Optimistic local update + fire-and-forget API write. Errors are silenced
    // so a transient network blip does not block the badge from updating.
    const markRead = (id) => {
        if (!id) return;
        const next = new Set(readIds); next.add(id); setReadIds(next);
        notificationsApi.markAsRead([id]).catch(() => {});
    };
    const markUnread = (id) => {
        if (!id) return;
        const next = new Set(readIds); next.delete(id); setReadIds(next);
        notificationsApi.markAsUnread(id).catch(() => {});
    };
    const markAllRead = () => {
        const next = new Set(readIds);
        const newKeys = [];
        notifications.forEach((n) => {
            if (n.id && !next.has(n.id)) { next.add(n.id); newKeys.push(n.id); }
        });
        setReadIds(next);
        if (newKeys.length > 0) notificationsApi.markAsRead(newKeys).catch(() => {});
    };

    function getVisiblePages() {
        if (totalPages <= 3) return Array.from({ length: totalPages }, (_, i) => i + 1);
        if (currentPage <= 2) return [1, 2, 3];
        if (currentPage >= totalPages - 1) return [totalPages - 2, totalPages - 1, totalPages];
        return [currentPage - 1, currentPage, currentPage + 1];
    }

    const filterButtons = [
        { key: "all", label: "All", count: notifications.length },
        { key: "unread", label: "Unread", count: unreadCount },
        { key: "read", label: "Read", count: notifications.length - unreadCount },
    ];

    return (
        <div className="notif-page">
            <div className="notif-banner">
                <div className="notif-banner-icon"><Bell size={32} /></div>
                <div>
                    <h1 className="notif-banner-title">Authority Notifications</h1>
                    <p className="notif-banner-sub">{unreadCount > 0 ? `You have ${unreadCount} unread update${unreadCount === 1 ? "" : "s"}` : "You're all caught up!"}</p>
                </div>
                <div className="notif-banner-stats">
                    <div className="notif-stat"><span className="notif-stat-num">{notifications.length}</span><span className="notif-stat-label">Total</span></div>
                    <div className="notif-stat"><span className="notif-stat-num" style={{ color: "#fde68a" }}>{unreadCount}</span><span className="notif-stat-label">Unread</span></div>
                    <div className="notif-stat"><span className="notif-stat-num" style={{ color: "#a5f3fc" }}>{notifications.length - unreadCount}</span><span className="notif-stat-label">Read</span></div>
                </div>
            </div>

            <div className="notif-filter-bar">
                <div className="notif-filter-tabs">
                    {filterButtons.map((f) => (
                        <button key={f.key} className={`notif-filter-tab${filter === f.key ? " active" : ""}`} onClick={() => setFilter(f.key)}>
                            {f.label}<span className="notif-filter-count">{f.count}</span>
                        </button>
                    ))}
                </div>
                {unreadCount > 0 && (
                    <button className="notif-mark-all" onClick={markAllRead}><CheckCheck size={16} /> Mark All Read</button>
                )}
            </div>

            {loading ? (
                <div className="notif-empty-state"><Loader2 size={32} className="notif-spinner" /><p>Loading notifications...</p></div>
            ) : filtered.length === 0 ? (
                <div className="notif-empty-state">
                    {filter === "unread" ? <BellOff size={40} /> : <Inbox size={40} />}
                    <h3>{filter === "unread" ? "No unread notifications" : filter === "read" ? "No read notifications" : "No notifications yet"}</h3>
                    <p className="text-muted">{filter === "unread" ? "You're all caught up!" : "Notifications will appear here when events are assigned to you."}</p>
                </div>
            ) : (
                <>
                    <div className="notif-list">
                        {paginated.map((n) => {
                            const Icon = n.icon;
                            return (
                                <div key={n.id} className={`notif-card${n.unread ? " notif-unread" : ""}`}>
                                    <div className="notif-card-icon" style={{ background: n.bg, color: n.color }}><Icon size={20} /></div>
                                    <div className="notif-card-body">
                                        <div className="notif-card-header">
                                            <div className="notif-card-title-row">
                                                <strong className="notif-card-title">{n.title}</strong>
                                                {n.unread && <span className="notif-new-badge">New</span>}
                                            </div>
                                            <span className="notif-card-time">{timeAgo(n.createdAt)}</span>
                                        </div>
                                        <p className="notif-card-message">{n.message}</p>
                                    </div>
                                    <div className="notif-card-actions">
                                        {n.link && (
                                            <Link className="notif-action-btn notif-action-open" to={n.link} onClick={() => markRead(n.id)}>
                                                <ExternalLink size={14} /> Open
                                            </Link>
                                        )}
                                        {n.unread ? (
                                            <button className="notif-action-btn notif-action-read" type="button" onClick={() => markRead(n.id)}>
                                                <CheckCircle2 size={14} /> Read
                                            </button>
                                        ) : (
                                            <button className="notif-action-btn notif-action-unread" type="button" onClick={() => markUnread(n.id)}>
                                                <BellOff size={14} /> Unread
                                            </button>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                    {totalPages > 1 && (
                        <div className="ref-pagination" style={{ marginTop: 16 }}>
                            <button className="ref-page-link" disabled={currentPage === 1} onClick={() => setCurrentPage(p => p - 1)}><ChevronLeft size={16} /> Prev</button>
                            {getVisiblePages().map(p => (
                                <button key={p} className={`ref-page-num${p === currentPage ? " active" : ""}`} onClick={() => setCurrentPage(p)}>{p}</button>
                            ))}
                            <button className="ref-page-link" disabled={currentPage === totalPages} onClick={() => setCurrentPage(p => p + 1)}>Next <ChevronRight size={16} /></button>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}
