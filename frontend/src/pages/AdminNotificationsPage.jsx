/**
 * Admin notifications page.
 *
 * Admin-only feed of pending Authority approvals, failed uploads, and
 * Admin-targeted support tickets. Read state is persisted server-side via
 * `/api/notifications/reads` so the unread badge stays in sync across devices.
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Bell, BellOff, ShieldCheck, AlertCircle, MessageSquare, Loader2, CheckCheck, Inbox, ExternalLink, ChevronLeft, ChevronRight, CheckCircle2, Clock, FileText } from "lucide-react";
import { adminApi, supportApi, notificationsApi } from "../api/client";

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

export default function AdminNotificationsPage() {
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
            } catch { /* keep empty set on failure */ }
            try {
                // Pending authorities awaiting verification
                const pa = await adminApi.pendingAuthorities();
                (pa.data || []).forEach((p) => {
                    collected.push({
                        id: `pa-${p.user_id}`,
                        type: "pending_authority",
                        title: `Authority pending verification: ${p.full_name || p.organisation || "Unknown"}`,
                        message: `${p.organisation || "Unknown organisation"} · ${p.jurisdiction_area || "—"} is awaiting approval.`,
                        createdAt: p.submitted_at,
                        link: "/admin/officials/verify",
                        icon: ShieldCheck,
                        color: "#2563eb", bg: "#dbeafe",
                    });
                });
            } catch {}
            try {
                // ALL recent uploads (not just failed). Admin wants visibility on
                // every new submission as it moves through the pipeline; only the
                // icon/color varies by status.
                const u = await adminApi.listUploads();
                const statusStyle = (s) => {
                    if (s === "Failed")     return { icon: AlertCircle,  color: "#dc2626", bg: "#fee2e2", label: "failed" };
                    if (s === "Done")       return { icon: CheckCircle2, color: "#16a34a", bg: "#dcfce7", label: "completed" };
                    if (s === "Processing") return { icon: Loader2,      color: "#8b5cf6", bg: "#ede9fe", label: "processing" };
                    return { icon: Clock, color: "#d97706", bg: "#fef3c7", label: "queued" };
                };
                (u.data || []).slice(0, 10).forEach((x) => {
                    const meta = statusStyle(x.status);
                    collected.push({
                        id: `up-${x.upload_id}`,
                        type: x.status === "Failed" ? "failed_upload" : "upload_activity",
                        title: x.status === "Failed"
                            ? `Upload failed: ${x.uploader_name || "Unknown"}`
                            : `New upload from ${x.uploader_name || "Unknown"}`,
                        message: `Status: ${meta.label} · ${(x.upload_id || "").slice(0, 8)}`,
                        createdAt: x.created_at,
                        link: `/admin/uploads/${x.upload_id}/review`,
                        icon: meta.icon,
                        color: meta.color,
                        bg: meta.bg,
                    });
                });
            } catch {}
            try {
                // Recent admin-target support tickets
                const t = await supportApi.list();
                (t.data || []).slice(0, 10).forEach((tk) => {
                    collected.push({
                        id: `tk-${tk.ticket_id}`,
                        type: "support_ticket",
                        title: `New support ticket: ${tk.subject}`,
                        message: `From ${tk.author_name || "Unknown"} · status: ${tk.status}`,
                        createdAt: tk.created_at,
                        link: `/admin/help?ticket=${tk.ticket_id}`,
                        icon: MessageSquare,
                        color: "#7c3aed", bg: "#ede9fe",
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

    // Optimistic local update + fire-and-forget API write.
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
                    <h1 className="notif-banner-title">Admin Notifications</h1>
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
                    <p className="text-muted">{filter === "unread" ? "You're all caught up!" : "Notifications will appear here when admin events occur."}</p>
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
