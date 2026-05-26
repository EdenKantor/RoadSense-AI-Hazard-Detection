/**
 * Admin zone management page.
 *
 * Admin-only zones CRUD: create, view (with per-zone KPIs — open / pending /
 * resolved / last-event date), and delete zones. Each zone card opens a
 * detail modal showing recent activity. Zones are auto-created by the worker
 * when the first event for a city is geocoded; this page lets Admin curate
 * and edit them.
 */
import { useEffect, useState, useMemo, useRef } from "react";
import { Link } from "react-router-dom";
import { MapPin, Flag, AlertCircle, Users as UsersIcon, MoreVertical, ChevronLeft, ChevronRight } from "lucide-react";
import { adminApi } from "../api/client";

const PAGE_SIZE = 4;

const ZONE_COLORS = ["#6366f1", "#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899"];

function ZoneDetailModal({ zone, onClose }) {
    if (!zone) return null;
    const open = zone.pending + zone.in_progress;
    const statusText = open > 10 ? "Needs attention" : open > 0 ? "Active" : "All clear";
    const statusColor = open > 10 ? "#ef4444" : open > 0 ? "#f59e0b" : "#10b981";
    const lastDate = zone.last_event_date ? new Date(zone.last_event_date) : null;
    const daysAgo = lastDate ? Math.floor((Date.now() - lastDate) / 86400000) : null;
    const lastLabel = daysAgo === 0 ? "Today" : daysAgo === 1 ? "Yesterday" : daysAgo != null ? `${daysAgo} days ago` : "No events";

    return (
        <div className="zm-modal-overlay" onClick={onClose}>
            <div className="zm-modal" onClick={(e) => e.stopPropagation()}>
                <div className="zm-modal-bar" />
                <div className="zm-modal-content">
                    <div className="zm-modal-head">
                        <div>
                            <h2>{zone.name} Zone</h2>
                            <p>Operational overview for this area</p>
                        </div>
                        <button className="zm-modal-close" onClick={onClose}>&times;</button>
                    </div>
                    <div className="zm-modal-grid">
                        <div className="zm-modal-cell"><span>Assigned Team</span><strong>{zone.team_name || "None"}</strong></div>
                        <div className="zm-modal-cell"><span>Team Leader</span><strong>{zone.leader_name || "Not assigned"}</strong></div>
                        <div className="zm-modal-cell"><span>Active Members</span><strong>{zone.team_members}</strong></div>
                        <div className="zm-modal-cell"><span>Open Events</span><strong>{open}</strong></div>
                    </div>
                    <div className="zm-modal-status">
                        <span>Current Status:</span>
                        <strong style={{ color: statusColor }}>{statusText}</strong>
                    </div>
                    <h3>Zone Activity</h3>
                    <div className="zm-modal-activity">
                        <div><span>Last detected event</span><strong>{lastLabel}</strong></div>
                        <div><span>Unassigned events</span><strong>{zone.unassigned}</strong></div>
                        <div><span>Highest open severity</span><strong style={{ color: zone.highest_severity === "High" ? "#ef4444" : zone.highest_severity === "Medium" ? "#f59e0b" : "#10b981" }}>{zone.highest_severity}</strong></div>
                    </div>
                    <h3>Status Overview</h3>
                    <div className="zm-modal-stats">
                        <div className="zm-mstat zm-mstat-pending"><strong>{zone.pending}</strong><span>Pending</span></div>
                        <div className="zm-mstat zm-mstat-progress"><strong>{zone.in_progress}</strong><span>In Progress</span></div>
                        <div className="zm-mstat zm-mstat-resolved"><strong>{zone.resolved}</strong><span>Resolved</span></div>
                    </div>
                    <div className="zm-modal-actions">
                        <Link to="/admin/teams" className="btn btn-primary" style={{ flex: 1, textAlign: "center" }} onClick={onClose}>Manage Team</Link>
                        <button className="btn btn-outline" style={{ flex: 1 }} onClick={onClose}>Close</button>
                    </div>
                </div>
            </div>
        </div>
    );
}

