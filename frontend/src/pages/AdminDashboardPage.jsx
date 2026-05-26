/**
 * Admin dashboard page.
 *
 * Admin-only landing showing platform-wide KPIs (citizen / authority / pending
 * approval / report counts) with weekly growth badges, a daily activity chart,
 * and a recent-reports list. All data is loaded from GET /api/admin/stats with
 * a configurable activity-window (7 or 30 days).
 */
import { useState, useEffect, useMemo, useCallback } from "react";
import { Link, useNavigate } from "react-router-dom";
import { adminApi } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { Shield, Users, ShieldCheck, FileText, Map, ChevronRight, TrendingUp, TrendingDown, Activity, PieChart, Zap, UserCheck } from "lucide-react";

function growthPct(current, previous) {
    if (!previous) return current > 0 ? 100 : 0;
    return Math.round(((current - previous) / previous) * 100);
}

function GrowthBadge({ current, previous, label }) {
    const pct = growthPct(current, previous);
    const up = pct >= 0;
    return (
        <div className="adm-growth-wrap">
            <span className={`adm-growth-badge ${up ? "adm-growth-up" : "adm-growth-down"}`}>
                {up ? <TrendingUp size={13} /> : <TrendingDown size={13} />}
                {up ? "+" : ""}{pct}%
            </span>
            <span className="adm-growth-vs">{label}</span>
        </div>
    );
}

function statusClass(status) {
    if (status === "Resolved") return "adm-pill-resolved";
    if (status === "UnderReview" || status === "Scheduled") return "adm-pill-progress";
    if (status === "Reported") return "adm-pill-pending";
    return "adm-pill-failed";
}

function statusLabel(status) {
    if (status === "Resolved") return "Resolved";
    if (status === "UnderReview" || status === "Scheduled") return "In Progress";
    if (status === "Reported") return "Pending";
    return status;
}

