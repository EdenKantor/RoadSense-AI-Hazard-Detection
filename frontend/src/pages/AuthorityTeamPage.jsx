/**
 * Authority Team Management page.
 *
 * Team-leader-only screen (renders an access-denied message if
 * `teamInfo.is_leader` is false). Shows zone-level KPIs (member count,
 * total zone events, unassigned/assigned splits), a paginated grid of
 * team-member cards with each member's per-person assigned-event count,
 * and a tabbed event list that toggles between "Unassigned" and
 * "Assigned" zone events. The leader can assign/reassign/unassign each
 * event via the AssignSelect helper, which calls
 * authorityApi.assignEvent and reloads the page state. Each row links to
 * the AuthorityStatusUpdatePage for the event.
 */

import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { authorityApi } from "../api/client";
import AddressLabel from "../components/AddressLabel";
import { Users, MapPin, Crown, ClipboardList, AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, Eye } from "lucide-react";

const PAGE_SIZE = 5;
const SEV_COLORS = { High: "#ef4444", Medium: "#f59e0b", Low: "#10b981" };
const STATUS_LABELS = { Reported: "Pending", UnderReview: "In Progress", Scheduled: "In Progress", Resolved: "Resolved", Closed: "Closed" };

/** Return the uppercase first letter of a name for avatar initials. */
function getInitial(name) { return (name || "?").charAt(0).toUpperCase(); }

