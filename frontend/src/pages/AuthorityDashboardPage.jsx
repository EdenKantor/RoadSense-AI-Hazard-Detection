/**
 * Authority dashboard landing page.
 *
 * Authority/Admin landing screen showing zone-scoped operational state for
 * the signed-in user. Renders four KPI tiles (Total / Pending / In Progress
 * / Resolved — counts vary by role: zone-wide for team leaders, just
 * "Assigned to Me" for members), a Team Performance area chart of report
 * volume over the last 7 days or 4 weeks (Sunday-aligned), a top-4
 * "Assigned Reports" preview table, and — for team leaders only — a
 * Recent Ticket Activity panel showing the three newest non-closed
 * support tickets. The KPI tiles deep-link into the events list with
 * pre-applied status filters; this page itself is read-only and performs
 * no mutations.
 */

import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { authorityApi, supportApi } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { MapPin, AlertCircle, Clock, CheckCircle2, TrendingUp, FileText, MessageSquare, Eye, Crown, Users, BarChart3, Map as MapIcon } from "lucide-react";

/** Render a "just now" / "5m ago" / locale-date string for ticket and event timestamps. */
function relativeDate(dateStr) {
    if (!dateStr) return "";
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return days < 7 ? `${days}d ago` : new Date(dateStr).toLocaleDateString();
}

/** Map an event severity ("High" / "Medium" / "Low") to its dot color. */
function severityColor(s) {
    if (s === "High") return "#ef4444";
    if (s === "Medium") return "#f59e0b";
    return "#10b981";
}

