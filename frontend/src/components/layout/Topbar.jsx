/**
 * Topbar for the authenticated app shell.
 *
 * Provides the theme toggle (light/dark, persisted in localStorage), an
 * unread-notifications bell, a search affordance, and a user menu. Read state
 * for notifications is fetched from `/api/notifications/reads` so the unread
 * badge stays in sync with what the per-role notifications page shows. Theme
 * preference is intentionally device-local and stays in localStorage.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { uploadsApi, adminApi, authorityApi, supportApi, notificationsApi, NOTIFICATIONS_READS_CHANGED } from "../../api/client";
import { useAuth } from "../../auth/AuthContext";
import { Search as IconSearch, HelpCircle as IconHelp, Bell as IconBell, Sun, Moon, ChevronDown } from "lucide-react";
import defaultAvatar from "../../assets/default-avatar.svg";

export default function Topbar() {
    const { user } = useAuth();
    const navigate = useNavigate();

    const [citizenNotificationsOpen, setCitizenNotificationsOpen] = useState(false);
    const [roleNotificationsOpen, setRoleNotificationsOpen] = useState(false);
    const [helpOpen, setHelpOpen] = useState(false);
    const [citizenUploads, setCitizenUploads] = useState([]);
    const [roleNotifItems, setRoleNotifItems] = useState([]);
    const [readIds, setReadIds] = useState(() => new Set());
    const [theme, setTheme] = useState(() => localStorage.getItem('roadsense_theme') || 'light');

    const roleNotifRef = useRef(null);
    const citizenNotifRef = useRef(null);
    const helpRef = useRef(null);

    const role = user?.role || "Citizen";

    const { placeholder, identityLabel } = useMemo(() => {
        if (role === "Authority") {
            return {
                placeholder: "Search assigned reports...",
                identityLabel: "Government Authority",
            };
        }
        if (role === "Admin") {
            return {
                placeholder: "",
                identityLabel: "Admin",
            };
        }
        return {
            placeholder: "",
            identityLabel: "Citizen",
        };
    }, [role]);

    useEffect(() => {
        if (role !== "Citizen") return;
        uploadsApi
            .mine()
            .then((res) => {
                const payload = res?.data ?? [];
                const items = Array.isArray(payload) ? payload : payload.uploads || [];
                setCitizenUploads(items);
            })
            .catch(() => setCitizenUploads([]));
    }, [role]);

    // Topbar's role dropdown must surface the SAME notification kinds (and use
    // the SAME prefixed keys: `pa-`, `up-`, `tk-`, `ev-`) as the per-role
    // Notifications page; otherwise the bell badge and the page disagree on
    // what counts as unread.
    useEffect(() => {
        if (role === "Admin") {
            Promise.all([
                adminApi.pendingAuthorities().catch(() => ({ data: [] })),
                adminApi.listUploads().catch(() => ({ data: [] })),
                supportApi.list().catch(() => ({ data: [] })),
            ]).then(([pa, up, t]) => {
                const items = [];
                (pa.data || []).forEach((p) => items.push({
                    id: `pa-${p.user_id}`,
                    title: `Authority pending: ${p.full_name || p.organisation || "Unknown"}`,
                    detail: `${p.organisation || "Unknown organisation"}`,
                    time: p.submitted_at,
                    to: "/admin/officials/verify",
                }));
                // Show ALL recent uploads (not just failed) — admin wants
                // visibility on every new submission. Title/detail vary by
                // status so failed ones still stand out.
                (up.data || []).slice(0, 10).forEach((x) => {
                    const isFailed = x.status === "Failed";
                    items.push({
                        id: `up-${x.upload_id}`,
                        title: isFailed
                            ? `Upload failed: ${x.uploader_name || "Unknown"}`
                            : `New upload from ${x.uploader_name || "Unknown"}`,
                        detail: isFailed
                            ? `Pipeline failed for ${(x.upload_id || "").slice(0, 8)}`
                            : `Status: ${x.status} · ${(x.upload_id || "").slice(0, 8)}`,
                        time: x.created_at,
                        to: `/admin/uploads/${x.upload_id}/review`,
                    });
                });
                (t.data || []).slice(0, 10).forEach((tk) => items.push({
                    id: `tk-${tk.ticket_id}`,
                    title: `Support ticket: ${tk.subject}`,
                    detail: `From ${tk.author_name || "Unknown"} · ${tk.status}`,
                    time: tk.created_at,
                    to: `/admin/help?ticket=${tk.ticket_id}`,
                }));
                items.sort((a, b) => new Date(b.time || 0) - new Date(a.time || 0));
                setRoleNotifItems(items.slice(0, 8));
            });
        } else if (role === "Authority") {
            Promise.all([
                authorityApi.events().catch(() => ({ data: [] })),
                supportApi.list().catch(() => ({ data: [] })),
            ]).then(([ev, t]) => {
                const items = [];
                (ev.data || []).slice(0, 30).forEach((e) => items.push({
                    id: `ev-${e.event_id || e._id}`,
                    title: `Pothole #${(e.event_id || "").slice(0, 8)}`,
                    detail: `${e.severity} severity — ${e.lifecycle_status}`,
                    time: e.updated_at || e.created_at,
                    to: `/authority/events/${e.event_id || e._id}/update`,
                }));
                (t.data || []).slice(0, 10).forEach((tk) => items.push({
                    id: `tk-${tk.ticket_id}`,
                    title: `Support ticket: ${tk.subject}`,
                    detail: `From ${tk.author_name || "Citizen"} · ${tk.status}`,
                    time: tk.created_at,
                    to: `/authority/help?ticket=${tk.ticket_id}`,
                }));
                items.sort((a, b) => new Date(b.time || 0) - new Date(a.time || 0));
                setRoleNotifItems(items.slice(0, 8));
            });
        }
    }, [role]);

    useEffect(() => {
        const onOutsideClick = (event) => {
            if (helpRef.current && !helpRef.current.contains(event.target)) {
                setHelpOpen(false);
            }
            if (roleNotifRef.current && !roleNotifRef.current.contains(event.target)) {
                setRoleNotificationsOpen(false);
            }
            if (citizenNotifRef.current && !citizenNotifRef.current.contains(event.target)) {
                setCitizenNotificationsOpen(false);
            }
        };

        document.addEventListener("mousedown", onOutsideClick);
        return () => document.removeEventListener("mousedown", onOutsideClick);
    }, []);

    useEffect(() => {
        document.documentElement.setAttribute('data-theme', theme);
        localStorage.setItem('roadsense_theme', theme);
    }, [theme]);

    // Notification read-state is server-persisted; refetch when the role
    // changes so the badge reflects the freshly-logged-in user. Also refetch
    // on every NOTIFICATIONS_READS_CHANGED event (fired by the notifications
    // pages and the Topbar itself when an item is marked read) so the bell
    // and the page stay in sync without a route change.
    useEffect(() => {
        if (!user) return;
        const refetch = () => {
            notificationsApi.getReads()
                .then((res) => setReadIds(new Set(res?.data?.read_keys || [])))
                .catch(() => setReadIds(new Set()));
        };
        refetch();
        window.addEventListener(NOTIFICATIONS_READS_CHANGED, refetch);
        return () => window.removeEventListener(NOTIFICATIONS_READS_CHANGED, refetch);
    }, [user, role]);

    const markAsRead = (id) => {
        if (!id) return;
        setReadIds((prev) => {
            const next = new Set(prev); next.add(id); return next;
        });
        notificationsApi.markAsRead([id]).catch(() => {});
    };

    const roleUnreadCount = roleNotifItems.filter((item) => !readIds.has(item.id)).length;

    // Citizen notification keys must use the same `up-<id>` prefix as
    // CitizenNotificationsPage so the bell unread count and the page agree.
    // `id` (raw upload_id) is kept for navigation; `key` is what the unread
    // check and the markAsRead call use.
    const citizenNotifications = [...citizenUploads]
        .sort((a, b) => new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at))
        .slice(0, 5)
        .map((upload) => {
            const id = upload.upload_id || upload.id || upload._id;
            const key = id ? `up-${id}` : null;
            return {
                id,
                key,
                title: `Upload ${id?.slice(0, 8) || "unknown"}`,
                status: upload.status,
                unread: key ? !readIds.has(key) : false,
            };
        });
    const unreadCount = citizenNotifications.filter((item) => item.unread).length;

    const totalUnread = role === "Citizen" ? unreadCount : roleUnreadCount;

    const showIdentityBlock = role === "Admin" || role === "Authority";
    const showSearch = false;
    const identityName = role === "Authority" ? user?.email : user?.full_name;

    const roleNotificationLinks = role === "Admin"
        ? [
            { to: "/admin/approval", title: "Verification queue", detail: "Review pending authority requests" },
            { to: "/admin/reports", title: "Report updates", detail: "Check latest report activity" },
            { to: "/admin/uploads", title: "Upload processing", detail: "Inspect processing status and failures" },
        ]
        : [
            { to: "/authority/events", title: "Assigned report updates", detail: "Open your active pothole reports" },
            { to: "/authority/dashboard", title: "Dashboard alerts", detail: "Review status summary changes" },
            { to: "/authority/analytics", title: "Performance insights", detail: "Check response trend updates" },
        ];

    const roleHelpLinks = role === "Admin"
        ? [
            { to: "/admin/dashboard", label: "Dashboard help", note: "Stats, health cards, and quick actions" },
            { to: "/admin/approval", label: "Verification help", note: "Approve or reject authority registrations" },
            { to: "/admin/reports", label: "Reports help", note: "Filter and inspect all pothole reports" },
        ]
        : [
            { to: "/authority/dashboard", label: "Dashboard help", note: "Assigned workload and summary insights" },
            { to: "/authority/events", label: "Reports help", note: "Update lifecycle status for assigned events" },
            { to: "/authority/profile", label: "Profile help", note: "Manage your account information" },
        ];

    const onHelpClick = () => {
        if (role === "Citizen") {
            navigate("/citizen/help");
        } else if (role === "Authority") {
            navigate("/authority/help");
        } else if (role === "Admin") {
            navigate("/admin/help");
        }
    };

    const onNotificationsClick = () => {
        if (role === "Citizen") {
            setCitizenNotificationsOpen((prev) => !prev);
            setHelpOpen(false);
            return;
        }
        setRoleNotificationsOpen((prev) => !prev);
        setHelpOpen(false);
    };

    const openProfile = () => {
        if (role === "Citizen") navigate("/citizen/profile");
        else if (role === "Authority") navigate("/authority/profile");
        else navigate("/admin/profile");
    };

    const avatarLetter = (user?.full_name || user?.email || "?").charAt(0).toUpperCase();

    return (
        <header className="top-header">
            {showSearch ? (
                <div className="topbar-search">
                    <span className="topbar-search-icon" aria-hidden="true"><IconSearch size={16} /></span>
                    <input type="text" placeholder={placeholder} aria-label="Global search" readOnly />
                </div>
            ) : (
                <div className="topbar-citizen-spacer" />
            )}

            <div className="header-right">
                <div className="theme-toggle">
                    <div
                        className={`sun-wrapper${theme === "light" ? " active" : ""}`}
                        onClick={() => setTheme("light")}
                        title="Light mode"
                    >
                        <i className="fa-solid fa-sun" />
                    </div>
                    <div
                        className={`moon-wrapper${theme === "dark" ? " active" : ""}`}
                        onClick={() => setTheme("dark")}
                        title="Dark mode"
                    >
                        <i className="fa-solid fa-moon" />
                    </div>
                </div>

                <div className="header-help" onClick={onHelpClick} role="button" tabIndex={0}>
                    <i className="fa-regular fa-circle-question" />
                </div>
                {role !== "Citizen" && helpOpen && (
                    <div ref={helpRef} className="topbar-help-wrap">
                        <div className="topbar-help-popover">
                            <div className="topbar-notification-title">Quick Help</div>
                            <div className="topbar-notification-list">
                                {roleHelpLinks.map((item) => (
                                    <Link key={item.to} to={item.to} className="topbar-notification-item" onClick={() => setHelpOpen(false)}>
                                        <div style={{ fontWeight: 700 }}>{item.label}</div>
                                        <div style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>{item.note}</div>
                                    </Link>
                                ))}
                            </div>
                        </div>
                    </div>
                )}

                <div ref={role === "Citizen" ? citizenNotifRef : roleNotifRef} className="header-notifications" onClick={onNotificationsClick} role="button" tabIndex={0}>
                    <div className="icon-with-badge">
                        <i className="fa-regular fa-bell" />
                        {totalUnread > 0 && <span className="header-badge-dot" />}
                    </div>

                    {role === "Citizen" && citizenNotificationsOpen && (
                        <div className="topbar-notification-popover">
                            <div className="topbar-notification-title" style={{ color: "var(--text-main)", fontWeight: 700 }}>Recent Notifications</div>
                            {citizenNotifications.length === 0 ? (
                                <div className="topbar-notification-empty">No updates yet.</div>
                            ) : (
                                <div className="topbar-notification-list">
                                    {citizenNotifications.map((item) => (
                                        <Link
                                            key={item.id || item.title}
                                            to={item.id ? `/uploads/${item.id}/status` : "/uploads/mine"}
                                            className="topbar-notification-item"
                                            onClick={() => { if (item.key) markAsRead(item.key); setCitizenNotificationsOpen(false); }}
                                        >
                                            <div style={{ fontWeight: item.unread ? 600 : 400, fontSize: "0.82rem", color: item.unread ? "var(--text-main)" : "var(--text-muted)" }}>{item.title}</div>
                                            <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>Status: {item.status}</div>
                                        </Link>
                                    ))}
                                </div>
                            )}
                            <Link to="/citizen/notifications" className="topbar-notification-footer" onClick={() => setCitizenNotificationsOpen(false)}>
                                View all
                            </Link>
                        </div>
                    )}

                    {role !== "Citizen" && roleNotificationsOpen && (
                        <div className="topbar-notification-popover">
                            <div className="topbar-notification-title" style={{ color: "var(--text-main)", fontWeight: 700 }}>Notifications</div>
                            {roleNotifItems.length === 0 ? (
                                <div className="topbar-notification-empty">No notifications yet.</div>
                            ) : (
                                <div className="topbar-notification-list">
                                    {roleNotifItems.map((item) => {
                                        const isRead = readIds.has(item.id);
                                        return (
                                        <Link
                                            key={item.id}
                                            to={item.to}
                                            className="topbar-notification-item"
                                            style={isRead ? {} : { background: "#f0f4ff" }}
                                            onClick={() => { markAsRead(item.id); setRoleNotificationsOpen(false); }}
                                        >
                                            <div style={{ fontWeight: isRead ? 400 : 600, fontSize: "0.82rem", color: isRead ? "var(--text-muted)" : "var(--text-main)" }}>{item.title}</div>
                                            <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>{item.detail}</div>
                                            {item.time && <div style={{ fontSize: "0.7rem", color: "var(--text-muted)", marginTop: "0.15rem" }}>{new Date(item.time).toLocaleString()}</div>}
                                        </Link>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {showIdentityBlock && (
                    <div className="topbar-identity">
                        <div className="topbar-identity-name">{identityName || "User"}</div>
                        <div className="topbar-identity-role">{identityLabel}</div>
                    </div>
                )}

                {user?.avatar_path ? (
                    <img src={user.avatar_path} alt="Profile" className="header-avatar" onClick={openProfile} />
                ) : (
                    <img src={defaultAvatar} alt="Profile" className="header-avatar" onClick={openProfile} />
                )}
            </div>
        </header>
    );
}