/** Team-leader-only page for managing team membership and assigning zone events. */
export default function AuthorityTeamPage() {
    const [teamInfo, setTeamInfo] = useState(null);
    const [events, setEvents] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [success, setSuccess] = useState("");
    const [currentPage, setCurrentPage] = useState(1);
    const [membersPage, setMembersPage] = useState(1);
    const [viewMode, setViewMode] = useState("unassigned"); // unassigned | assigned

    const fetchData = async () => {
        setLoading(true);
        try {
            const [teamRes, eventsRes] = await Promise.all([authorityApi.myTeam(), authorityApi.events()]);
            setTeamInfo(teamRes.data);
            setEvents(eventsRes.data || []);
        } catch { setError("Failed to load team data."); }
        finally { setLoading(false); }
    };

    useEffect(() => { fetchData(); }, []);
    useEffect(() => { setCurrentPage(1); }, [viewMode]);

    const handleAssign = async (eventId, userId) => {
        setError(""); setSuccess("");
        try {
            await authorityApi.assignEvent(eventId, userId);
            setSuccess(userId ? "Event assigned successfully." : "Event unassigned.");
            fetchData();
        } catch (err) { setError(err.response?.data?.detail || "Failed."); }
    };

    const team = teamInfo?.team;
    const members = team?.members || [];
    const leader = members.find(m => m.is_leader);
    const nonLeaderMembers = members.filter(m => !m.is_leader);
    const unassignedEvents = useMemo(() => events.filter(e => !e.assigned_to), [events]);
    const assignedEvents = useMemo(() => events.filter(e => e.assigned_to), [events]);

    const activeList = viewMode === "unassigned" ? unassignedEvents : assignedEvents;
    const totalPages = Math.max(1, Math.ceil(activeList.length / PAGE_SIZE));
    const paginated = useMemo(() => {
        const start = (currentPage - 1) * PAGE_SIZE;
        return activeList.slice(start, start + PAGE_SIZE);
    }, [activeList, currentPage]);

    function getVisiblePages() {
        if (totalPages <= 3) return Array.from({ length: totalPages }, (_, i) => i + 1);
        if (currentPage <= 2) return [1, 2, 3];
        if (currentPage >= totalPages - 1) return [totalPages - 2, totalPages - 1, totalPages];
        return [currentPage - 1, currentPage, currentPage + 1];
    }

    if (loading) return <div className="auth-team-page"><p className="text-muted" style={{ padding: "2rem" }}>Loading team data...</p></div>;
    if (!team) return <div className="auth-team-page"><p className="error" style={{ padding: "2rem" }}>You are not assigned to any team.</p></div>;
    if (!teamInfo.is_leader) return <div className="auth-team-page"><p className="error" style={{ padding: "2rem" }}>Only team leaders can access this page.</p></div>;

    return (
        <div className="auth-team-page">
            <div className="auth-team-header">
                <div>
                    <h1 className="auth-team-title"><Users size={24} /> Team Management</h1>
                    <p className="auth-team-sub">Manage your teams and assigned reports — {teamInfo.zone}</p>
                </div>
            </div>

            {error && <p className="error">{error}</p>}
            {success && <p className="auth-team-success">{success}</p>}

            {/* Stat Cards */}
            <div className="auth-team-stats">
                <div className="auth-team-stat">
                    <div className="auth-tstat-icon" style={{ background: "#dbeafe", color: "#2563eb", boxShadow: "0 4px 12px rgba(37,99,235,0.2)" }}><Users size={22} /></div>
                    <div><span className="auth-tstat-label">Team Members</span><strong className="auth-tstat-value">{members.length}</strong></div>
                </div>
                <div className="auth-team-stat">
                    <div className="auth-tstat-icon" style={{ background: "#ede9fe", color: "#7c3aed", boxShadow: "0 4px 12px rgba(124,58,237,0.2)" }}><ClipboardList size={22} /></div>
                    <div><span className="auth-tstat-label">Zone Events</span><strong className="auth-tstat-value">{events.length}</strong></div>
                </div>
                <div className="auth-team-stat">
                    <div className="auth-tstat-icon" style={{ background: "#fef3c7", color: "#d97706", boxShadow: "0 4px 12px rgba(217,119,6,0.2)" }}><AlertTriangle size={22} /></div>
                    <div><span className="auth-tstat-label">Unassigned</span><strong className="auth-tstat-value">{unassignedEvents.length}</strong></div>
                </div>
                <div className="auth-team-stat">
                    <div className="auth-tstat-icon" style={{ background: "#dcfce7", color: "#16a34a", boxShadow: "0 4px 12px rgba(22,163,106,0.2)" }}><CheckCircle2 size={22} /></div>
                    <div><span className="auth-tstat-label">Assigned</span><strong className="auth-tstat-value">{assignedEvents.length}</strong></div>
                </div>
            </div>

            {/* Team Card with Members */}
            <div className="auth-team-info-card">
                <div className="auth-team-info-head">
                    <div className="auth-team-info-icon"><MapPin size={20} /></div>
                    <div>
                        <strong className="auth-team-info-name">{team.name}</strong>
                        <span className="auth-team-info-zone">Zone: {teamInfo.zone} · {members.length} members</span>
                    </div>
                </div>

                {/* Members grid — like Admin style, with pagination */}
                {(() => {
                    const MEMBERS_PER_PAGE = 6;
                    const membersTotalPages = Math.max(1, Math.ceil(members.length / MEMBERS_PER_PAGE));
                    const paginatedMembers = members.slice((membersPage - 1) * MEMBERS_PER_PAGE, membersPage * MEMBERS_PER_PAGE);
                    return (
                        <>
                            <div className="auth-team-members-grid">
                                {paginatedMembers.map((m) => {
                                    const personalCount = events.filter(e => e.assigned_to === m.user_id).length;
                                    return (
                                        <div key={m.user_id} className={`auth-team-member-card ${m.is_leader ? "auth-team-member-leader" : ""}`}>
                                            <div className="auth-team-member-top">
                                                <div className="auth-team-member-avatar" style={{ background: m.is_leader ? "#3b82f6" : "#94a3b8" }}>{getInitial(m.full_name)}</div>
                                                <div className="auth-team-member-info">
                                                    <strong>{m.full_name}</strong>
                                                    <span>{m.email}</span>
                                                    {m.is_leader && <span className="auth-team-leader-badge"><Crown size={11} /> Leader</span>}
                                                </div>
                                                <span className="tm-active-badge">Active</span>
                                            </div>
                                            <div className="auth-team-member-stat">
                                                {m.is_leader
                                                    ? <><strong>{events.length}</strong> <span>zone events (manages all)</span></>
                                                    : <><strong>{personalCount}</strong> <span>assigned events</span></>
                                                }
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                            {membersTotalPages > 1 && (
                                <div className="ref-pagination" style={{ marginTop: "0.75rem", justifyContent: "center" }}>
                                    <button className="ref-page-link" disabled={membersPage === 1} onClick={() => setMembersPage(p => p - 1)}><ChevronLeft size={16} /></button>
                                    {Array.from({ length: membersTotalPages }, (_, i) => i + 1).map(p => (
                                        <button key={p} className={`ref-page-num${p === membersPage ? " active" : ""}`} onClick={() => setMembersPage(p)}>{p}</button>
                                    ))}
                                    <button className="ref-page-link" disabled={membersPage === membersTotalPages} onClick={() => setMembersPage(p => p + 1)}><ChevronRight size={16} /></button>
                                </div>
                            )}
                        </>
                    );
                })()}
            </div>

            {/* Events Section */}
            <div className="auth-team-events-card">
                <div className="auth-team-events-head">
                    <div className="auth-team-events-tabs">
                        <button className={`auth-team-tab ${viewMode === "unassigned" ? "auth-team-tab-active" : ""}`} onClick={() => setViewMode("unassigned")}>
                            Unassigned Events ({unassignedEvents.length})
                        </button>
                        <button className={`auth-team-tab ${viewMode === "assigned" ? "auth-team-tab-active" : ""}`} onClick={() => setViewMode("assigned")}>
                            Assigned Events ({assignedEvents.length})
                        </button>
                    </div>
                </div>

                {paginated.length === 0 ? (
                    <p className="text-muted" style={{ padding: "2rem", textAlign: "center" }}>
                        {viewMode === "unassigned" ? "All events are assigned." : "No assigned events."}
                    </p>
                ) : (
                    <div className="auth-team-event-list">
                        {paginated.map((evt) => {
                            const assignee = members.find(m => m.user_id === evt.assigned_to);
                            return (
                                <div key={evt.event_id} className="auth-team-event-row">
                                    <div className="auth-team-event-left">
                                        <div className="auth-team-event-info">
                                            <div className="auth-team-event-top">
                                                <span className="auth-team-event-id">Pothole Report #{evt.event_id.slice(0, 8)}</span>
                                                <span className="auth-team-event-status" style={{ background: evt.lifecycle_status === "Resolved" ? "#dcfce7" : evt.lifecycle_status === "Reported" ? "#fef3c7" : "#ede9fe", color: evt.lifecycle_status === "Resolved" ? "#166534" : evt.lifecycle_status === "Reported" ? "#92400e" : "#5b21b6" }}>
                                                    {STATUS_LABELS[evt.lifecycle_status] || evt.lifecycle_status}
                                                </span>
                                                <span style={{ fontSize: "0.78rem", fontWeight: 600, color: SEV_COLORS[evt.severity] }}>
                                                    {evt.severity}
                                                </span>
                                            </div>
                                            <div className="auth-team-event-meta">
                                                <span>{evt.created_at ? new Date(evt.created_at).toLocaleDateString() : "—"}</span>
                                                <span>Detections: {evt.detection_count || 0}</span>
                                                {assignee && <span className="auth-team-event-assignee">→ {assignee.full_name}</span>}
                                            </div>
                                        </div>
                                    </div>
                                    <div className="auth-team-event-actions">
                                        <AssignSelect evt={evt} nonLeaderMembers={nonLeaderMembers} onAssign={handleAssign} />
                                        <Link to={`/authority/events/${evt.event_id}/update`} className="auth-team-detail-btn"><Eye size={14} /></Link>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}

                <div className="auth-team-footer">
                    <span className="auth-team-showing">Showing {((currentPage - 1) * PAGE_SIZE) + 1}–{Math.min(currentPage * PAGE_SIZE, activeList.length)} of {activeList.length} events</span>
                    {totalPages > 1 && (
                        <div className="ref-pagination">
                            <button className="ref-page-link" disabled={currentPage === 1} onClick={() => setCurrentPage(p => p - 1)}><ChevronLeft size={16} /></button>
                            {getVisiblePages().map(p => (
                                <button key={p} className={`ref-page-num${p === currentPage ? " active" : ""}`} onClick={() => setCurrentPage(p)}>{p}</button>
                            ))}
                            <button className="ref-page-link" disabled={currentPage === totalPages} onClick={() => setCurrentPage(p => p + 1)}><ChevronRight size={16} /></button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

/**
 * Per-row assign/reassign/unassign control. Renders a member dropdown plus
 * a primary action button (Assign or Reassign) and, when the event is
 * already assigned, an Unassign button. Calls the parent's `onAssign` with
 * the event id and the chosen user id (or "" to unassign).
 */
function AssignSelect({ evt, nonLeaderMembers, onAssign }) {
    const [val, setVal] = useState("");
    const assignee = evt.assigned_to;
    return (
        <div className="auth-team-assign-wrap">
            <select value={val} onChange={(e) => setVal(e.target.value)} className="auth-team-assign-select">
                <option value="">{assignee ? "Reassign..." : "Assign to..."}</option>
                {nonLeaderMembers.filter(m => m.user_id !== assignee).map(m => (
                    <option key={m.user_id} value={m.user_id}>{m.full_name}</option>
                ))}
            </select>
            <button
                className="auth-team-assign-btn"
                disabled={!val}
                onClick={() => { if (val) { onAssign(evt.event_id, val); setVal(""); } }}
            >{assignee ? "Reassign" : "Assign"}</button>
            {assignee && (
                <button className="auth-team-unassign-btn" onClick={() => onAssign(evt.event_id, "")}>Unassign</button>
            )}
        </div>
    );
}
