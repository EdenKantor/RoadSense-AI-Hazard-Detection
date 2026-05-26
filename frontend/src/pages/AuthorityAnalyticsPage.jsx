/**
 * Authority analytics page.
 *
 * Authority/Admin read-only analytics dashboard for the user's zone. Shows
 * four KPI cards (Total / Resolved / Pending / In Progress), a "Events by
 * Status" pie (rendered as a CSS conic-gradient with a value legend), an
 * "Events by Severity" horizontal bar group, and a stacked-bar Trending
 * Events chart over a Sun-Sat 7-day window or a 4-week 30-day window
 * (toggle in the chart header). The trending series is fetched fresh from
 * authorityApi.analytics whenever the range changes; the other panels are
 * derived client-side from the full assigned-events list. No mutations.
 */

import { useEffect, useMemo, useState } from "react";
import { BarChart3, Clock, CheckCircle2, AlertCircle, MapPin } from "lucide-react";
import { authorityApi } from "../api/client";

/** Collapse a backend lifecycle status to the Pending/Under Review/In Progress/Resolved/Closed buckets used by the charts. */
function mapStatus(status) {
    if (status === "Reported") return "Pending";
    if (status === "UnderReview") return "Under Review";
    if (status === "Scheduled") return "In Progress";
    if (status === "Resolved") return "Resolved";
    if (status === "Closed") return "Closed";
    return "Pending";
}

const PIE_COLORS = { Pending: "#f59e0b", "Under Review": "#3b82f6", "In Progress": "#8b5cf6", Resolved: "#10b981", Closed: "#6b7280" };
const SEV_COLORS = { High: "#ef4444", Medium: "#f59e0b", Low: "#3b82f6" };
const TREND_COLORS = { pending: "#f59e0b", in_progress: "#8b5cf6", resolved: "#10b981" };