function ZoneMenu({ onViewDetails, onEdit, onDelete }) {
    const [open, setOpen] = useState(false);
    const ref = useRef(null);

    useEffect(() => {
        if (!open) return;
        const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
        document.addEventListener("mousedown", handler);
        return () => document.removeEventListener("mousedown", handler);
    }, [open]);

    return (
        <div ref={ref} style={{ position: "relative" }}>
            <button className="zm-dots-btn" onClick={() => setOpen(!open)}>
                <MoreVertical size={18} />
            </button>
            {open && (
                <div className="zm-dropdown">
                    <button onClick={() => { onViewDetails(); setOpen(false); }}>View Details</button>
                    <button onClick={() => { onEdit(); setOpen(false); }}>Edit Description</button>
                    <button className="zm-dropdown-danger" onClick={() => { onDelete(); setOpen(false); }}>Delete</button>
                </div>
            )}
        </div>
    );
}

function ZoneEditModal({ zone, onClose, onSaved }) {
    const [description, setDescription] = useState(zone?.description || "");
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState("");

    if (!zone) return null;

    const handleSave = async (e) => {
        e.preventDefault();
        setSaving(true);
        setError("");
        try {
            await adminApi.updateZone(zone.zone_id, { description: description.trim() });
            onSaved();
            onClose();
        } catch (err) {
            setError(err.response?.data?.detail || "Failed to save.");
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="zm-modal-overlay" onClick={onClose}>
            <div className="zm-modal" onClick={(e) => e.stopPropagation()}>
                <div className="zm-modal-bar" />
                <div className="zm-modal-content">
                    <div className="zm-modal-head">
                        <div>
                            <h2>Edit Zone</h2>
                            <p>{zone.name}</p>
                        </div>
                        <button className="zm-modal-close" onClick={onClose}>&times;</button>
                    </div>
                    <form onSubmit={handleSave}>
                        <div className="form-group">
                            <label className="form-label">Zone Name</label>
                            <input className="form-control" value={zone.name} disabled />
                            <div className="form-hint">Name cannot be changed - it links events to this zone.</div>
                        </div>
                        <div className="form-group">
                            <label className="form-label">Description</label>
                            <textarea
                                className="form-control"
                                rows={3}
                                value={description}
                                onChange={(e) => setDescription(e.target.value)}
                                placeholder={`${zone.name} metropolitan area`}
                            />
                        </div>
                        {error && (
                            <div className="badge badge-danger" style={{ width: "100%", justifyContent: "center", padding: "0.5rem", marginBottom: "0.75rem" }}>
                                {error}
                            </div>
                        )}
                        <div className="zm-modal-actions">
                            <button type="submit" className="btn btn-primary" style={{ flex: 1 }} disabled={saving}>
                                {saving ? "Saving..." : "Save Changes"}
                            </button>
                            <button type="button" className="btn btn-outline" style={{ flex: 1 }} onClick={onClose}>Cancel</button>
                        </div>
                    </form>
                </div>
            </div>
        </div>
    );
}

export default function AdminZoneManagementPage() {
    const [zones, setZones] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [showCreate, setShowCreate] = useState(false);
    const [newName, setNewName] = useState("");
    const [newDesc, setNewDesc] = useState("");
    const [creating, setCreating] = useState(false);
    const [detailZone, setDetailZone] = useState(null);
    const [editZone, setEditZone] = useState(null);
    const [search, setSearch] = useState("");
    const [sortBy, setSortBy] = useState("name-asc");
    const [currentPage, setCurrentPage] = useState(1);

    const fetchZones = () => {
        setLoading(true);
        adminApi.listZones().then((res) => setZones(res.data || [])).catch(() => setError("Failed to load zones.")).finally(() => setLoading(false));
    };

    useEffect(() => { fetchZones(); }, []);
    useEffect(() => { setCurrentPage(1); }, [search, sortBy]);

    const handleCreate = async (e) => {
        e.preventDefault();
        if (!newName.trim()) {
            setError("Zone name is required.");
            return;
        }
        setCreating(true); setError("");
        try { await adminApi.createZone({ name: newName.trim(), description: newDesc.trim() }); setNewName(""); setNewDesc(""); setShowCreate(false); fetchZones(); }
        catch (err) { setError(err.response?.data?.detail || "Failed."); }
        finally { setCreating(false); }
    };

    const handleDelete = async (zoneId, zoneName) => {
        if (!window.confirm(`Delete zone "${zoneName}" and all associated teams?`)) return;
        try { await adminApi.deleteZone(zoneId); fetchZones(); } catch { setError("Failed."); }
    };

    const filtered = useMemo(() => {
        let list = [...zones];
        if (search) {
            const q = search.toLowerCase();
            list = list.filter(z => (z.name || "").toLowerCase().includes(q));
        }
        if (sortBy === "name-asc") list.sort((a, b) => a.name.localeCompare(b.name));
        else if (sortBy === "name-desc") list.sort((a, b) => b.name.localeCompare(a.name));
        else if (sortBy === "events") list.sort((a, b) => (b.event_count || 0) - (a.event_count || 0));
        return list;
    }, [zones, search, sortBy]);

    const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    const paginated = useMemo(() => {
        const start = (currentPage - 1) * PAGE_SIZE;
        return filtered.slice(start, start + PAGE_SIZE);
    }, [filtered, currentPage]);

    const totalEvents = zones.reduce((s, z) => s + (z.event_count || 0), 0);
    const totalPending = zones.reduce((s, z) => s + (z.pending || 0), 0);
    const totalMembers = zones.reduce((s, z) => s + (z.team_members || 0), 0);

    function getVisiblePages() {
        if (totalPages <= 3) return Array.from({ length: totalPages }, (_, i) => i + 1);
        if (currentPage <= 2) return [1, 2, 3];
        if (currentPage >= totalPages - 1) return [totalPages - 2, totalPages - 1, totalPages];
        return [currentPage - 1, currentPage, currentPage + 1];
    }

    return (
        <div className="zm-page">
            <div className="zm-header">
                <div>
                    <h1 className="zm-title"><MapPin size={22} /> Zone Management</h1>
                    <p className="zm-sub">Manage geographical zones and their operations</p>
                </div>
                <button className="btn btn-primary" onClick={() => setShowCreate(!showCreate)}>+ New Zone</button>
            </div>

            {error && <p className="error">{error}</p>}

            {/* ── Stats ── */}
            <div className="zm-stats">
                <div className="zm-stat">
                    <div className="zm-stat-icon" style={{ background: "#dbeafe", color: "#2563eb" }}><MapPin size={22} /></div>
                    <div><span className="zm-stat-label">Total Zones</span><strong className="zm-stat-value">{zones.length}</strong></div>
                </div>
                <div className="zm-stat">
                    <div className="zm-stat-icon" style={{ background: "#ede9fe", color: "#7c3aed" }}><Flag size={22} /></div>
                    <div><span className="zm-stat-label">Total Events</span><strong className="zm-stat-value">{totalEvents}</strong></div>
                </div>
                <div className="zm-stat">
                    <div className="zm-stat-icon" style={{ background: "#ffedd5", color: "#ea580c" }}><AlertCircle size={22} /></div>
                    <div><span className="zm-stat-label">Pending</span><strong className="zm-stat-value">{totalPending}</strong></div>
                </div>
                <div className="zm-stat">
                    <div className="zm-stat-icon" style={{ background: "#dcfce7", color: "#16a34a" }}><UsersIcon size={22} /></div>
                    <div><span className="zm-stat-label">Team Members</span><strong className="zm-stat-value">{totalMembers}</strong></div>
                </div>
            </div>

            {showCreate && (
                <div className="zm-create-card">
                    <h2>Create New Zone</h2>
                    <form onSubmit={handleCreate}>
                        <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", marginBottom: "0.75rem" }}>
                            <input className="adm-users-search" style={{ flex: 1, minWidth: "180px" }} placeholder="Zone name (e.g. Haifa)" value={newName} onChange={(e) => setNewName(e.target.value)} />
                            <input className="adm-users-search" style={{ flex: 2, minWidth: "240px" }} placeholder="Description (optional)" value={newDesc} onChange={(e) => setNewDesc(e.target.value)} />
                        </div>
                        <div style={{ display: "flex", gap: "0.5rem" }}>
                            <button className="btn btn-primary" type="submit" disabled={creating}>{creating ? "Creating..." : "Create Zone"}</button>
                            <button className="btn btn-outline" type="button" onClick={() => setShowCreate(false)}>Cancel</button>
                        </div>
                    </form>
                </div>
            )}

            {/* ── Search + Sort + Table — wrapped in one card ── */}
            {loading ? <p className="text-muted" style={{ padding: "1.5rem" }}>Loading zones...</p> : (
                <div className="zm-table-card">
                    <div className="zm-toolbar">
                        <input className="zm-search" type="text" placeholder="Search zones by name..." value={search} onChange={(e) => setSearch(e.target.value)} />
                        <div className="zm-sort">
                            <span>Sort by</span>
                            <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
                                <option value="name-asc">Name (A-Z)</option>
                                <option value="name-desc">Name (Z-A)</option>
                                <option value="events">Most Events</option>
                            </select>
                        </div>
                    </div>
                    <div className="zm-table-wrap">
                        <table className="zm-table">
                            <thead>
                                <tr>
                                    <th>Zone</th>
                                    <th>Coverage</th>
                                    <th>Team</th>
                                    <th>Status</th>
                                    <th>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {paginated.length === 0 ? (
                                    <tr><td colSpan={5} style={{ textAlign: "center", padding: "2rem", color: "var(--text-muted)" }}>No zones found.</td></tr>
                                ) : paginated.map((zone, idx) => {
                                    const color = ZONE_COLORS[idx % ZONE_COLORS.length];
                                    return (
                                        <tr key={zone.zone_id} className="zm-row">
                                            <td>
                                                <div className="zm-zone-cell">
                                                    <div className="zm-zone-icon" style={{ background: `${color}18`, color }}><MapPin size={18} /></div>
                                                    <div>
                                                        <strong>{zone.name}</strong>
                                                        <span>{zone.description || `${zone.name} metropolitan area`}</span>
                                                    </div>
                                                </div>
                                            </td>
                                            <td>
                                                <div className="zm-big-num">{zone.event_count}</div>
                                                <div className="zm-cell-hint">Total</div>
                                            </td>
                                            <td>
                                                <div className="zm-team-cell">
                                                    <UsersIcon size={20} /> <span className="zm-big-num">{zone.team_members}</span>
                                                </div>
                                                <div className="zm-cell-hint">Members</div>
                                            </td>
                                            <td>
                                                <div className="zm-status-row">
                                                    <span className="zm-status-dot" style={{ background: "#f59e0b" }} />
                                                    <span className="zm-status-num" style={{ color: "#f59e0b" }}>{zone.pending}</span>
                                                    <span className="zm-cell-hint">Pending</span>
                                                    <span className="zm-status-dot" style={{ background: "#6366f1" }} />
                                                    <span className="zm-status-num" style={{ color: "#6366f1" }}>{zone.in_progress}</span>
                                                    <span className="zm-cell-hint">In Progress</span>
                                                    <span className="zm-status-dot" style={{ background: "#10b981" }} />
                                                    <span className="zm-status-num" style={{ color: "#10b981" }}>{zone.resolved}</span>
                                                    <span className="zm-cell-hint">Resolved</span>
                                                </div>
                                            </td>
                                            <td>
                                                <div className="zm-actions-cell">
                                                    <Link to={`/admin/teams?zone=${encodeURIComponent(zone.name)}`} className="zm-view-btn">Manage Team</Link>
                                                    <ZoneMenu
                                                        onViewDetails={() => setDetailZone(zone)}
                                                        onEdit={() => setEditZone(zone)}
                                                        onDelete={() => handleDelete(zone.zone_id, zone.name)}
                                                    />
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                    <div className="zm-table-footer">
                        <span className="zm-showing">Showing {((currentPage - 1) * PAGE_SIZE) + 1}-{Math.min(currentPage * PAGE_SIZE, filtered.length)} of {filtered.length} zones</span>
                        {totalPages > 1 && (
                            <div className="ref-pagination">
                                <button className="ref-page-link" disabled={currentPage === 1} onClick={() => setCurrentPage(p => p - 1)}>
                                    <ChevronLeft size={16} />
                                </button>
                                {getVisiblePages().map(p => (
                                    <button key={p} className={`ref-page-num${p === currentPage ? " active" : ""}`} onClick={() => setCurrentPage(p)}>{p}</button>
                                ))}
                                <button className="ref-page-link" disabled={currentPage === totalPages} onClick={() => setCurrentPage(p => p + 1)}>
                                    <ChevronRight size={16} />
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {detailZone && <ZoneDetailModal zone={detailZone} onClose={() => setDetailZone(null)} />}
            {editZone && <ZoneEditModal zone={editZone} onClose={() => setEditZone(null)} onSaved={fetchZones} />}
        </div>
    );
}
