/**
 * Role-aware sidebar navigation for the Citizen / Authority / Admin shells.
 *
 * Renders the active route's nav items, a flat user card at the bottom, and
 * KPI widgets (SystemStatus / Zone overview) for Admin and Authority roles.
 * The icon set is shared across roles via the ICONS map.
 */
import { useEffect, useState, useMemo } from "react";
import { Link, useLocation } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import { authorityApi, adminApi, NOTIFICATIONS_READS_CHANGED } from "../../api/client";
import logo from "../../assets/logo.png";
import defaultAvatar from "../../assets/default-avatar.svg";

const ICONS = {
    dashboard: <i className="fa-solid fa-table-cells-large" />,
    report: <i className="fa-regular fa-pen-to-square" />,
    reports: <i className="fa-regular fa-file-lines" />,
    map: <i className="fa-regular fa-map" />,
    notifications: <i className="fa-regular fa-bell" />,
    profile: <i className="fa-regular fa-user" />,
    help: <i className="fa-regular fa-circle-question" />,
    users: <i className="fa-solid fa-users" />,
    approval: <i className="fa-solid fa-user-check" />,
    analytics: <i className="fa-solid fa-chart-line" />,
    events: <i className="fa-regular fa-clipboard" />,
    mapPin: <i className="fa-solid fa-location-dot" />,
};

function buildNavItems(role, isLeader = false) {
    if (role === "Admin") {
        return [
            { key: "dashboard", path: "/admin/dashboard", icon: "dashboard", label: "Dashboard", desc: "Overview & Stats" },
            { key: "users", path: "/admin/users", icon: "users", label: "User Management", desc: "Manage All Users" },
            { key: "approval", path: "/admin/officials/verify", icon: "approval", label: "Verify Officials", desc: "Approve Pending", highlight: true },
            { key: "zones", path: "/admin/zones", icon: "map", label: "Zone Management", desc: "Manage Zones" },
            { key: "reports", path: "/admin/reports", icon: "reports", label: "Report Processing", desc: "Pipeline Review", highlightGreen: true },
            { key: "map", path: "/map", icon: "mapPin", label: "Interactive Map", desc: "Explore Issues" },
            { key: "profile", path: "/admin/profile", icon: "profile", label: "Profile", desc: "Settings & Info" },
            { key: "notifications", path: "/admin/notifications", icon: "notifications", label: "Notifications", desc: "Updates & Alerts" },
            { key: "help", path: "/admin/help", icon: "help", label: "Help Center", desc: "Support & Guides" },
        ];
    }

    if (role === "Authority") {
        const items = [
            { key: "dashboard", path: "/authority/dashboard", icon: "dashboard", label: "Dashboard", desc: "Overview & Stats" },
            { key: "events", path: "/authority/events", icon: "events", label: "Assigned Reports", desc: "Manage Issues", highlight: true },
        ];
        if (isLeader) {
            items.push({ key: "team", path: "/authority/team", icon: "users", label: "Team Management", desc: "Manage Team" });
        }
        items.push(
            { key: "analytics", path: "/authority/analytics", icon: "analytics", label: "Analytics & Insights", desc: "Performance Data" },
            { key: "map", path: "/map", icon: "mapPin", label: "Interactive Map", desc: "Explore Issues" },
            { key: "profile", path: "/authority/profile", icon: "profile", label: "My Profile", desc: "Account Settings" },
            { key: "notifications", path: "/authority/notifications", icon: "notifications", label: "Notifications", desc: "Updates & Alerts" },
            { key: "help", path: "/authority/help", icon: "help", label: "Help Center", desc: "Support & Guides" },
        );
        return items;
    }

    return [
        { key: "dashboard", path: "/uploads/mine", icon: "dashboard", label: "Dashboard", desc: "Overview & Stats" },
        { key: "report", path: "/upload", icon: "report", label: "Report Issue", desc: "Submit New Report", highlight: true },
        { key: "reports", path: "/citizen/reports", icon: "reports", label: "My Reports", desc: "Track Submissions" },
        { key: "map", path: "/citizen/map", icon: "map", label: "Interactive Map", desc: "Nearby Issues" },
        { key: "notifications", path: "/citizen/notifications", icon: "notifications", label: "Notifications", desc: "Updates & Alerts" },
        { key: "profile", path: "/citizen/profile", icon: "profile", label: "Profile", desc: "Settings & Info" },
        { key: "help", path: "/citizen/help", icon: "help", label: "Help Center", desc: "Support & FAQs" },
    ];
}