/** Authority analytics: KPIs, status pie, severity bars, and trending stacked-bar chart. */
export default function AuthorityAnalyticsPage() {
    const [events, setEvents] = useState([]);
    const [analytics, setAnalytics] = useState(null);
    const [loading, setLoading] = useState(true);
    const [trendRange, setTrendRange] = useState(7);

    useEffect(() => {
        setLoading(true);
        Promise.all([
            authorityApi.events().then(r => setEvents(r.data || [])),
            authorityApi.analytics({ days: trendRange }).then(r => setAnalytics(r.data)),
        ]).catch(() => {}).finally(() => setLoading(false));
    }, [trendRange]);

    const statusCounts = useMemo(() => {
        const c = { Pending: 0, "Under Review": 0, "In Progress": 0, Resolved: 0, Closed: 0 };
        events.forEach(e => { c[mapStatus(e.lifecycle_status)] += 1; });
        return c;
    }, [events]);

    const severityCounts = useMemo(() => {
        const c = { High: 0, Medium: 0, Low: 0 };
        events.forEach(e => { c[e.severity] = (c[e.severity] || 0) + 1; });
        return c;
    }, [events]);

    const total = events.length;
    const resolved = (statusCounts.Resolved || 0) + (statusCounts.Closed || 0);
    const pending = statusCounts.Pending || 0;
    const inProgress = (statusCounts["In Progress"] || 0) + (statusCounts["Under Review"] || 0);

    const totalPie = Math.max(1, Object.values(statusCounts).reduce((s, v) => s + v, 0));
    const maxSev = Math.max(1, ...Object.values(severityCounts));

    const piePcts = Object.entries(statusCounts).reduce((acc, [k, v]) => {
        const pct = (v / totalPie) * 100;
        acc.push({ label: k, pct, start: acc.length ? acc[acc.length - 1].start + acc[acc.length - 1].pct : 0 });
        return acc;
    }, []);
    const pieGrad = `conic-gradient(${piePcts.map(p => `${PIE_COLORS[p.label]} ${p.start}% ${p.start + p.pct}%`).join(", ")})`;

    const trending = analytics?.trending || [];
    const trendMax = Math.max(1, ...trending.map(d => d.pending + d.in_progress + d.resolved));

    if (loading) return <div className="auth-analytics"><p className="text-muted" style={{ padding: "2rem" }}>Loading analytics...</p></div>;

    return (
        <div className="auth-analytics">
            <div className="aa-header">
                <h1 className="aa-title"><BarChart3 size={24} /> Analytics & Insights</h1>
                <p className="aa-sub">Performance metrics and event trends</p>
            </div>

            {/* KPI Row */}
            <div className="aa-kpis">
                <div className="aa-kpi"><div className="aa-kpi-icon" style={{ background: "#dbeafe", color: "#2563eb" }}><MapPin size={20} /></div><div><span className="aa-kpi-label">Total Events</span><strong className="aa-kpi-value">{total}</strong></div></div>
                <div className="aa-kpi"><div className="aa-kpi-icon" style={{ background: "#dcfce7", color: "#16a34a" }}><CheckCircle2 size={20} /></div><div><span className="aa-kpi-label">Resolved</span><strong className="aa-kpi-value">{resolved}</strong></div></div>
                <div className="aa-kpi"><div className="aa-kpi-icon" style={{ background: "#fef3c7", color: "#d97706" }}><AlertCircle size={20} /></div><div><span className="aa-kpi-label">Pending</span><strong className="aa-kpi-value">{pending}</strong></div></div>
                <div className="aa-kpi"><div className="aa-kpi-icon" style={{ background: "#ede9fe", color: "#7c3aed" }}><Clock size={20} /></div><div><span className="aa-kpi-label">In Progress</span><strong className="aa-kpi-value">{inProgress}</strong></div></div>
            </div>

            {/* Status + Severity */}
            <div className="aa-row2">
                <div className="aa-card">
                    <h2 className="aa-card-title">Events by Status</h2>
                    <div className="aa-pie-wrap">
                        <div className="aa-pie" style={{ background: pieGrad }} />
                        <div className="aa-pie-legend">
                            {Object.entries(statusCounts).map(([label, value]) => (
                                <div key={label} className="aa-legend-row">
                                    <span className="aa-legend-dot" style={{ background: PIE_COLORS[label] }} />
                                    <span className="aa-legend-label">{label}</span>
                                    <strong>{value}</strong>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
                <div className="aa-card">
                    <h2 className="aa-card-title">Events by Severity</h2>
                    <div className="aa-sev-bars">
                        {Object.entries(severityCounts).map(([label, value]) => (
                            <div key={label} className="aa-sev-item">
                                <div className="aa-sev-head"><span>{label}</span><strong>{value}</strong></div>
                                <div className="aa-sev-track"><div className="aa-sev-fill" style={{ width: `${(value / maxSev) * 100}%`, background: SEV_COLORS[label] }} /></div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            {/* Trending Events — full width SVG chart */}
            <div className="aa-card">
                <div className="aa-card-head">
                    <div>
                        <h2 className="aa-card-title" style={{ margin: 0 }}>Trending Events</h2>
                        <p style={{ margin: "2px 0 0", fontSize: "0.78rem", color: "var(--text-muted)" }}>Event volume by status over time</p>
                    </div>
                    <div className="aa-trend-toggle">
                        <button className={trendRange === 7 ? "aa-toggle-active" : ""} onClick={() => setTrendRange(7)}>Last 7 Days</button>
                        <button className={trendRange === 30 ? "aa-toggle-active" : ""} onClick={() => setTrendRange(30)}>Last 30 Days</button>
                    </div>
                </div>
                <div className="aa-trend-legend">
                    <span><span className="aa-legend-dot" style={{ background: TREND_COLORS.pending }} /> Pending</span>
                    <span><span className="aa-legend-dot" style={{ background: TREND_COLORS.in_progress }} /> In Progress</span>
                    <span><span className="aa-legend-dot" style={{ background: TREND_COLORS.resolved }} /> Resolved</span>
                </div>

                {/* SVG stacked bar chart */}
                {(() => {
                    const n = trending.length;
                    if (n === 0) return <p className="text-muted" style={{ textAlign: "center", padding: "2rem" }}>No data</p>;

                    const cw = 800, ch = 180, padL = 34, padR = 14, padT = 12, padB = 24;
                    const drawW = cw - padL - padR;
                    const drawH = ch - padT - padB;
                    const ySteps = 4;
                    const stepVal = Math.ceil(trendMax / ySteps) || 1;
                    const yMax = stepVal * ySteps;
                    const slotW = drawW / n;
                    const barW = Math.min(22, slotW * 0.6);

                    // Helper: x center of bar i
                    const barX = (i) => padL + slotW * i + slotW / 2;

                    // X labels
                    let xLabels;
                    if (n <= 10) {
                        // 7 days: Sun Mon Tue Wed Thu Fri Sat
                        xLabels = trending.map((d, i) => ({ i, label: d.day }));
                    } else {
                        // 30 days: Week 1-4, label at first day of each week
                        const daysPerWeek = 7;
                        const numWeeks = Math.ceil(n / daysPerWeek);
                        xLabels = [];
                        for (let w = 0; w < numWeeks; w++) {
                            const startIdx = w * daysPerWeek;
                            if (startIdx < n) xLabels.push({ i: startIdx, label: `Week ${w + 1}` });
                        }
                    }

                    return (
                        <svg viewBox={`0 0 ${cw} ${ch}`} style={{ width: "100%", display: "block" }}>
                            {/* Y axis + grid */}
                            {[...Array(ySteps + 1)].map((_, si) => {
                                const val = yMax - si * stepVal;
                                const y = padT + (si / ySteps) * drawH;
                                return (
                                    <g key={`y${si}`}>
                                        <text x={padL - 6} y={y + 3.5} textAnchor="end" fontSize="9" fill="var(--text-muted)">{val}</text>
                                        <line x1={padL} y1={y} x2={cw - padR} y2={y} stroke="var(--border-color)" strokeWidth="0.5" />
                                    </g>
                                );
                            })}
                            {/* Bars */}
                            {trending.map((d, i) => {
                                const cx = barX(i);
                                const baseY = padT + drawH;
                                const pH = (d.pending / yMax) * drawH;
                                const iH = (d.in_progress / yMax) * drawH;
                                const rH = (d.resolved / yMax) * drawH;
                                return (
                                    <g key={d.date}>
                                        <rect x={cx - barW / 2} y={baseY - pH} width={barW} height={Math.max(0, pH)} fill={TREND_COLORS.pending} rx="2" />
                                        <rect x={cx - barW / 2} y={baseY - pH - iH} width={barW} height={Math.max(0, iH)} fill={TREND_COLORS.in_progress} rx="2" />
                                        <rect x={cx - barW / 2} y={baseY - pH - iH - rH} width={barW} height={Math.max(0, rH)} fill={TREND_COLORS.resolved} rx="2" />
                                    </g>
                                );
                            })}
                            {/* X labels */}
                            {xLabels.map((e) => (
                                <text key={e.i} x={barX(e.i)} y={ch - 5} textAnchor="middle" fontSize="10" fill="var(--text-muted)">{e.label}</text>
                            ))}
                        </svg>
                    );
                })()}

                <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "0.5rem" }}>
                    Showing {trending.length > 0 ? `${trending[0].date} → ${trending[trending.length - 1].date}` : "—"} · {trending.reduce((s, d) => s + d.pending + d.in_progress + d.resolved, 0)} total events
                </div>
            </div>
        </div>
    );
}