export default function AdminDashboardPage() {
    const { user } = useAuth();
    const navigate = useNavigate();
    const [stats, setStats] = useState(null);
    const [loading, setLoading] = useState(true);
    const [activityRange, setActivityRange] = useState(7);

    const fetchStats = useCallback((days) => {
        setLoading(true);
        adminApi.stats({ activity_days: days })
            .then((res) => setStats(res.data))
            .catch(() => {})
            .finally(() => setLoading(false));
    }, []);

    useEffect(() => { fetchStats(activityRange); }, [fetchStats, activityRange]);

    const users = stats?.users || {};
    const events = stats?.events || {};
    const growth = stats?.growth || {};
    const dailyActivity = stats?.daily_activity || [];
    const recentReports = stats?.recent_reports || [];

    const maxActivity = useMemo(() => Math.max(...dailyActivity.map(d => d.count), 1), [dailyActivity]);

    const pending = events.reported || 0;
    const inProgress = (events.under_review || 0) + (events.scheduled || 0);
    const resolved = events.resolved || 0;
    const totalEvents = events.total || 1;

    if (loading && !stats) {
        return <div className="page"><p>Loading dashboard...</p></div>;
    }

    return (
        <div className="adm-dash">
            {/* ── Welcome Banner ── */}
            <div className="adm-banner">
                <div className="adm-banner-icon"><Shield size={24} /></div>
                <div>
                    <h1 className="adm-banner-title">Welcome back, {user?.full_name || "Admin User"}!</h1>
                    <p className="adm-banner-sub">Here's an overview of your platform's activity and insights.</p>
                </div>
            </div>

            {/* ── Stat Cards ── */}
            <div className="adm-stat-row">
                <Link to="/admin/users?role=Citizen" className="adm-stat-card">
                    <div className="adm-stat-icon adm-icon-blue"><Users size={24} /></div>
                    <div className="adm-stat-body">
                        <span className="adm-stat-label">Total Users</span>
                        <strong className="adm-stat-value">{users.citizens || 0}</strong>
                        <span className="adm-stat-hint">Active on platform</span>
                    </div>
                    <GrowthBadge current={growth.users_this_week} previous={growth.users_last_week} label="vs last week" />
                </Link>

                <Link to="/admin/users?role=Authority&status=active" className="adm-stat-card">
                    <div className="adm-stat-icon adm-icon-green"><ShieldCheck size={24} /></div>
                    <div className="adm-stat-body">
                        <span className="adm-stat-label">Active Authorities</span>
                        <strong className="adm-stat-value">{users.active_officials || 0}</strong>
                        <span className="adm-stat-hint">Verified and active</span>
                    </div>
                    <GrowthBadge current={growth.authorities_this_week} previous={growth.authorities_last_week} label="vs last week" />
                </Link>

                <Link to="/admin/officials/verify" className="adm-stat-card">
                    <div className="adm-stat-icon adm-icon-orange"><UserCheck size={24} /></div>
                    <div className="adm-stat-body">
                        <span className="adm-stat-label">Pending Authorities</span>
                        <strong className="adm-stat-value">{users.pending_officials || 0}</strong>
                        <span className="adm-stat-hint">Awaiting verification</span>
                    </div>
                    <GrowthBadge current={growth.pending_this_week} previous={growth.pending_last_week} label="vs last week" />
                </Link>

                <Link to="/admin/reports" className="adm-stat-card">
                    <div className="adm-stat-icon adm-icon-purple"><FileText size={24} /></div>
                    <div className="adm-stat-body">
                        <span className="adm-stat-label">Total Reports</span>
                        <strong className="adm-stat-value">{events.total || 0}</strong>
                        <span className="adm-stat-hint">All time public events</span>
                    </div>
                    <GrowthBadge current={growth.events_this_month} previous={growth.events_last_month} label="vs last month" />
                </Link>
            </div>

            {/* ── Middle Row: Platform Activity + Report Statistics ── */}
            <div className="adm-mid-row">
                <div className="adm-activity-card">
                    <div className="adm-card-head">
                        <div>
                            <h2><Activity size={18} /> Platform Activity</h2>
                            <p>Reports submitted over time</p>
                        </div>
                        <select className="adm-range-select" value={activityRange} onChange={(e) => setActivityRange(Number(e.target.value))}>
                            <option value={7}>Last 7 Days</option>
                            <option value={30}>Last Month</option>
                        </select>
                    </div>
                    {(() => {
                        const cw = 600, ch = 180, padL = 34, padR = 10, padT = 15, padB = 22;
                        const drawW = cw - padL - padR;
                        const drawH = ch - padT - padB;
                        const ySteps = 5;
                        const stepVal = Math.ceil(Math.max(maxActivity, 1) / ySteps) || 1;
                        const yMax = stepVal * ySteps;
                        const n = dailyActivity.length;

                        const pts = dailyActivity.map((d, i) => ({
                            x: padL + (i / Math.max(n - 1, 1)) * drawW,
                            y: padT + drawH - (d.count / yMax) * drawH,
                        }));

                        // Smooth cubic bezier path
                        let path = `M${pts[0].x},${pts[0].y}`;
                        for (let i = 0; i < pts.length - 1; i++) {
                            const cx = (pts[i].x + pts[i + 1].x) / 2;
                            path += ` C${cx},${pts[i].y} ${cx},${pts[i + 1].y} ${pts[i + 1].x},${pts[i + 1].y}`;
                        }
                        const fillPath = `${path} L${pts[n - 1].x},${padT + drawH} L${pts[0].x},${padT + drawH} Z`;

                        // Labels: for 7 days show all; for 30 days show weekday names evenly spaced
                        let labelEntries; // [{index, label}]
                        if (n <= 10) {
                            labelEntries = dailyActivity.map((d, i) => ({ index: i, label: d.day }));
                        } else {
                            // Show 7 evenly spaced labels: Sun Mon Tue Wed Thu Fri Sat
                            const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
                            labelEntries = weekdays.map((wd, wi) => {
                                const idx = Math.round((wi / 6) * (n - 1));
                                return { index: idx, label: wd };
                            });
                        }

                        const dotSet = new Set(labelEntries.map(e => e.index));

                        return (
                            <div className="adm-chart-box">
                                <svg viewBox={`0 0 ${cw} ${ch}`} className="adm-chart-svg">
                                    <defs>
                                        <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="0%" stopColor="#6366f1" stopOpacity="0.2" />
                                            <stop offset="100%" stopColor="#6366f1" stopOpacity="0.01" />
                                        </linearGradient>
                                    </defs>
                                    {/* Y grid lines + labels */}
                                    {[...Array(ySteps + 1)].map((_, i) => {
                                        const val = yMax - i * stepVal;
                                        const y = padT + (i / ySteps) * drawH;
                                        return (
                                            <g key={`y${i}`}>
                                                <text x={padL - 8} y={y + 3.5} textAnchor="end" fontSize="10" fill="var(--text-muted)">{val}</text>
                                                <line x1={padL} y1={y} x2={cw - padR} y2={y} stroke="var(--border-color)" strokeWidth="0.5" />
                                            </g>
                                        );
                                    })}
                                    {/* Area fill */}
                                    <path d={fillPath} fill="url(#areaGrad)" />
                                    {/* Smooth line */}
                                    <path d={path} fill="none" stroke="#6366f1" strokeWidth="2.5" strokeLinecap="round" />
                                    {/* Dots — only on key points */}
                                    {pts.map((p, i) => dotSet.has(i) && (
                                        <circle key={i} cx={p.x} cy={p.y} r="4" fill="#6366f1" stroke="white" strokeWidth="2" />
                                    ))}
                                    {/* X labels */}
                                    {labelEntries.map((e) => (
                                        <text key={e.index} x={pts[e.index].x} y={ch - 4} textAnchor="middle" fontSize="11" fill="var(--text-muted)">
                                            {e.label}
                                        </text>
                                    ))}
                                </svg>
                            </div>
                        );
                    })()}
                </div>

                <div className="adm-donut-card">
                    <div className="adm-card-head">
                        <div>
                            <h2><PieChart size={18} /> Report Statistics</h2>
                            <p>Current status breakdown</p>
                        </div>
                    </div>
                    <div className="adm-donut-body">
                        <div className="adm-donut-wrap">
                            <svg viewBox="0 0 120 120" className="adm-donut-svg">
                                {(() => {
                                    const r = 50, cx = 60, cy = 60;
                                    const circ = 2 * Math.PI * r;
                                    const slices = [
                                        { val: pending, color: "#fbbf24" },
                                        { val: inProgress, color: "#6366f1" },
                                        { val: resolved, color: "#22c55e" },
                                    ];
                                    let offset = 0;
                                    return slices.map((s, i) => {
                                        const pct = s.val / totalEvents;
                                        const dash = pct * circ;
                                        const el = (
                                            <circle key={i} cx={cx} cy={cy} r={r} fill="none"
                                                stroke={s.color} strokeWidth="14"
                                                strokeDasharray={`${dash} ${circ - dash}`}
                                                strokeDashoffset={-offset}
                                                transform="rotate(-90 60 60)" />
                                        );
                                        offset += dash;
                                        return el;
                                    });
                                })()}
                            </svg>
                            <div className="adm-donut-center">
                                <strong>{events.total || 0}</strong>
                                <span>Total Reports</span>
                            </div>
                        </div>
                        <div className="adm-donut-legend">
                            <div className="adm-legend-row">
                                <span className="adm-legend-dot" style={{ background: "#fbbf24" }} />
                                <span className="adm-legend-label">Pending</span>
                                <strong>{pending}</strong>
                                <span className="adm-legend-pct adm-pct-pending">{totalEvents ? ((pending / totalEvents) * 100).toFixed(1) : 0}%</span>
                            </div>
                            <div className="adm-legend-row">
                                <span className="adm-legend-dot" style={{ background: "#6366f1" }} />
                                <span className="adm-legend-label">In Progress</span>
                                <strong>{inProgress}</strong>
                                <span className="adm-legend-pct adm-pct-progress">{totalEvents ? ((inProgress / totalEvents) * 100).toFixed(1) : 0}%</span>
                            </div>
                            <div className="adm-legend-row">
                                <span className="adm-legend-dot" style={{ background: "#22c55e" }} />
                                <span className="adm-legend-label">Resolved</span>
                                <strong>{resolved}</strong>
                                <span className="adm-legend-pct adm-pct-resolved">{totalEvents ? ((resolved / totalEvents) * 100).toFixed(1) : 0}%</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* ── Recent Reports Table ── */}
            <div className="adm-table-card">
                <div className="adm-table-head">
                    <div>
                        <h2><FileText size={18} /> Recent Reports</h2>
                        <p>Latest reports submitted on the platform</p>
                    </div>
                    <Link to="/admin/reports" className="adm-view-all">View All Reports <ChevronRight size={16} /></Link>
                </div>
                <div className="adm-table-wrap">
                    <table className="adm-table">
                        <thead>
                            <tr>
                                <th>Report ID</th>
                                <th>Citizen</th>
                                <th>Zone</th>
                                <th>Status</th>
                                <th>Date</th>
                                <th></th>
                            </tr>
                        </thead>
                        <tbody>
                            {recentReports.length === 0 ? (
                                <tr><td colSpan={6} style={{ textAlign: "center", padding: "1.5rem", color: "var(--text-muted)" }}>No reports yet.</td></tr>
                            ) : recentReports.map((r) => (
                                <tr key={r.id} className="adm-table-row" onClick={() => navigate("/admin/reports")}>
                                    <td className="adm-td-id">{(r.id || "").slice(0, 10)}</td>
                                    <td>{r.citizen}</td>
                                    <td>{r.zone}</td>
                                    <td><span className={`adm-status-pill ${statusClass(r.status)}`}>{statusLabel(r.status)}</span></td>
                                    <td>{r.date ? new Date(r.date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—"}</td>
                                    <td><ChevronRight size={16} style={{ color: "var(--text-muted)" }} /></td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* ── Quick Actions ── */}
            <div className="adm-quick">
                <div className="adm-quick-head">
                    <h2><Zap size={18} /> Quick Actions</h2>
                    <p>Access the most important tools</p>
                </div>
                <div className="adm-quick-row">
                    <Link to="/admin/officials/verify" className="adm-quick-card adm-quick-primary">
                        <ShieldCheck size={22} />
                        <div><strong>Verify Officials</strong><span>Review and verify authorities</span></div>
                        <ChevronRight size={18} />
                    </Link>
                    <Link to="/admin/reports" className="adm-quick-card">
                        <FileText size={22} />
                        <div><strong>View All Reports</strong><span>Browse and manage reports</span></div>
                        <ChevronRight size={18} />
                    </Link>
                    <Link to="/admin/users" className="adm-quick-card">
                        <Users size={22} />
                        <div><strong>Manage Users</strong><span>Add, edit and remove users</span></div>
                        <ChevronRight size={18} />
                    </Link>
                    <Link to="/map" className="adm-quick-card">
                        <Map size={22} />
                        <div><strong>View Public Map</strong><span>Explore reported events</span></div>
                        <ChevronRight size={18} />
                    </Link>
                </div>
            </div>
        </div>
    );
}