function isItemActive(itemKey, path, pathname, role) {
    if (role === "Citizen") {
        if (itemKey === "dashboard") return pathname === "/uploads/mine";
        if (itemKey === "report") return pathname === "/upload" || pathname === "/citizen/report-issue";
        if (itemKey === "reports") return pathname === "/citizen/reports" || pathname.startsWith("/citizen/reports/");
        if (itemKey === "map") return pathname === "/map" || pathname.startsWith("/citizen/map");
        if (itemKey === "notifications") return pathname.startsWith("/citizen/notifications");
        if (itemKey === "profile") return pathname.startsWith("/citizen/profile");
        if (itemKey === "help") return pathname.startsWith("/citizen/help");
    }

    if (role === "Admin") {
        if (itemKey === "approval") return pathname.startsWith("/admin/approval") || pathname.startsWith("/admin/officials/verify");
        if (itemKey === "zones") return pathname.startsWith("/admin/zones");
        if (itemKey === "teams") return pathname.startsWith("/admin/teams");
        if (itemKey === "reports") return pathname.startsWith("/admin/uploads") || pathname.startsWith("/admin/reports");
        if (itemKey === "map") return pathname === "/map";
        if (itemKey === "profile") return pathname.startsWith("/admin/profile");
        if (itemKey === "notifications") return pathname.startsWith("/admin/notifications");
        if (itemKey === "help") return pathname.startsWith("/admin/help");
    }
    if (role === "Authority") {
        if (itemKey === "team") return pathname.startsWith("/authority/team");
        if (itemKey === "map") return pathname === "/map";
        if (itemKey === "notifications") return pathname.startsWith("/authority/notifications");
        if (itemKey === "help") return pathname.startsWith("/authority/help");
    }

    return pathname.startsWith(path);
}

