/**
 * Admin user management page.
 *
 * Admin-only user list with role/status filters, pagination, and
 * suspend/reactivate actions. The Official → Authority normalization runs
 * client-side here so legacy "Official" rows display under the canonical
 * Authority role.
 */
import { useState, useEffect, useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { Users, ShieldCheck, Clock, UserCheck, ChevronLeft, ChevronRight } from "lucide-react";
import { adminApi } from "../api/client";

const PAGE_SIZE = 6;

function normalizeRole(role) {
    if (role === "Official") return "Authority";
    return role;
}

export default function AdminUsersPage() {
    const [searchParams] = useSearchParams();
    const [users, setUsers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [search, setSearch] = useState("");
    const [roleFilter, setRoleFilter] = useState(searchParams.get("role") || "");
    const [statusFilter, setStatusFilter] = useState(searchParams.get("status") === "active" ? "active" : "");
    const [suspendModal, setSuspendModal] = useState(null);
    const [suspendReason, setSuspendReason] = useState("");
    const [currentPage, setCurrentPage] = useState(1);
    const [lastUpdated, setLastUpdated] = useState(null);

    const fetchUsers = useCallback(() => {
        setLoading(true);
        setError("");
        const params = {};
        if (roleFilter) params.role = roleFilter;
        if (statusFilter) params.is_active = statusFilter === "active";

        adminApi
            .listUsers(params)
            .then((res) => {
                const list = (res.data || []).map((user) => ({ ...user, role: normalizeRole(user.role) }));
                setUsers(list);
                setLastUpdated(new Date());
            })
            .catch(() => setError("Failed to load users."))
            .finally(() => setLoading(false));
    }, [roleFilter, statusFilter]);

    useEffect(() => { fetchUsers(); }, [fetchUsers]);
    useEffect(() => { setCurrentPage(1); }, [search, roleFilter, statusFilter]);

    const filtered = useMemo(() => {
        if (!search) return users;
        const q = search.toLowerCase();
        return users.filter((user) => {
            const fullName = (user.full_name || "").toLowerCase();
            const email = (user.email || "").toLowerCase();
            return fullName.includes(q) || email.includes(q);
        });
    }, [users, search]);

    const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    const paginatedUsers = useMemo(() => {
        const start = (currentPage - 1) * PAGE_SIZE;
        return filtered.slice(start, start + PAGE_SIZE);
    }, [filtered, currentPage]);

    const totals = useMemo(() => ({
        total: users.length,
        active: users.filter((u) => u.is_active).length,
        pending: users.filter((u) => !u.is_active).length,
        authorities: users.filter((u) => u.role === "Authority").length,
    }), [users]);

    const handleSuspend = async () => {
        if (!suspendModal || !suspendReason.trim()) return;
        try {
            await adminApi.suspendUser(suspendModal, suspendReason.trim());
            setSuspendModal(null);
            setSuspendReason("");
            fetchUsers();
        } catch { setError("Failed to suspend user."); }
    };

    const handleReactivate = async (userId) => {
        try {
            await adminApi.reactivateUser(userId);
            fetchUsers();
        } catch { setError("Failed to reactivate user."); }
    };

    function getVisiblePages() {
        if (totalPages <= 3) return Array.from({ length: totalPages }, (_, i) => i + 1);
        if (currentPage <= 2) return [1, 2, 3];
        if (currentPage >= totalPages - 1) return [totalPages - 2, totalPages - 1, totalPages];
        return [currentPage - 1, currentPage, currentPage + 1];
    }

    return (
        <div className="adm-users-page">
            <div className="adm-users-header">
                <div>
                    <h1 className="adm-users-title"><Users size={22} /> User Management</h1>
                    <p className="adm-users-sub">
                        Manage all citizens and authorities
                        {lastUpdated && <span style={{ opacity: 0.7, fontSize: "0.82rem" }}> · Updated {lastUpdated.toLocaleTimeString()}</span>}
                    </p>
                </div>
                <button className="btn btn-outline" onClick={fetchUsers} type="button">Refresh</button>
            </div>

            {error && <p className="error">{error}</p>}

            {/* ── Stat Cards ── */}
            <div className="adm-users-stats">
                <div className="adm-users-stat adm-ustat-blue adm-stat-click" onClick={() => { setRoleFilter(""); setStatusFilter(""); }}>
                    <div className="adm-ustat-icon adm-icon-blue"><Users size={22} /></div>
                    <div>
                        <span className="adm-ustat-label">Total Users</span>
                        <strong className="adm-ustat-value">{totals.total}</strong>
                    </div>
                </div>
                <div className="adm-users-stat adm-ustat-green adm-stat-click" onClick={() => { setStatusFilter("active"); setRoleFilter(""); }}>
                    <div className="adm-ustat-icon adm-icon-green"><ShieldCheck size={22} /></div>
                    <div>
                        <span className="adm-ustat-label">Active</span>
                        <strong className="adm-ustat-value">{totals.active}</strong>
                    </div>
                </div>
                <div className="adm-users-stat adm-ustat-orange adm-stat-click" onClick={() => { setStatusFilter("inactive"); setRoleFilter(""); }}>
                    <div className="adm-ustat-icon adm-icon-orange"><Clock size={22} /></div>
                    <div>
                        <span className="adm-ustat-label">Pending</span>
                        <strong className="adm-ustat-value">{totals.pending}</strong>
                    </div>
                </div>
                <div className="adm-users-stat adm-ustat-purple adm-stat-click" onClick={() => { setRoleFilter("Authority"); setStatusFilter(""); }}>
                    <div className="adm-ustat-icon adm-icon-purple"><UserCheck size={22} /></div>
                    <div>
                        <span className="adm-ustat-label">Authorities</span>
                        <strong className="adm-ustat-value">{totals.authorities}</strong>
                    </div>
                </div>
            </div>

            {/* ── Search + Filters ── */}
            <div className="adm-users-filters">
                <input
                    className="adm-users-search"
                    type="text"
                    placeholder="Search by name or email..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                />
                <select className="adm-users-select" value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}>
                    <option value="">All Roles</option>
                    <option value="Citizen">Citizen</option>
                    <option value="Authority">Authority</option>
                    <option value="Admin">Admin</option>
                </select>
                <select className="adm-users-select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                    <option value="">All Status</option>
                    <option value="active">Active</option>
                    <option value="inactive">Pending</option>
                </select>
            </div>

            {/* ── Table ── */}
            {loading ? (
                <p className="text-muted" style={{ padding: "1.5rem" }}>Loading users...</p>
            ) : (
                <div className="adm-users-table-card">
                    <div className="adm-users-table-wrap">
                        <table className="adm-table">
                            <thead>
                                <tr>
                                    <th>User</th>
                                    <th>Email</th>
                                    <th>Role</th>
                                    <th>Status</th>
                                    <th>Joined</th>
                                    <th>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {paginatedUsers.map((user) => (
                                    <tr key={user.user_id}>
                                        <td>
                                            <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                                                <div className="user-avatar-sm">{(user.full_name || "?").charAt(0).toUpperCase()}</div>
                                                <div>
                                                    <div style={{ fontWeight: 600 }}>{user.full_name || "Unknown"}</div>
                                                    <div style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>ID: {(user.user_id || "").slice(0, 8)}</div>
                                                </div>
                                            </div>
                                        </td>
                                        <td>{user.email}</td>
                                        <td>
                                            <span className={`role-badge role-${(user.role || "").toLowerCase()}`}>
                                                {(user.role || "").toLowerCase()}
                                            </span>
                                        </td>
                                        <td>
                                            <span className={`status-pill ${user.is_active ? "status-active" : "status-pending"}`}>
                                                {user.is_active ? "active" : "pending"}
                                            </span>
                                        </td>
                                        <td>{user.created_at ? new Date(user.created_at).toLocaleDateString() : "-"}</td>
                                        <td>
                                            {user.role !== "Admin" && (
                                                user.is_active ? (
                                                    <button className="btn btn-outline btn-sm" style={{ fontSize: "0.75rem", color: "#ef4444", borderColor: "#ef4444" }} onClick={() => setSuspendModal(user.user_id)}>Suspend</button>
                                                ) : (
                                                    <button className="btn btn-outline btn-sm" style={{ fontSize: "0.75rem", color: "#16a34a", borderColor: "#16a34a" }} onClick={() => handleReactivate(user.user_id)}>Reactivate</button>
                                                )
                                            )}
                                        </td>
                                    </tr>
                                ))}
                                {filtered.length === 0 && (
                                    <tr><td colSpan={6} style={{ textAlign: "center", color: "var(--text-muted)", padding: "1.5rem" }}>No users match the current filters.</td></tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                    {totalPages > 1 && (
                        <div className="ref-pagination" style={{ margin: "1.25rem auto 1.5rem" }}>
                            <button className="ref-page-link" disabled={currentPage === 1} onClick={() => setCurrentPage((p) => p - 1)}>
                                <ChevronLeft size={16} /> Prev
                            </button>
                            {getVisiblePages().map((p) => (
                                <button key={p} className={`ref-page-num${p === currentPage ? " active" : ""}`} onClick={() => setCurrentPage(p)}>
                                    {p}
                                </button>
                            ))}
                            <button className="ref-page-link" disabled={currentPage === totalPages} onClick={() => setCurrentPage((p) => p + 1)}>
                                Next <ChevronRight size={16} />
                            </button>
                        </div>
                    )}
                </div>
            )}

            {suspendModal && (
                <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
                    <div className="card" style={{ width: "100%", maxWidth: "420px" }}>
                        <div className="card-content">
                            <h2 style={{ marginBottom: "0.75rem" }}>Suspend User</h2>
                            <div className="form-group">
                                <label className="form-label">Reason for suspension</label>
                                <textarea className="form-control" rows={3} value={suspendReason} onChange={(e) => setSuspendReason(e.target.value)} placeholder="Enter reason..." />
                            </div>
                            <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
                                <button className="btn btn-outline" onClick={() => { setSuspendModal(null); setSuspendReason(""); }}>Cancel</button>
                                <button className="btn btn-primary" style={{ background: "#ef4444" }} disabled={!suspendReason.trim()} onClick={handleSuspend}>Suspend</button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