/** Authority dashboard with KPIs, trend chart, ticket panel, and assigned-reports preview. */
export default function AuthorityDashboardPage() {
    const { user } = useAuth();
    const [events, setEvents] = useState([]);
    const [teamInfo, setTeamInfo] = useState(null);
    const [tickets, setTickets] = useState([]);
    const [loading, setLoading] = useState(true);
    const [activityRange, setActivityRange] = useState(7);

    useEffect(() => {
        Promise.all([
            authorityApi.events().then((r) => setEvents(r.data || [])),
            authorityApi.myTeam().then((r) => setTeamInfo(r.data)),
            supportApi.list().catch(() => ({ data: [] })).then((r) => setTickets(r.data || [])),
        ]).catch(() => {}).finally(() => setLoading(false));
    }, []);

    const isLeader = teamInfo?.is_leader;
    const zoneName = teamInfo?.zone;
    const teamName = teamInfo?.team?.name;
    const memberCount = teamInfo?.team?.members?.length || 0;

    const metrics = useMemo(() => ({
        total: events.length,
        pending: events.filter(e => e.lifecycle_status === "Reported").length,
        inProgress: events.filter(e => ["UnderReview", "Scheduled"].includes(e.lifecycle_status)).length,
        resolved: events.filter(e => ["Resolved", "Closed"].includes(e.lifecycle_status)).length,
    }), [events]);

    // Chart data — start from Sunday, 7 days or 4 weeks
    const dailyData = useMemo(() => {
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const daysSinceSun = (today.getDay() + 0) % 7; // Sunday = 0
        const days = [];

        if (activityRange === 7) {
            const sunday = new Date(today);
            sunday.setDate(sunday.getDate() - daysSinceSun);
            for (let i = 0; i < 7; i++) {
                const d = new Date(sunday);
                d.setDate(d.getDate() + i);
                const key = d.toISOString().slice(0, 10);
                const label = d.toLocaleDateString("en-US", { weekday: "short" });
                const count = events.filter(e => (e.created_at || "").startsWith(key)).length;
                days.push({ key, label, count });
            }
        } else {
            // Last month: 4 weeks from last Sunday
            const thisSunday = new Date(today);
            thisSunday.setDate(thisSunday.getDate() - daysSinceSun);
            const startSunday = new Date(thisSunday);
            startSunday.setDate(startSunday.getDate() - 21);
            const totalDays = Math.min(Math.floor((today - startSunday) / 86400000) + 1, 30);
            for (let i = 0; i < totalDays; i++) {
                const d = new Date(startSunday);
                d.setDate(d.getDate() + i);
                if (d > today) break;
                const key = d.toISOString().slice(0, 10);
                const label = d.toLocaleDateString("en-US", { weekday: "short" });
                const count = events.filter(e => (e.created_at || "").startsWith(key)).length;
                days.push({ key, label, count });
            }
        }
        return days;
    }, [events, activityRange]);

    const chartMax = useMemo(() => Math.max(...dailyData.map(d => d.count), 1), [dailyData]);

    // Top 3 non-closed tickets
    const openTickets = useMemo(() => tickets.filter(t => t.status !== "Closed").slice(0, 3), [tickets]);

    if (loading) return <div className="page"><p className="text-muted" style={{ padding: "2rem" }}>Loading dashboard...</p></div>;

    return (
        <div className="auth-dash">
            {/* ── Welcome Banner ── */}
            <div className="auth-dash-banner">
                <div className="auth-dash-banner-left">
                    <div className="auth-dash-banner-role-row">
                        {isLeader && <Crown size={16} className="auth-dash-crown" />}
                        <span className="auth-dash-banner-role">{isLeader ? "Team Leader" : "Team Member"}</span>
                    </div>
                    <h1 className="auth-dash-banner-name">Welcome back, {user?.full_name || "Authority"}!</h1>
                    <p className="auth-dash-banner-team">{teamName || "Government Authority"}</p>
                </div>
                <div className="auth-dash-banner-right">
                    <div className="auth-dash-zone-pill">
                        <MapPin size={16} />
                        <div>
                            <strong>{zoneName || "—"}</strong>
                            <span>{memberCount} team members</span>
                        </div>
                    </div>
                </div>
            </div>

            {/* ── KPI Row — full width ── */}
            <div className="auth-dash-kpis">
                <Link to="/authority/events" className="auth-dash-kpi auth-kpi-blue">
                    <div className="auth-kpi-icon"><MapPin size={20} /></div>
                    <div>
                        <strong>{metrics.total}</strong>
                        <span>{isLeader ? "Zone Events" : "Assigned to Me"}</span>
                    </div>
                </Link>
                <Link to="/authority/events?status=Reported" className="auth-dash-kpi auth-kpi-amber">
                    <div className="auth-kpi-icon"><AlertCircle size={20} /></div>
                    <div>
                        <strong>{metrics.pending}</strong>
                        <span>Pending</span>
                    </div>
                </Link>
                <Link to="/authority/events?status=UnderReview" className="auth-dash-kpi auth-kpi-purple">
                    <div className="auth-kpi-icon"><Clock size={20} /></div>
                    <div>
                        <strong>{metrics.inProgress}</strong>
                        <span>In Progress</span>
                    </div>
                </Link>
                <Link to="/authority/events?status=Resolved" className="auth-dash-kpi auth-kpi-green">
                    <div className="auth-kpi-icon"><CheckCircle2 size={20} /></div>
                    <div>
                        <strong>{metrics.resolved}</strong>
                        <span>Resolved</span>
                    </div>
                </Link>
            </div>

            {/* ── Middle: Chart + Recent Tickets (tickets only for leaders) ── */}
            <div className={`auth-dash-mid${!isLeader ? " auth-dash-mid-full" : ""}`}>
                {/* Team Performance Chart */}
                <div className="auth-dash-chart-card">
                    <div className="auth-dash-card-head">
                        <div>
                            <h2><TrendingUp size={18} /> Team Performance</h2>
                            <p>Reports in your zone over time</p>
                        </div>
                        <select className="auth-dash-range-select" value={activityRange} onChange={(e) => setActivityRange(Number(e.target.value))}>
                            <option value={7}>Last 7 Days</option>
                            <option value={30}>Last Month</option>
                        </select>
                    </div>
                    {(() => {
                        const cw = 560, ch = 160, padL = 32, padR = 10, padT = 12, padB = 22;
                        const drawW = cw - padL - padR;
                        const drawH = ch - padT - padB;
                        const ySteps = 4;
                        const stepVal = Math.ceil(chartMax / ySteps) || 1;
                        const yMax = stepVal * ySteps;
                        const n = dailyData.length;
                        const pts = dailyData.map((d, i) => ({
                            x: padL + (i / Math.max(n - 1, 1)) * drawW,
                            y: padT + drawH - (d.count / yMax) * drawH,
                        }));
                        let path = `M${pts[0].x},${pts[0].y}`;
                        for (let i = 0; i < pts.length - 1; i++) {
                            const cx = (pts[i].x + pts[i + 1].x) / 2;
                            path += ` C${cx},${pts[i].y} ${cx},${pts[i + 1].y} ${pts[i + 1].x},${pts[i + 1].y}`;
                        }
                        const fillPath = `${path} L${pts[n - 1].x},${padT + drawH} L${pts[0].x},${padT + drawH} Z`;

                        // X labels: show all for <=10, else every Sunday
                        let labelEntries;
                        if (n <= 10) {
                            labelEntries = dailyData.map((d, i) => ({ index: i, label: d.label }));
                        } else {
                            const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
                            labelEntries = weekdays.map((wd, wi) => ({
                                index: Math.round((wi / 6) * (n - 1)),
                                label: wd,
                            }));
                        }
                        const dotSet = new Set(labelEntries.map(e => e.index));

                        return (
                            <svg viewBox={`0 0 ${cw} ${ch}`} className="auth-dash-chart-svg">
                                <defs>
                                    <linearGradient id="authGrad" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="0%" stopColor="#6366f1" stopOpacity="0.2" />
                                        <stop offset="100%" stopColor="#6366f1" stopOpacity="0.01" />
                                    </linearGradient>
                                </defs>
                                {[...Array(ySteps + 1)].map((_, i) => {
                                    const val = yMax - i * stepVal;
                                    const y = padT + (i / ySteps) * drawH;
                                    return (
                                        <g key={`y${i}`}>
                                            <text x={padL - 6} y={y + 3.5} textAnchor="end" fontSize="9" fill="var(--text-muted)">{val}</text>
                                            <line x1={padL} y1={y} x2={cw - padR} y2={y} stroke="var(--border-color)" strokeWidth="0.5" />
                                        </g>
                                    );
                                })}
                                <path d={fillPath} fill="url(#authGrad)" />
                                <path d={path} fill="none" stroke="#6366f1" strokeWidth="2.5" strokeLinecap="round" />
                                {pts.map((p, i) => dotSet.has(i) && <circle key={i} cx={p.x} cy={p.y} r="4" fill="#6366f1" stroke="white" strokeWidth="2" />)}
                                {labelEntries.map((e) => (
                                    <text key={e.index} x={pts[e.index].x} y={ch - 4} textAnchor="middle" fontSize="10" fill="var(--text-muted)">{e.label}</text>
                                ))}
                            </svg>
                        );
                    })()}

                    {/* Quick links below chart */}
                    <div className="auth-dash-quick-links">
                        {isLeader && <Link to="/authority/team" className="auth-dash-qlink"><Users size={15} /> Manage Team</Link>}
                        <Link to="/authority/analytics" className="auth-dash-qlink"><BarChart3 size={15} /> Analytics & Insights</Link>
                        <Link to="/map" className="auth-dash-qlink"><MapIcon size={15} /> Interactive Map</Link>
                    </div>
                </div>

                {/* Recent Ticket Activity — only for Team Leaders */}
                {isLeader && (
                    <div className="auth-dash-ticket-card">
                        <div className="auth-dash-card-head">
                            <div>
                                <h2><MessageSquare size={18} /> Recent Ticket Activity</h2>
                                <p>Active support tickets</p>
                            </div>
                        </div>
                        {openTickets.length === 0 ? (
                            <p className="text-muted" style={{ padding: "1rem", textAlign: "center" }}>No active tickets</p>
                        ) : (
                            <div className="auth-dash-ticket-list">
                                {openTickets.map(t => (
                                    <div key={t.ticket_id} className="auth-dash-ticket-item">
                                        <div className="auth-dash-ticket-info">
                                            <strong>{t.subject}</strong>
                                            <span>from {t.author_name || "Citizen"} · {t.status}</span>
                                        </div>
                                        <span className="auth-dash-ticket-time">{relativeDate(t.updated_at)}</span>
                                    </div>
                                ))}
                            </div>
                        )}
                        <Link to="/authority/help" className="auth-dash-tickets-link">
                            <MessageSquare size={15} /> View All Tickets
                        </Link>
                    </div>
                )}
            </div>

            {/* ── Assigned Reports table — top 4 ── */}
            <div className="auth-dash-table-card">
                <div className="auth-dash-card-head">
                    <div>
                        <h2><FileText size={18} /> Assigned Reports</h2>
                        <p>Recent events in your zone</p>
                    </div>
                    <Link to="/authority/events" className="auth-dash-view-reports-sm">
                        <FileText size={14} /> View Assigned Reports
                    </Link>
                </div>
                <div className="auth-dash-table-wrap">
                    <table className="auth-dash-table">
                        <thead>
                            <tr>
                                <th>Event</th>
                                <th>Severity</th>
                                <th>Status</th>
                                <th>Zone</th>
                                <th>Detected</th>
                                <th></th>
                            </tr>
                        </thead>
                        <tbody>
                            {events.slice(0, 4).map(e => (
                                <tr key={e.event_id}>
                                    <td style={{ fontFamily: "monospace", fontWeight: 600, color: "var(--primary)" }}>{(e.event_id || "").slice(0, 8)}</td>
                                    <td>
                                        <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                                            <span style={{ width: 8, height: 8, borderRadius: "50%", background: severityColor(e.severity) }} />
                                            {e.severity}
                                        </span>
                                    </td>
                                    <td><span className={`auth-dash-status auth-s-${(e.lifecycle_status || "").toLowerCase()}`}>{e.lifecycle_status}</span></td>
                                    <td>{e.zone || "—"}</td>
                                    <td>{relativeDate(e.created_at)}</td>
                                    <td><Link to={`/authority/events/${e.event_id}/update`} className="auth-dash-view"><Eye size={14} /></Link></td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}
