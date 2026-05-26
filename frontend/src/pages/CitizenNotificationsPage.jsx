/**
 * Citizen notifications page.
 *
 * Citizen-only view that aggregates two notification streams into a single
 * filterable, paginated list: (1) one card per upload showing its current
 * processing state (Queued / Processing / Done / Failed), and (2) one card
 * per support-ticket status change and per non-citizen reply on tickets the
 * user opened. Read/unread state is persisted server-side via
 * `/api/notifications/reads`, keyed per-user, so the unread badge stays in
 * sync across devices. Users can mark items read/unread, mark all read,
 * filter by read state, and click through to the upload tracker or Help
 * Center (deep-linked with `?ticket=...`).
 */

import { useMemo, useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { uploadsApi, supportApi, notificationsApi } from "../api/client";
import { Bell, BellOff, CheckCircle2, AlertCircle, Clock, Loader2, ChevronLeft, ChevronRight, ExternalLink, CheckCheck, Inbox, MessageSquare, RefreshCw } from "lucide-react";

const PAGE_SIZE = 5;

/** Map an upload lifecycle status to icon, colors, and a human-readable message. */
function statusMeta(status) {
    if (status === "Done") return { icon: CheckCircle2, color: "#16a34a", bg: "#dcfce7", darkBg: "#16a34a22", label: "Completed", message: "Processing completed and pothole events were published." };
    if (status === "Failed") return { icon: AlertCircle, color: "#dc2626", bg: "#fee2e2", darkBg: "#dc262622", label: "Failed", message: "Processing failed. Open the upload tracker for details." };
    if (status === "Processing") return { icon: Loader2, color: "#8b5cf6", bg: "#ede9fe", darkBg: "#8b5cf622", label: "Processing", message: "Video and GPX are currently being processed." };
    return { icon: Clock, color: "#d97706", bg: "#fef3c7", darkBg: "#d9770622", label: "Queued", message: "Upload is queued and waiting for a worker." };
}

/** Render a relative time string ("Just now", "5m ago", "3d ago", or full date). */
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

/** Convert a backend ticket status enum value to a user-facing label. */
function ticketStatusLabel(s) {
    if (s === "Open") return "Open";
    if (s === "InReview") return "In Review";
    if (s === "WaitingForResponse") return "Waiting for Response";
    if (s === "Resolved") return "Resolved";
    if (s === "Closed") return "Closed";
    return s;
}

/** Citizen-facing notification feed (uploads + ticket activity). */
export default function CitizenNotificationsPage() {
    const [uploads, setUploads] = useState([]);
    const [tickets, setTickets] = useState([]);
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState("all");
    const [readIds, setReadIds] = useState(() => new Set());
    const [currentPage, setCurrentPage] = useState(1);

    const loadAll = async () => {
        setLoading(true);
        try {
            const [u, t, r] = await Promise.all([
                uploadsApi.mine().catch(() => ({ data: [] })),
                supportApi.listMine().catch(() => ({ data: [] })),
                notificationsApi.getReads().catch(() => ({ data: { read_keys: [] } })),
            ]);
            const upayload = u?.data ?? [];
            setUploads(Array.isArray(upayload) ? upayload : upayload.uploads || []);
            setTickets(Array.isArray(t?.data) ? t.data : []);
            setReadIds(new Set(r?.data?.read_keys || []));
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { loadAll(); }, []);

    const notifications = useMemo(() => {
        const items = [];

        // 1) Upload (report) notifications — one per upload
        for (const upload of uploads) {
            const id = upload.upload_id || upload.id || upload._id;
            const meta = statusMeta(upload.status);
            items.push({
                id: `up-${id}`,
                kind: "upload",
                title: upload.original_video_filename || `Upload ${id?.slice(0, 8) || "unknown"}`,
                message: meta.message,
                meta,
                createdAt: upload.updated_at || upload.created_at,
                link: id ? `/uploads/${id}/status` : "/uploads/mine",
            });
        }

        // 2) Ticket notifications — one per status change (after creation) + one per response
        const ticketMeta = {
            icon: MessageSquare,
            color: "#7c3aed", bg: "#ede9fe",
            label: "Support",
            message: "",
        };
        for (const t of tickets) {
            const targetLabel = t.target_team_type === "Admin" ? "Admin Support" : "Authority";

            // Status changes (skip the initial "Open" creation entry)
            (t.status_history || []).forEach((h, idx) => {
                if (!h.from) return; // skip creation
                items.push({
                    id: `tk-${t.ticket_id}-status-${idx}`,
                    kind: "ticket_status",
                    title: `Ticket status changed: ${t.subject}`,
                    message: `${targetLabel} support · status updated to ${ticketStatusLabel(h.to)}.`,
                    meta: ticketMeta,
                    createdAt: h.changed_at,
                    link: `/citizen/help?ticket=${t.ticket_id}`,
                });
            });

            // Responses (any reply added to the conversation that isn't from the citizen themselves)
            (t.responses || []).forEach((r, idx) => {
                if (r.author_id === t.created_by_user_id) return; // skip own replies
                items.push({
                    id: `tk-${t.ticket_id}-reply-${idx}`,
                    kind: "ticket_reply",
                    title: `New reply: ${t.subject}`,
                    message: `${r.author_name || targetLabel} replied to your ticket.`,
                    meta: ticketMeta,
                    createdAt: r.created_at,
                    link: `/citizen/help?ticket=${t.ticket_id}`,
                });
            });
        }

        items.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        return items.map((n) => ({ ...n, unread: !readIds.has(n.id) }));
    }, [uploads, tickets, readIds]);

    const filtered = notifications.filter((item) => {
        if (filter === "unread") return item.unread;
        if (filter === "read") return !item.unread;
        return true;
    });

    const unreadCount = notifications.filter((item) => item.unread).length;
    const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
    const paginatedNotifications = useMemo(() => {
        const start = (currentPage - 1) * PAGE_SIZE;
        return filtered.slice(start, start + PAGE_SIZE);
    }, [filtered, currentPage]);

    useEffect(() => { setCurrentPage(1); }, [filter]);

    // Optimistic local update + fire-and-forget API write. The badge updates
    // immediately even if the server is briefly unreachable; the next page
    // load reconciles with the server's authoritative read set.
    const markRead = (id) => {
        if (!id) return;
        const next = new Set(readIds);
        next.add(id);
        setReadIds(next);
        notificationsApi.markAsRead([id]).catch(() => {});
    };

    const markUnread = (id) => {
        if (!id) return;
        const next = new Set(readIds);
        next.delete(id);
        setReadIds(next);
        notificationsApi.markAsUnread(id).catch(() => {});
    };

    const markAllRead = () => {
        const next = new Set(readIds);
        const newKeys = [];
        notifications.forEach((n) => {
            if (n.id && !next.has(n.id)) {
                next.add(n.id);
                newKeys.push(n.id);
            }
        });
        setReadIds(next);
        if (newKeys.length > 0) {
            notificationsApi.markAsRead(newKeys).catch(() => {});
        }
    };

    function getVisiblePages() {
        if (totalPages <= 3) return Array.from({ length: totalPages }, (_, i) => i + 1);
        if (currentPage <= 2) return [1, 2, 3];
        if (currentPage >= totalPages - 1) return [totalPages - 2, totalPages - 1, totalPages];
        return [currentPage - 1, currentPage, currentPage + 1];
    }

    function renderPagination() {
        if (totalPages <= 1) return null;
        const pages = getVisiblePages();
        return (
            <div className="ref-pagination" style={{ marginTop: 16 }}>
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

    const filterButtons = [
        { key: "all", label: "All", count: notifications.length },
        { key: "unread", label: "Unread", count: unreadCount },
        { key: "read", label: "Read", count: notifications.length - unreadCount },
    ];

    return (
        <div className="notif-page">
            {/* ── Banner ── */}
            <div className="notif-banner">
                <div className="notif-banner-icon">
                    <Bell size={32} />
                </div>
                <div>
                    <h1 className="notif-banner-title">Notifications</h1>
                    <p className="notif-banner-sub">
                        {unreadCount > 0
                            ? `You have ${unreadCount} unread update${unreadCount === 1 ? "" : "s"}`
                            : "You're all caught up!"}
                    </p>
                </div>
                <div className="notif-banner-stats">
                    <div className="notif-stat">
                        <span className="notif-stat-num">{notifications.length}</span>
                        <span className="notif-stat-label">Total</span>
                    </div>
                    <div className="notif-stat">
                        <span className="notif-stat-num" style={{ color: "#fde68a" }}>{unreadCount}</span>
                        <span className="notif-stat-label">Unread</span>
                    </div>
                    <div className="notif-stat">
                        <span className="notif-stat-num" style={{ color: "#a5f3fc" }}>{notifications.length - unreadCount}</span>
                        <span className="notif-stat-label">Read</span>
                    </div>
                </div>
            </div>

            {/* ── Filter Bar ── */}
            <div className="notif-filter-bar">
                <div className="notif-filter-tabs">
                    {filterButtons.map((f) => (
                        <button
                            key={f.key}
                            className={`notif-filter-tab${filter === f.key ? " active" : ""}`}
                            onClick={() => setFilter(f.key)}
                        >
                            {f.label}
                            <span className="notif-filter-count">{f.count}</span>
                        </button>
                    ))}
                </div>
                {unreadCount > 0 && (
                    <button className="notif-mark-all" onClick={markAllRead}>
                        <CheckCheck size={16} />
                        Mark All Read
                    </button>
                )}
            </div>

            {/* ── Notification List ── */}
            {loading ? (
                <div className="notif-empty-state">
                    <Loader2 size={32} className="notif-spinner" />
                    <p>Loading notifications...</p>
                </div>
            ) : filtered.length === 0 ? (
                <div className="notif-empty-state">
                    {filter === "unread" ? <BellOff size={40} /> : <Inbox size={40} />}
                    <h3>{filter === "unread" ? "No unread notifications" : filter === "read" ? "No read notifications" : "No notifications yet"}</h3>
                    <p className="text-muted">{filter === "unread" ? "You're all caught up!" : "Notifications will appear here when you submit reports."}</p>
                </div>
            ) : (
                <>
                    <div className="notif-list">
                        {paginatedNotifications.map((n) => {
                            const Icon = n.meta.icon;
                            return (
                                <div key={n.id || n.createdAt} className={`notif-card${n.unread ? " notif-unread" : ""}`}>
                                    <div className="notif-card-icon" style={{ background: n.meta.bg, color: n.meta.color }}>
                                        <Icon size={20} />
                                    </div>
                                    <div className="notif-card-body">
                                        <div className="notif-card-header">
                                            <div className="notif-card-title-row">
                                                <strong className="notif-card-title">{n.title}</strong>
                                                {n.unread && <span className="notif-new-badge">New</span>}
                                                {n.kind === "upload" && (
                                                    <span className={`notif-status-pill notif-status-${(n.meta.label || "").toLowerCase()}`}>{n.meta.label}</span>
                                                )}
                                            </div>
                                            <span className="notif-card-time">{timeAgo(n.createdAt)}</span>
                                        </div>
                                        <p className="notif-card-message">{n.message}</p>
                                    </div>
                                    <div className="notif-card-actions">
                                        {n.link && (
                                            <Link className="notif-action-btn notif-action-open" to={n.link} onClick={() => markRead(n.id)}>
                                                <ExternalLink size={14} />
                                                Open
                                            </Link>
                                        )}
                                        {n.unread ? (
                                            <button className="notif-action-btn notif-action-read" type="button" onClick={() => markRead(n.id)}>
                                                <CheckCircle2 size={14} />
                                                Read
                                            </button>
                                        ) : (
                                            <button className="notif-action-btn notif-action-unread" type="button" onClick={() => markUnread(n.id)}>
                                                <BellOff size={14} />
                                                Unread
                                            </button>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                    {renderPagination()}
                </>
            )}
        </div>
    );
}