export default function Sidebar() {
    const { user, logout } = useAuth();
    const location = useLocation();
    const role = user?.role || "Citizen";

    const portalName = role === "Admin" ? "Admin Panel" : role === "Authority" ? "Authority Portal" : "Citizen Portal";

    const [isLeader, setIsLeader] = useState(false);
    useEffect(() => {
        if (role === "Authority") {
            authorityApi.myTeam().then((res) => {
                setIsLeader(res.data?.is_leader || false);
            }).catch(() => {});
        }
    }, [role]);

    const navItems = useMemo(() => buildNavItems(role, isLeader), [role, isLeader]);

    // Bumping `readsTick` from the NOTIFICATIONS_READS_CHANGED event re-runs
    // the hasUnread effect below so the red dot disappears the instant a
    // user marks the last unread notification as read (whether from the
    // Topbar dropdown or the Notifications page).
    const [readsTick, setReadsTick] = useState(0);
    useEffect(() => {
        const bump = () => setReadsTick((t) => t + 1);
        window.addEventListener(NOTIFICATIONS_READS_CHANGED, bump);
        return () => window.removeEventListener(NOTIFICATIONS_READS_CHANGED, bump);
    }, []);

    const [hasUnread, setHasUnread] = useState(false);
    useEffect(() => {
        // Notification keys are role-specific (citizen surfaces uploads + own
        // ticket activity; admin surfaces approvals + failed uploads + tickets;
        // authority surfaces events + tickets). Read-state lives server-side
        // under /api/notifications/reads, fetched once per role change.
        const fetchReads = () =>
            import("../../api/client").then(({ notificationsApi }) =>
                notificationsApi.getReads()
                    .then((r) => new Set(r?.data?.read_keys || []))
                    .catch(() => new Set())
            );

        if (role === "Citizen") {
            import("../../api/client").then(({ uploadsApi, supportApi }) => {
                Promise.all([
                    uploadsApi.mine().catch(() => ({ data: [] })),
                    supportApi.listMine().catch(() => ({ data: [] })),
                    fetchReads(),
                ]).then(([u, t, readIds]) => {
                    const uploads = Array.isArray(u?.data) ? u.data : [];
                    const tickets = Array.isArray(t?.data) ? t.data : [];
                    const ids = [];
                    uploads.forEach((up) => {
                        const id = up.upload_id || up.id || up._id;
                        if (id) ids.push(`up-${id}`);
                    });
                    tickets.forEach((tk) => {
                        (tk.status_history || []).forEach((h, idx) => { if (h.from) ids.push(`tk-${tk.ticket_id}-status-${idx}`); });
                        (tk.responses || []).forEach((r, idx) => {
                            if (r.author_id !== tk.created_by_user_id) ids.push(`tk-${tk.ticket_id}-reply-${idx}`);
                        });
                    });
                    setHasUnread(ids.some((id) => !readIds.has(id)));
                });
            });
        } else if (role === "Admin") {
            import("../../api/client").then(({ adminApi, supportApi }) => {
                Promise.all([
                    adminApi.pendingAuthorities().catch(() => ({ data: [] })),
                    adminApi.listUploads().catch(() => ({ data: [] })),
                    supportApi.list().catch(() => ({ data: [] })),
                    fetchReads(),
                ]).then(([pa, up, t, readIds]) => {
                    const ids = [];
                    (pa.data || []).forEach((p) => ids.push(`pa-${p.user_id}`));
                    // Match AdminNotificationsPage + Topbar: surface ALL recent
                    // uploads, not just Failed ones, so the sidebar dot lights
                    // up for new submissions too.
                    (up.data || []).slice(0, 10).forEach((x) => ids.push(`up-${x.upload_id}`));
                    (t.data || []).slice(0, 10).forEach((tk) => ids.push(`tk-${tk.ticket_id}`));
                    setHasUnread(ids.some((id) => !readIds.has(id)));
                });
            });
        } else if (role === "Authority") {
            import("../../api/client").then(({ authorityApi, supportApi }) => {
                Promise.all([
                    authorityApi.events().catch(() => ({ data: [] })),
                    supportApi.list().catch(() => ({ data: [] })),
                    fetchReads(),
                ]).then(([ev, t, readIds]) => {
                    const ids = [];
                    (ev.data || []).slice(0, 30).forEach((e) => ids.push(`ev-${e.event_id || e._id}`));
                    (t.data || []).slice(0, 10).forEach((tk) => ids.push(`tk-${tk.ticket_id}`));
                    setHasUnread(ids.some((id) => !readIds.has(id)));
                });
            });
        }
    }, [role, readsTick]);

    const [sidebarKpi, setSidebarKpi] = useState(null);
    useEffect(() => {
        if (role === "Authority") {
            authorityApi.events().then((res) => {
                const evts = res.data || [];
                const total = evts.length;
                const resolved = evts.filter((e) => e.lifecycle_status === "Resolved" || e.lifecycle_status === "Closed").length;
                const active = evts.filter((e) => ["Reported", "UnderReview", "Scheduled"].includes(e.lifecycle_status)).length;
                setSidebarKpi({ efficiency: total > 0 ? Math.round((resolved / total) * 100) : 0, active });
            }).catch(() => {});
        } else if (role === "Admin") {
            adminApi.stats().then((res) => {
                const d = res.data;
                const backendOk = true;
                const uploadsHealthy = (d?.uploads?.processing || 0) < 20 && (d?.uploads?.failed || 0) < (d?.uploads?.total || 1) * 0.5;
                setSidebarKpi({ healthy: backendOk && uploadsHealthy, failedUploads: d?.uploads?.failed || 0, totalUploads: d?.uploads?.total || 0 });
            }).catch(() => setSidebarKpi({ healthy: false, failedUploads: 0, totalUploads: 0 }));
        }
    }, [role]);

    return (
        <aside className="sidebar">
            <Link to={role === "Admin" ? "/admin/dashboard" : role === "Authority" ? "/authority/dashboard" : "/uploads/mine"} className="logo-area" style={{ textDecoration: "none" }}>
                <div className="logo-icon-wrapper">
                    <img src={logo} alt="RoadSenseAI" />
                </div>
                <div className="logo-text">
                    <h1>RoadSenseAI</h1>
                    <span>{portalName}</span>
                </div>
            </Link>

            {(role === "Admin" || role === "Authority") && (
                <div className="sidebar-identity-card">
                    {user?.avatar_path ? (
                        <img src={user.avatar_path} alt="" className="sidebar-identity-avatar" style={{ width: 36, height: 36, borderRadius: "50%", objectFit: "cover" }} />
                    ) : (
                        <div className="sidebar-identity-avatar">{user?.full_name?.charAt(0)?.toUpperCase() || "U"}</div>
                    )}
                    <div>
                        <div className="sidebar-identity-name">{role === "Authority" ? user?.email : user?.full_name}</div>
                        <div className="sidebar-identity-sub">{role === "Authority" ? "Government Authority" : "System Administrator"}</div>
                    </div>
                </div>
            )}

            <ul className="main-nav">
                {navItems.map((item) => {
                    const active = isItemActive(item.key, item.path, location.pathname, role);
                    return (
                        <li key={item.key} className={active ? "active" : ""}>
                            <Link to={item.path}>
                                {item.key === "notifications" ? (
                                    <div className="nav-item-content">
                                        <div className="icon-with-badge">
                                            <span className="nav-i">{ICONS[item.icon] || ICONS.dashboard}</span>
                                            {hasUnread && <span className="sidebar-badge-dot" />}
                                        </div>
                                        {item.label}
                                    </div>
                                ) : (
                                    <>
                                        <span className="nav-i">{ICONS[item.icon] || ICONS.dashboard}</span>
                                        {item.label}
                                    </>
                                )}
                            </Link>
                        </li>
                    );
                })}
            </ul>

            {(role === "Admin" || role === "Authority") && sidebarKpi && (
                <div className="sidebar-kpi-panel">
                    {role === "Admin" ? (
                        <div className="sidebar-status-card">
                            <div className="sidebar-status-title">System Status</div>
                            <div className="sidebar-status-row">
                                <span>{sidebarKpi.healthy ? "All systems operational" : `${sidebarKpi.failedUploads} of ${sidebarKpi.totalUploads} uploads failed`}</span>
                                <span className="sidebar-status-pill" style={sidebarKpi.healthy ? {} : { background: "#ef4444" }}>{sidebarKpi.healthy ? "Active" : "Degraded"}</span>
                            </div>
                        </div>
                    ) : (
                        <>
                            <div className="sidebar-kpi-card">
                                <span>Efficiency</span>
                                <strong>{sidebarKpi.efficiency}%</strong>
                            </div>
                            <div className="sidebar-kpi-card">
                                <span>Active Cases</span>
                                <strong>{sidebarKpi.active}</strong>
                            </div>
                        </>
                    )}
                </div>
            )}

            <div className="sidebar-bottom">
                {role === "Citizen" && (
                    <Link to="/upload" className="add-btn">
                        + Quick Report
                    </Link>
                )}
                <div className="sidebar-usercard">
                    <div className="sidebar-usercard-info">
                        <div className="avatar-wrapper">
                            {user?.avatar_path ? (
                                <img src={user.avatar_path} alt="Avatar" className="avatar" style={{ width: 40, height: 40 }} />
                            ) : (
                                <img src={defaultAvatar} alt="Avatar" className="avatar" style={{ width: 40, height: 40 }} />
                            )}
                            <span className="online-dot" style={{ width: 10, height: 10, border: "2px solid var(--card-bg, #f3f4f8)" }} />
                        </div>
                        <div className="user-details">
                            <strong>{user?.full_name || "User"}</strong>
                            <span>{user?.email || ""}</span>
                        </div>
                    </div>
                    <button className="sidebar-logout-btn2" onClick={logout}>Logout</button>
                </div>
            </div>
        </aside>
    );
}
