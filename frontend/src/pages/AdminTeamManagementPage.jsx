/**
 * Admin team management page.
 *
 * Admin-only teams CRUD with leader assignment and member management. Each
 * team is bound to a zone; team leaders can manage support tickets routed
 * to that zone. Add/remove members, transfer leadership, and delete teams
 * via /api/admin/teams.
 */
import { useEffect, useState, useMemo } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { Users, MapPin, ChevronLeft, ChevronRight, Trash2, Crown, UserPlus } from "lucide-react";
import { adminApi } from "../api/client";

const PAGE_SIZE = 3;
const COLORS = ["#10b981", "#3b82f6", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899"];

function getInitial(name) { return (name || "?").charAt(0).toUpperCase(); }

export default function AdminTeamManagementPage() {
    const [searchParams] = useSearchParams();
    const [teams, setTeams] = useState([]);
    const [zones, setZones] = useState([]);
    const [officials, setOfficials] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [showCreate, setShowCreate] = useState(false);
    const [newTeamName, setNewTeamName] = useState("");
    const [newTeamZone, setNewTeamZone] = useState("");
    const [creating, setCreating] = useState(false);
    const [search, setSearch] = useState("");
    const [zoneFilter, setZoneFilter] = useState(searchParams.get("zone") || "");
    const [currentPage, setCurrentPage] = useState(1);
    const [leaderModal, setLeaderModal] = useState(null); // { teamId, teamName, members }
    const [unassignModal, setUnassignModal] = useState(null); // { teamId, userId, fullName }

    const fetchAll = async () => {
        setLoading(true);
        try {
            const [t, z, u] = await Promise.all([
                adminApi.listTeams(), adminApi.listZones(), adminApi.listUsers({ role: "Authority" }),
            ]);
            setTeams(t.data || []); setZones(z.data || []);
            setOfficials((u.data || []).filter((o) => o.is_active));
        } catch { setError("Failed to load data."); } finally { setLoading(false); }
    };

    useEffect(() => { fetchAll(); }, []);
    useEffect(() => { setCurrentPage(1); }, [search, zoneFilter]);

    const handleCreateTeam = async (e) => {
        e.preventDefault();
        if (!newTeamName.trim() || !newTeamZone) {
            setError("Team name and zone are both required.");
            return;
        }
        setCreating(true); setError("");
        try {
            await adminApi.createTeam({ name: newTeamName.trim(), zone_id: newTeamZone });
            setNewTeamName(""); setNewTeamZone(""); setShowCreate(false); fetchAll();
        } catch (err) { setError(err.response?.data?.detail || "Failed."); }
        finally { setCreating(false); }
    };

    const handleDeleteTeam = async (tid, name) => {
        if (!window.confirm(`Delete team "${name}"?`)) return;
        try { await adminApi.deleteTeam(tid); fetchAll(); } catch { setError("Failed."); }
    };

    const handleAddMember = async (tid, uid) => {
        try { await adminApi.addTeamMember(tid, uid); fetchAll(); } catch (err) { setError(err.response?.data?.detail || "Failed."); }
    };

    const handleRemoveMember = async (tid, uid) => {
        try { await adminApi.removeTeamMember(tid, uid); fetchAll(); } catch { setError("Failed."); }
    };

    const handleSetLeader = async (teamId, userId) => {
        try { await adminApi.setTeamLeader(teamId, userId); setLeaderModal(null); fetchAll(); }
        catch (err) { setError(err.response?.data?.detail || "Failed."); setLeaderModal(null); }
    };

    const openLeaderModal = (team) => {
        const nonLeaderMembers = team.members.filter(m => !m.is_leader);
        setLeaderModal({ teamId: team.team_id, teamName: team.name, members: nonLeaderMembers });
    };

    const assignedIds = new Set(teams.flatMap((t) => t.member_ids || []));
    const unassigned = officials.filter((o) => !assignedIds.has(o.user_id));
    const totalMembers = teams.reduce((s, t) => s + (t.members?.length || 0), 0);

    const filtered = useMemo(() => {
        let list = [...teams];
        if (search) {
            const q = search.toLowerCase();
            list = list.filter(t => (t.name || "").toLowerCase().includes(q) || (t.zone_name || "").toLowerCase().includes(q));
        }
        if (zoneFilter) list = list.filter(t => t.zone_name === zoneFilter);
        return list;
    }, [teams, search, zoneFilter]);

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

    const zoneNames = [...new Set(teams.map(t => t.zone_name).filter(Boolean))];

    return (
        <div className="tm-page">
            <div className="tm-header">
                <div>
                    <h1 className="tm-title"><Users size={24} /> Team Management</h1>
                    <p className="tm-sub">Manage your team members, assign leaders, and handle team assignments</p>
                </div>
                <div style={{ display: "flex", gap: "0.5rem" }}>
                    <Link to="/admin/zones" className="btn btn-outline">Back to Zone Management</Link>
                    <button className="btn btn-primary" onClick={() => setShowCreate(!showCreate)}>+ New Team</button>
                </div>
            </div>

            {error && <p className="error">{error}</p>}

            {/* Stats */}
            <div className="tm-stats">
                <div className="tm-stat">
                    <div className="tm-stat-icon" style={{ background: "#dbeafe", color: "#2563eb" }}><MapPin size={22} /></div>
                    <div><span className="tm-stat-label">Total Teams</span><strong className="tm-stat-value">{teams.length}</strong></div>
                </div>
                <div className="tm-stat">
                    <div className="tm-stat-icon" style={{ background: "#dcfce7", color: "#16a34a" }}><Users size={22} /></div>
                    <div><span className="tm-stat-label">Active Members</span><strong className="tm-stat-value">{totalMembers}</strong></div>
                </div>
                <div className="tm-stat">
                    <div className="tm-stat-icon" style={{ background: "#fef3c7", color: "#d97706" }}><UserPlus size={22} /></div>
                    <div><span className="tm-stat-label">Unassigned Members</span><strong className="tm-stat-value">{unassigned.length}</strong></div>
                </div>
                <div className="tm-stat">
                    <div className="tm-stat-icon" style={{ background: "#ede9fe", color: "#7c3aed" }}><MapPin size={22} /></div>
                    <div><span className="tm-stat-label">Zones</span><strong className="tm-stat-value">{zones.length}</strong></div>
                </div>
            </div>

            {showCreate && (
                <div className="tm-create-card">
                    <h2>Create New Team</h2>
                    <form onSubmit={handleCreateTeam}>
                        <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", marginBottom: "0.75rem" }}>
                            <input className="adm-users-search" style={{ flex: 1, minWidth: "180px" }} placeholder="Team name" value={newTeamName} onChange={(e) => setNewTeamName(e.target.value)} />
                            <select className="adm-users-select" style={{ minWidth: "200px" }} value={newTeamZone} onChange={(e) => setNewTeamZone(e.target.value)}>
                                <option value="">Select zone...</option>
                                {zones.map((z) => <option key={z.zone_id} value={z.zone_id}>{z.name}</option>)}
                            </select>
                        </div>
                        <div style={{ display: "flex", gap: "0.5rem" }}>
                            <button className="btn btn-primary" type="submit" disabled={creating}>{creating ? "Creating..." : "Create Team"}</button>
                            <button className="btn btn-outline" type="button" onClick={() => setShowCreate(false)}>Cancel</button>
                        </div>
                    </form>
                </div>
            )}

            {/* Search + Filter */}
            <div className="tm-toolbar">
                <input className="tm-search" type="text" placeholder="Search teams by name or zone..." value={search} onChange={(e) => setSearch(e.target.value)} />
                <select className="tm-zone-select" value={zoneFilter} onChange={(e) => setZoneFilter(e.target.value)}>
                    <option value="">All Zones</option>
                    {zoneNames.map(z => <option key={z} value={z}>{z}</option>)}
                </select>
            </div>

            {/* Team Cards */}
            {loading ? <p className="text-muted" style={{ padding: "1.5rem" }}>Loading teams...</p> : (
                <div className="tm-list">

                    {paginated.length === 0 ? (
                        <div className="tm-empty">No teams found.</div>
                    ) : paginated.map((team, ti) => {
                        const color = COLORS[ti % COLORS.length];
                        const leader = team.members.find(m => m.is_leader);
                        const activeMembers = team.members.filter(m => !m.is_leader);
                        const teamUnassigned = unassigned;

                        return (
                            <div key={team.team_id} className="tm-card">
                                {/* Card Header */}
                                <div className="tm-card-head">
                                    <div className="tm-card-info">
                                        <div className="tm-card-icon" style={{ background: `${color}20`, color }}><MapPin size={22} /></div>
                                        <div>
                                            <strong className="tm-card-name">{team.name}</strong>
                                            <span className="tm-card-zone">Zone: {team.zone_name} · {team.members.length} members</span>
                                        </div>
                                    </div>
                                    <div className="tm-card-badges">
                                        <div className="tm-badge tm-badge-green"><strong>{team.members.length}</strong><span>Active Members</span></div>
                                        <div className="tm-badge tm-badge-amber"><strong>{teamUnassigned.length}</strong><span>Unassigned</span></div>
                                        <div className="tm-badge tm-badge-blue"><strong>{leader ? 1 : 0}</strong><span>Team Leader</span></div>
                                    </div>
                                    <div className="tm-card-actions">
                                        <button className="tm-action-btn" onClick={() => openLeaderModal(team)}><Crown size={14} /> Set Team Leader</button>
                                        <button className="tm-action-btn tm-action-danger" onClick={() => handleDeleteTeam(team.team_id, team.name)}><Trash2 size={14} /> Delete Team</button>
                                    </div>
                                </div>

                                {/* Card Body — Members Grid */}
                                <div className="tm-card-body">
                                    <div className="tm-section tm-section-leader">
                                        <div className="tm-section-title"><Crown size={14} style={{ color: "#f59e0b" }} /> Team Leader</div>
                                        {leader ? (
                                            <div className="tm-member">
                                                <div className="tm-member-avatar" style={{ background: "#3b82f6" }}>{getInitial(leader.full_name)}</div>
                                                <div className="tm-member-info">
                                                    <strong>{leader.full_name}</strong>
                                                    <span>{leader.email}</span>
                                                </div>
                                                {leader.is_active !== false
                                                    ? <span className="tm-active-badge">Active</span>
                                                    : <span className="tm-suspended-badge">Suspended</span>}
                                            </div>
                                        ) : <p className="tm-none">No leader assigned</p>}
                                    </div>

                                    <div className="tm-section">
                                        <div className="tm-section-title"><span className="tm-dot-green" /> Active Members ({activeMembers.length})</div>
                                        {activeMembers.length > 0 ? activeMembers.map(m => (
                                            <div key={m.user_id} className="tm-member tm-member-clickable" onClick={() => setUnassignModal({ teamId: team.team_id, userId: m.user_id, fullName: m.full_name })}>
                                                <div className="tm-member-avatar" style={{ background: "#94a3b8" }}>{getInitial(m.full_name)}</div>
                                                <div className="tm-member-info">
                                                    <strong>{m.full_name}</strong>
                                                    <span>{m.email}</span>
                                                </div>
                                                {m.is_active !== false
                                                    ? <span className="tm-active-badge">Active</span>
                                                    : <span className="tm-suspended-badge">Suspended</span>}
                                            </div>
                                        )) : <p className="tm-none">No active members</p>}
                                    </div>

                                    <div className="tm-section">
                                        <div className="tm-section-title"><Users size={14} style={{ color: "#94a3b8" }} /> Unassigned ({teamUnassigned.length})</div>
                                        {teamUnassigned.length > 0 ? teamUnassigned.slice(0, 3).map(o => (
                                            <div key={o.user_id} className="tm-member tm-member-unassigned" onClick={() => handleAddMember(team.team_id, o.user_id)}>
                                                <div className="tm-member-avatar" style={{ background: "#cbd5e1" }}>{getInitial(o.full_name)}</div>
                                                <div className="tm-member-info">
                                                    <strong>{o.full_name}</strong>
                                                    <span>{o.email}</span>
                                                </div>
                                            </div>
                                        )) : <p className="tm-none">No unassigned members</p>}
                                    </div>
                                </div>
                            </div>
                        );
                    })}

                    {/* Footer */}
                    <div className="tm-footer">
                        <span className="tm-showing">Showing {((currentPage - 1) * PAGE_SIZE) + 1}–{Math.min(currentPage * PAGE_SIZE, filtered.length)} of {filtered.length} teams</span>
                        {totalPages > 1 && (
                            <div className="ref-pagination" style={{ margin: "0 auto" }}>
                                <button className="ref-page-link" disabled={currentPage === 1} onClick={() => setCurrentPage(p => p - 1)}><ChevronLeft size={16} /></button>
                                {getVisiblePages().map(p => (
                                    <button key={p} className={`ref-page-num${p === currentPage ? " active" : ""}`} onClick={() => setCurrentPage(p)}>{p}</button>
                                ))}
                                <button className="ref-page-link" disabled={currentPage === totalPages} onClick={() => setCurrentPage(p => p + 1)}><ChevronRight size={16} /></button>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Set Leader Modal */}
            {leaderModal && (
                <div className="tm-modal-overlay" onClick={() => setLeaderModal(null)}>
                    <div className="tm-modal" onClick={e => e.stopPropagation()}>
                        <h2><Crown size={18} style={{ color: "#f59e0b", verticalAlign: "middle", marginRight: 6 }} />Set Team Leader — {leaderModal.teamName}</h2>
                        <p className="text-muted" style={{ margin: "0.25rem 0 1rem", fontSize: "0.88rem" }}>Select a member to become the new team leader:</p>
                        {leaderModal.members.length === 0 ? (
                            <p className="text-muted">No other members available.</p>
                        ) : (
                            <div className="tm-modal-list">
                                {leaderModal.members.map(m => (
                                    <button key={m.user_id} className="tm-modal-member" onClick={() => handleSetLeader(leaderModal.teamId, m.user_id)}>
                                        <div className="tm-member-avatar" style={{ background: "#6366f1", width: 36, height: 36, fontSize: "0.85rem" }}>{getInitial(m.full_name)}</div>
                                        <div className="tm-member-info">
                                            <strong>{m.full_name}</strong>
                                            <span>{m.email}</span>
                                        </div>
                                    </button>
                                ))}
                            </div>
                        )}
                        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "1rem" }}>
                            <button className="btn btn-outline" onClick={() => setLeaderModal(null)}>Cancel</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Unassign Modal */}
            {unassignModal && (
                <div className="tm-modal-overlay" onClick={() => setUnassignModal(null)}>
                    <div className="tm-modal" onClick={e => e.stopPropagation()}>
                        <h2>Unassign Member</h2>
                        <p style={{ margin: "0.5rem 0 1.25rem", fontSize: "0.92rem", color: "var(--text-main)", lineHeight: 1.5 }}>
                            Are you sure you want to remove <strong>{unassignModal.fullName}</strong> from this team?
                        </p>
                        <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
                            <button className="btn btn-outline" onClick={() => setUnassignModal(null)}>Cancel</button>
                            <button className="btn btn-primary" style={{ background: "#ef4444", borderColor: "#ef4444" }} onClick={async () => {
                                await handleRemoveMember(unassignModal.teamId, unassignModal.userId);
                                setUnassignModal(null);
                            }}>Unassign</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
