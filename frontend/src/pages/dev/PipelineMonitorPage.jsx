/**
 * PipelineMonitorPage — dev-only observability dashboard for engineers
 * working on the RoadSenseAI pipeline (not exposed to citizens, authorities,
 * or admins via any nav link). Lives at /dev/pipeline-monitor as a public
 * route — NOT wrapped in ProtectedRoute or RoleRoute — but gated by the
 * backend's DEV_MODE flag: when DEV_MODE=false the SSE endpoint returns
 * 404 and we render a friendly "dev mode disabled" message.
 *
 * Shows a metrics bar (total events, avg latency, throughput, success rate)
 * plus four live panels in a 2x2 grid (stacks on mobile <768px):
 *   1. Redis Queue        — counters + pending job IDs + recent job history
 *   2. Workers            — one card per worker (status, stage progress, session counters)
 *   3. Pipeline Stages    — one row per active/recent upload, 8-step stepper
 *   4. MongoDB Activity   — scrolling feed of EVENT_CREATED / MERGED / REOPENED
 *
 * Enables: opening per-job detail modals (timeline + stats + linked events)
 * and full-size image previews for any event in the activity feed. All
 * state is push-driven via SSE; there are no manual refresh buttons.
 *
 * Connection badge in the header: Connected (green) / Disconnected (red) /
 * Reconnecting (yellow) with backoff countdown.
 */

import { useEffect, useRef, useState } from "react";
import useObservabilityStream, { STAGE_ORDER } from "./useObservabilityStream";

const STAGE_LABELS = {
    gpx_parse: "GPX parse",
    frame_sample: "Frame sample",
    yolo_inference: "YOLO inference",
    confidence_filter: "Confidence filter",
    timestamp_align: "Timestamp align",
    dbscan_consolidation: "DBSCAN consolidation",
    severity_heuristic: "Severity heuristic",
    persist_dedup: "Persist + Dedup",
};

function classNames(...parts) {
    return parts.filter(Boolean).join(" ");
}

function fmtMs(ms) {
    if (ms == null) return "—";
    if (ms < 1000) return `${ms} ms`;
    return `${(ms / 1000).toFixed(2)} s`;
}

function fmtTime(iso) {
    if (!iso) return "—";
    try { return new Date(iso).toLocaleTimeString(); } catch (_) { return iso; }
}

function shortId(id) {
    if (!id) return "—";
    return String(id).slice(0, 8);
}

// Convert a worker-stored frame path (could be absolute Windows or relative)
// to a /static/output URL the browser can fetch via the Vite proxy.
// The path's last two segments are <upload_id>/<basename>; everything before
// is whatever the worker wrote (project root prefix etc.) which we discard.
function thumbUrl(p) {
    if (!p) return null;
    const parts = String(p).replaceAll("\\", "/").split("/").filter(Boolean);
    if (parts.length < 2) return null;
    return `/static/output/${parts[parts.length - 2]}/${parts[parts.length - 1]}`;
}

function fmtRelative(iso) {
    if (!iso) return "—";
    const t = Date.parse(iso);
    if (Number.isNaN(t)) return "—";
    const sec = Math.floor((Date.now() - t) / 1000);
    if (sec < 1) return "just now";
    if (sec < 60) return `${sec}s ago`;
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min}m ago`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}h ago`;
    const day = Math.floor(hr / 24);
    return `${day}d ago`;
}

// ───────────────────── Focus trap + modal helpers ──────────
/**
 * Tiny library-free focus trap. Captures the previously focused element on
 * mount, focuses the first focusable inside, traps Tab cycling within the
 * container, and restores focus on unmount. When two modals stack, only the
 * topmost is mounted at a time, so the cycle naturally stays in the topmost.
 */
function FocusTrap({ children }) {
    const ref = useRef(null);
    useEffect(() => {
        const node = ref.current;
        if (!node) return undefined;
        const previouslyFocused = document.activeElement;
        const focusables = node.querySelectorAll(
            'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        (focusables[0] || node).focus();

        const handler = (e) => {
            if (e.key !== "Tab") return;
            const list = Array.from(node.querySelectorAll(
                'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
            )).filter((el) => !el.disabled);
            if (list.length === 0) return;
            const first = list[0];
            const last = list[list.length - 1];
            if (e.shiftKey && document.activeElement === first) {
                e.preventDefault(); last.focus();
            } else if (!e.shiftKey && document.activeElement === last) {
                e.preventDefault(); first.focus();
            }
        };
        node.addEventListener("keydown", handler);
        return () => {
            node.removeEventListener("keydown", handler);
            if (previouslyFocused && previouslyFocused.focus) previouslyFocused.focus();
        };
    }, []);
    return <div ref={ref} tabIndex={-1} className="dpm-modal-focuswrap">{children}</div>;
}

// ───────────────────── Image modal (Step 1) ────────────────
/** Full-size image preview for a MongoDB activity event. Layers on top of the job-detail modal. */
function ImageModal({ event, onClose }) {
    const [imgErrored, setImgErrored] = useState(false);
    if (!event) return null;
    const src = thumbUrl(event.frame_thumbnail_path);
    return (
        <div
            className="dpm-modal-backdrop dpm-modal-backdrop-image"
            onClick={onClose}
            role="presentation"
        >
            <FocusTrap>
                <div
                    className="dpm-modal dpm-modal-image"
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="dpm-image-modal-title"
                    onClick={(e) => e.stopPropagation()}
                >
                    <button className="dpm-modal-close" onClick={onClose} aria-label="Close">×</button>
                    <h2 id="dpm-image-modal-title" className="dpm-sr-only">Event preview</h2>
                    <div className="dpm-modal-image-frame">
                        {src && !imgErrored ? (
                            <img
                                src={src}
                                alt=""
                                loading="lazy"
                                onError={() => setImgErrored(true)}
                            />
                        ) : (
                            <div className="dpm-modal-image-fallback" aria-hidden="true">📷</div>
                        )}
                    </div>
                    <div className="dpm-modal-meta-row">
                        {event.severity && <SeverityBadge severity={event.severity} />}
                        <span className="dpm-activity-loc-mono">
                            {event.location
                                ? `${event.location.lat?.toFixed?.(5) ?? "?"}, ${event.location.lon?.toFixed?.(5) ?? "?"}`
                                : "—"}
                        </span>
                        {typeof event.avg_confidence === "number" && (
                            <span className="dpm-modal-meta-conf">
                                conf {(event.avg_confidence * 100).toFixed(0)}%
                            </span>
                        )}
                        {event.upload_id && (
                            <code className="dpm-activity-id">{shortId(event.upload_id)}</code>
                        )}
                        <span className="dpm-relative-time">{fmtRelative(event.timestamp)}</span>
                    </div>
                </div>
            </FocusTrap>
        </div>
    );
}

// ───────────────────── Job detail modal (Step 3) ───────────
// Pulls everything for a single upload from `uploadStages` + filters
// `mongoActivity` for the upload_id. No new SSE events.
const STAGE_STATS_MAP = {
    frame_sample:        { metric: "frames_sampled",     label: "Frames sampled" },
    yolo_inference:      { metric: "raw_detections",     label: "Raw detections" },
    confidence_filter:   { metric: "filtered_detections", label: "Filtered detections" },
    timestamp_align:     { metric: "aligned_detections", label: "Aligned detections" },
    dbscan_consolidation: { metric: "clusters",          label: "Clusters" },
    persist_dedup:       { metric: "events_persisted",   label: "Events persisted" },
};

function TimelineRow({ sid, stage }) {
    const state = stage?.state || "pending";
    const icon = state === "done" ? "✓" : state === "failed" ? "✗" : state === "active" ? "…" : "○";
    let timeLabel = "—";
    if (state === "done" && stage?.started_at && typeof stage.duration_ms === "number") {
        try {
            const finished = new Date(Date.parse(stage.started_at) + stage.duration_ms);
            timeLabel = finished.toLocaleTimeString();
        } catch (_) { /* ignore */ }
    } else if (state === "active") {
        timeLabel = "in progress";
    }
    return (
        <li className={classNames("dpm-timeline-row", `dpm-timeline-row-${state}`)}>
            <span className={classNames("dpm-timeline-icon", `dpm-timeline-icon-${state}`)} aria-hidden="true">{icon}</span>
            <span className="dpm-timeline-label">{STAGE_LABELS[sid] || sid}</span>
            <span className="dpm-timeline-dur">{state === "done" ? fmtMs(stage.duration_ms) : (state === "failed" ? "failed" : "—")}</span>
            <span className="dpm-timeline-time">{timeLabel}</span>
        </li>
    );
}

function ModalEventCard({ a, onOpenImage }) {
    const isDedup = a.type === "dedup_hit";
    return (
        <article className="dpm-modal-event-card">
            <EventThumb
                src={thumbUrl(a.frame_thumbnail_path)}
                isDedup={isDedup}
                onClick={onOpenImage ? () => onOpenImage(a) : undefined}
            />
            <div className="dpm-modal-event-meta">
                <SeverityBadge severity={a.severity} />
                {typeof a.avg_confidence === "number" && (
                    <span className="dpm-modal-event-conf">
                        {(a.avg_confidence * 100).toFixed(0)}%
                    </span>
                )}
                <span className="dpm-modal-event-loc">
                    {a.location
                        ? `${a.location.lat?.toFixed?.(3) ?? "?"}, ${a.location.lon?.toFixed?.(3) ?? "?"}`
                        : "—"}
                </span>
            </div>
        </article>
    );
}

function JobDetailModal({ upload, mongoActivity, onOpenImage, onClose }) {
    if (!upload) return null;
    const events = (mongoActivity || []).filter((a) => a.upload_id === upload.upload_id);
    const stateLabel = upload.state === "done" ? "DONE" : upload.state === "failed" ? "FAILED" : "LIVE";
    return (
        <div
            className="dpm-modal-backdrop"
            onClick={onClose}
            role="presentation"
        >
            <FocusTrap>
                <div
                    className="dpm-modal dpm-modal-detail"
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="dpm-job-modal-title"
                    onClick={(e) => e.stopPropagation()}
                >
                    <button className="dpm-modal-close" onClick={onClose} aria-label="Close">×</button>

                    {/* Header */}
                    <header className="dpm-modal-header">
                        <h2 id="dpm-job-modal-title">Job detail</h2>
                    </header>
                    <div className="dpm-modal-body">
                        <section className="dpm-modal-section">
                            <div className="dpm-modal-detail-head">
                                <code className="dpm-modal-detail-id">{upload.upload_id}</code>
                                <span className={classNames("dpm-pill", `dpm-pill-state-${upload.state}`)}>{stateLabel}</span>
                            </div>
                            <div className="dpm-modal-detail-sub">
                                <span><strong>Worker:</strong> {upload.worker_id || "—"}</span>
                                <span><strong>Total:</strong> {fmtMs(upload.total_duration_ms)}</span>
                                {upload.job_id && <span><strong>Job ID:</strong> <code>{shortId(upload.job_id)}</code></span>}
                            </div>
                            {upload.state === "failed" && (
                                <div className="dpm-stage-error" style={{ marginTop: "0.6rem" }}>
                                    <strong>{upload.error_class}:</strong> {upload.error_message}
                                </div>
                            )}
                        </section>

                        {/* Pipeline Timeline */}
                        <section className="dpm-modal-section">
                            <h3 className="dpm-modal-section-title">Pipeline Timeline</h3>
                            <ol className="dpm-timeline">
                                {STAGE_ORDER.map((sid) => (
                                    <TimelineRow key={sid} sid={sid} stage={upload.stages?.[sid]} />
                                ))}
                            </ol>
                        </section>

                        {/* Stats */}
                        <section className="dpm-modal-section">
                            <h3 className="dpm-modal-section-title">Stats</h3>
                            <div className="dpm-modal-stats-grid">
                                {Object.entries(STAGE_STATS_MAP).map(([sid, def]) => {
                                    const v = upload.stages?.[sid]?.metrics?.[def.metric];
                                    const display = (typeof v === "number") ? v.toLocaleString() : "—";
                                    return (
                                        <div key={`${sid}-${def.metric}`} className="dpm-modal-stat">
                                            <div className="dpm-modal-stat-value">{display}</div>
                                            <div className="dpm-modal-stat-label">{def.label}</div>
                                        </div>
                                    );
                                })}
                                {/* Duplicates suppressed comes from the same persist_dedup stage. */}
                                {(() => {
                                    const dup = upload.stages?.persist_dedup?.metrics?.duplicates_suppressed;
                                    return (
                                        <div className="dpm-modal-stat">
                                            <div className="dpm-modal-stat-value">{typeof dup === "number" ? dup.toLocaleString() : "—"}</div>
                                            <div className="dpm-modal-stat-label">Duplicates suppressed</div>
                                        </div>
                                    );
                                })()}
                            </div>
                        </section>

                        {/* Events Created */}
                        <section className="dpm-modal-section">
                            <h3 className="dpm-modal-section-title">
                                Events created ({events.length})
                            </h3>
                            {events.length === 0 ? (
                                <div className="dpm-empty">No events have arrived in the activity feed for this job yet.</div>
                            ) : (
                                <div className="dpm-modal-events-grid">
                                    {events.map((a) => (
                                        <ModalEventCard key={a.id} a={a} onOpenImage={onOpenImage} />
                                    ))}
                                </div>
                            )}
                        </section>
                    </div>
                </div>
            </FocusTrap>
        </div>
    );
}

// ───────────────────── disabled banner ─────────────────────
function DisabledBanner() {
    return (
        <div className="dpm-page dpm-disabled">
            <div className="dpm-disabled-card">
                <h1>Dev mode disabled</h1>
                <p>This dashboard is only available when the backend is started with <code>DEV_MODE=true</code>.</p>
                <p>To enable it, set <code>DEV_MODE=true</code> in <code>backend/.env</code> and restart the backend.</p>
            </div>
        </div>
    );
}

// ───────────────────── Metrics bar ─────────────────────────
function MetricCard({ label, value, accent }) {
    return (
        <div className={classNames("dpm-metric-card", `dpm-metric-${accent}`)}>
            <div className="dpm-metric-value">{value}</div>
            <div className="dpm-metric-label">{label}</div>
        </div>
    );
}

function MetricsBar({ metrics }) {
    const total = metrics.totalEvents > 0 ? metrics.totalEvents.toLocaleString() : "--";
    const latency = metrics.avgLatencyMs != null
        ? `${(metrics.avgLatencyMs / 1000).toFixed(1)}s`
        : "--";
    const throughput = metrics.throughputPerMin > 0
        ? `${metrics.throughputPerMin.toFixed(1)}/min`
        : "--";
    const success = metrics.successRatePct != null
        ? `${metrics.successRatePct.toFixed(0)}%`
        : "--";
    return (
        <div className="dpm-metrics-bar">
            <MetricCard label="Total Events"  value={total}      accent="blue"   />
            <MetricCard label="Avg Latency"   value={latency}    accent="purple" />
            <MetricCard label="Throughput"    value={throughput} accent="amber"  />
            <MetricCard label="Success Rate"  value={success}    accent="green"  />
        </div>
    );
}

// ───────────────────── Connection badge ────────────────────
function ConnectionBadge({ status, reconnectIn, lastEventAt }) {
    // Apply pulse class for ~600ms after each lastEventAt bump.
    const [pulsing, setPulsing] = useState(false);
    useEffect(() => {
        if (!lastEventAt) return undefined;
        setPulsing(true);
        const t = setTimeout(() => setPulsing(false), 600);
        return () => clearTimeout(t);
    }, [lastEventAt]);

    const labelMap = {
        connecting: "Connecting…",
        connected: "Connected",
        disconnected: "Disconnected",
        reconnecting: reconnectIn != null ? `Reconnecting in ${(reconnectIn / 1000).toFixed(1)}s…` : "Reconnecting…",
    };
    return (
        <div
            className={classNames(
                "dpm-conn-badge",
                `dpm-conn-${status}`,
                pulsing && status === "connected" && "dpm-conn-pill-pulse",
            )}
            aria-live="polite"
        >
            <span className="dpm-conn-dot" />
            {labelMap[status] || status}
        </div>
    );
}

// ───────────────────── 1. Queue panel ──────────────────────
function QueuePendingView({ queue }) {
    const c = queue?.counts || { pending: 0, started: 0, finished: 0, failed: 0 };
    const ids = queue?.pending_job_ids || [];
    return (
        <div className="dpm-tab-panel">
            <div className="dpm-counter-grid">
                <div className="dpm-counter dpm-counter-pending">
                    <div className="dpm-counter-label">Pending</div>
                    <div className="dpm-counter-num">{c.pending}</div>
                </div>
                <div className="dpm-counter dpm-counter-started">
                    <div className="dpm-counter-label">Started</div>
                    <div className="dpm-counter-num">{c.started}</div>
                </div>
                <div className="dpm-counter dpm-counter-finished">
                    <div className="dpm-counter-label">Finished</div>
                    <div className="dpm-counter-num">{c.finished}</div>
                </div>
                <div className="dpm-counter dpm-counter-failed">
                    <div className="dpm-counter-label">Failed</div>
                    <div className="dpm-counter-num">{c.failed}</div>
                </div>
            </div>
            <div className="dpm-list-block">
                <div className="dpm-list-title">Pending job IDs ({ids.length})</div>
                {ids.length === 0 ? (
                    <div className="dpm-empty">No pending jobs</div>
                ) : (
                    <ul className="dpm-jobid-list">
                        {ids.map((id) => <li key={id}><code>{id}</code></li>)}
                    </ul>
                )}
            </div>
        </div>
    );
}

function QueueHistoryView({ jobHistory }) {
    if (!jobHistory || jobHistory.length === 0) {
        return (
            <div className="dpm-tab-panel">
                <div className="dpm-empty">No completed jobs yet. Upload a video to populate the history.</div>
            </div>
        );
    }
    return (
        <div className="dpm-tab-panel">
            <ul className="dpm-history-list">
                {jobHistory.map((h) => {
                    const isFailed = h.status === "FAILED";
                    return (
                        <li
                            key={h.key}
                            className={classNames(
                                "dpm-history-row",
                                isFailed ? "dpm-history-row-failed" : "dpm-history-row-done",
                            )}
                        >
                            <div className="dpm-history-row-l1">
                                <code className="dpm-activity-id">{shortId(h.job_id || h.upload_id)}</code>
                                <span className={classNames("dpm-pill", isFailed ? "dpm-pill-state-failed" : "dpm-pill-state-done")}>
                                    {h.status}
                                </span>
                                <span className="dpm-history-worker">{h.worker_id || "—"}</span>
                                <span className="dpm-relative-time">{fmtRelative(h.completed_at)}</span>
                            </div>
                            <div className="dpm-history-row-l2">
                                {isFailed ? (
                                    <span className="dpm-history-error">
                                        {h.error_class ? `${h.error_class}: ` : ""}{h.error_message || "(no error message)"}
                                    </span>
                                ) : (
                                    <>
                                        <span className="dpm-history-meta">
                                            {fmtMs(h.duration_ms)}
                                        </span>
                                        {typeof h.events_persisted === "number" && (
                                            <span className="dpm-history-meta">
                                                · {h.events_persisted} events
                                            </span>
                                        )}
                                        {typeof h.duplicates_suppressed === "number" && h.duplicates_suppressed > 0 && (
                                            <span className="dpm-history-meta">
                                                · {h.duplicates_suppressed} dedup
                                            </span>
                                        )}
                                    </>
                                )}
                            </div>
                        </li>
                    );
                })}
            </ul>
        </div>
    );
}

function QueuePanel({ queue, jobHistory }) {
    const [tab, setTab] = useState("pending");
    return (
        <section className="dpm-panel">
            <header className="dpm-panel-head">
                <h2>Redis Queue</h2>
                <span className="dpm-panel-sub">queue: <code>roadsense</code></span>
            </header>
            <div className="dpm-queue-tabs" role="tablist" aria-label="Queue views">
                <button
                    type="button"
                    role="tab"
                    aria-selected={tab === "pending"}
                    className={classNames("dpm-queue-tab", tab === "pending" && "dpm-queue-tab-active")}
                    onClick={() => setTab("pending")}
                >
                    Pending
                </button>
                <button
                    type="button"
                    role="tab"
                    aria-selected={tab === "history"}
                    className={classNames("dpm-queue-tab", tab === "history" && "dpm-queue-tab-active")}
                    onClick={() => setTab("history")}
                >
                    History ({jobHistory?.length || 0})
                </button>
            </div>
            {tab === "pending"
                ? <QueuePendingView queue={queue} />
                : <QueueHistoryView jobHistory={jobHistory} />}
        </section>
    );
}

// ───────────────────── 2. Workers panel ────────────────────
function WorkerProgressDots({ uploadStages, currentUploadId }) {
    const stages = uploadStages?.[currentUploadId]?.stages || {};
    const doneCount = STAGE_ORDER.filter((sid) => stages[sid]?.state === "done").length;
    return (
        <div className="dpm-worker-progress" title={`${doneCount}/${STAGE_ORDER.length} stages complete`}>
            {STAGE_ORDER.map((sid) => {
                const state = stages[sid]?.state || "pending";
                return (
                    <span
                        key={sid}
                        className={classNames("dpm-worker-progress-dot", `dpm-dot-${state}`)}
                    />
                );
            })}
            <span className="dpm-worker-progress-text">{doneCount}/{STAGE_ORDER.length}</span>
        </div>
    );
}

function WorkersPanel({ workers, uploadStages, workerSession }) {
    return (
        <section className="dpm-panel">
            <header className="dpm-panel-head">
                <h2>Workers</h2>
                <span className="dpm-panel-sub">{workers.length} registered</span>
            </header>
            {workers.length === 0 ? (
                <div className="dpm-empty">No workers connected to Redis. Start them with <code>worker_supervisor.py</code>.</div>
            ) : (
                <div className="dpm-worker-grid">
                    {workers.map((w) => {
                        const session = workerSession?.[w.worker_id] || { session_jobs: 0, last_duration_ms: null };
                        const isBusy = w.status === "busy";
                        const stageLabel = w.current_stage_id ? (STAGE_LABELS[w.current_stage_id] || w.current_stage_id) : null;
                        return (
                            <article key={w.worker_id} className={classNames("dpm-worker-card", `dpm-worker-${w.status}`)}>
                                <div className="dpm-worker-head">
                                    <span className="dpm-worker-id">{w.worker_id}</span>
                                    <span className={classNames("dpm-pill", `dpm-pill-${w.status}`)}>{w.status}</span>
                                </div>
                                {isBusy ? (
                                    <>
                                        <div className="dpm-worker-busy-line">
                                            <code>{w.current_upload_id ? shortId(w.current_upload_id) : "—"}</code>
                                            <span className="dpm-worker-busy-sep">•</span>
                                            <span className="dpm-worker-busy-stage">{stageLabel || "—"}</span>
                                        </div>
                                        <WorkerProgressDots
                                            uploadStages={uploadStages}
                                            currentUploadId={w.current_upload_id}
                                        />
                                    </>
                                ) : (
                                    <div className="dpm-worker-idle-line">Idle — waiting for jobs</div>
                                )}
                                <div className="dpm-worker-row">
                                    <span className="dpm-k">Last duration</span>
                                    <span className="dpm-v">{fmtMs(session.last_duration_ms)}</span>
                                </div>
                                <div className="dpm-worker-row">
                                    <span className="dpm-k">Jobs (session)</span>
                                    <span className="dpm-v">{session.session_jobs}</span>
                                </div>
                                <div className="dpm-worker-row dpm-worker-counter">
                                    <span
                                        className="dpm-k"
                                        title="RQ-reported lifetime counter. Resets only when this worker process restarts."
                                    >
                                        Lifetime <span className="dpm-info">ⓘ</span>
                                    </span>
                                    <span className="dpm-v">{w.jobs_processed_total ?? 0}</span>
                                </div>
                            </article>
                        );
                    })}
                </div>
            )}
        </section>
    );
}

// ───────────────────── 3. Pipeline Stages panel ────────────
// Opacity tier by row age (0 = newest). Live job always 1.0.
const AGE_OPACITY = [1.0, 0.8, 0.65, 0.5, 0.35];
function opacityForAge(idx, isLive) {
    if (isLive) return 1.0;
    return AGE_OPACITY[Math.min(idx, AGE_OPACITY.length - 1)];
}

function activeStageInfo(u) {
    // Returns {label, elapsedMs} for the currently active stage, or null.
    for (const sid of STAGE_ORDER) {
        const st = u.stages?.[sid];
        if (st?.state === "active") {
            const startedAt = st.started_at ? Date.parse(st.started_at) : null;
            const elapsedMs = startedAt ? Math.max(0, Date.now() - startedAt) : null;
            return { stage_id: sid, label: STAGE_LABELS[sid] || sid, elapsedMs };
        }
    }
    return null;
}

function totalDurationLabel(u) {
    if (u.state === "done" && typeof u.total_duration_ms === "number") return fmtMs(u.total_duration_ms);
    if (u.state === "failed") return "failed";
    const active = activeStageInfo(u);
    if (active) {
        const elapsed = active.elapsedMs != null ? ` (${(active.elapsedMs / 1000).toFixed(1)}s)` : "";
        return `currently: ${active.label}${elapsed}`;
    }
    return "—";
}

function JobHistoryRow({ upload, ageIndex, isLive, onOpenDetail }) {
    const u = upload;
    const opacity = opacityForAge(ageIndex, isLive);
    const stateLabel = u.state === "done" ? "DONE" : u.state === "failed" ? "FAILED" : "LIVE";
    const handleKey = (e) => {
        if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onOpenDetail?.(u);
        }
    };
    return (
        <li
            className={classNames(
                "dpm-job-row",
                `dpm-job-row-${u.state}`,
                isLive && "dpm-job-row-live",
                onOpenDetail && "dpm-job-row-clickable",
            )}
            style={{ opacity }}
            role={onOpenDetail ? "button" : undefined}
            tabIndex={onOpenDetail ? 0 : undefined}
            onClick={onOpenDetail ? () => onOpenDetail(u) : undefined}
            onKeyDown={onOpenDetail ? handleKey : undefined}
            aria-label={onOpenDetail ? `Open detail for upload ${shortId(u.upload_id)}` : undefined}
        >
            <div className="dpm-job-row-head">
                <code className="dpm-stage-upload">{shortId(u.upload_id)}</code>
                <span className="dpm-stage-worker">{u.worker_id || "—"}</span>
                <span className={classNames("dpm-pill", `dpm-pill-state-${u.state}`, isLive && "dpm-pill-live")}>
                    {stateLabel}
                </span>
                <span className="dpm-job-row-duration">{totalDurationLabel(u)}</span>
            </div>
            {isLive ? (
                <ol className="dpm-stepper">
                    {STAGE_ORDER.map((sid, idx) => {
                        const st = u.stages[sid];
                        const state = st?.state || "pending";
                        const dur = st?.duration_ms ?? null;
                        return (
                            <li key={sid} className={classNames("dpm-step", `dpm-step-${state}`)}>
                                <span className="dpm-step-no">{idx + 1}</span>
                                <span className="dpm-step-label">{STAGE_LABELS[sid]}</span>
                                <span className="dpm-step-dur">{state === "done" ? fmtMs(dur) : (state === "active" ? "…" : "")}</span>
                            </li>
                        );
                    })}
                </ol>
            ) : (
                <ol className="dpm-stepper-dots" aria-label="pipeline stages">
                    {STAGE_ORDER.map((sid, idx) => {
                        const st = u.stages[sid];
                        const state = st?.state || "pending";
                        const dur = st?.duration_ms ?? null;
                        const tip = `${idx + 1}. ${STAGE_LABELS[sid]}${state === "done" ? ` — ${fmtMs(dur)}` : ""}`;
                        return (
                            <li
                                key={sid}
                                className={classNames("dpm-stepper-dot", `dpm-dot-${state}`)}
                                title={tip}
                                aria-label={tip}
                            />
                        );
                    })}
                </ol>
            )}
            {u.state === "failed" && (
                <div className="dpm-stage-error">
                    <strong>{u.error_class}:</strong> {u.error_message}
                </div>
            )}
        </li>
    );
}

function StagesPanel({ uploadStages, onOpenDetail }) {
    // Newest first by lastEventAt.
    const items = Object.values(uploadStages).sort((a, b) => (a.lastEventAt < b.lastEventAt ? 1 : -1));
    return (
        <section className="dpm-panel dpm-panel-wide">
            <header className="dpm-panel-head">
                <h2>Pipeline Stages</h2>
                <span className="dpm-panel-sub">{items.length} active / recent uploads</span>
            </header>
            {items.length === 0 ? (
                <div className="dpm-empty">No jobs yet. Upload a video to see the pipeline in action.</div>
            ) : (
                <ul className="dpm-job-history">
                    {items.map((u, idx) => {
                        const isLive = idx === 0 && u.state === "active";
                        const ageIndex = isLive ? -1 : (items[0].state === "active" ? idx - 1 : idx);
                        return (
                            <JobHistoryRow
                                key={u.upload_id}
                                upload={u}
                                ageIndex={ageIndex}
                                isLive={isLive}
                                onOpenDetail={onOpenDetail}
                            />
                        );
                    })}
                </ul>
            )}
        </section>
    );
}

// ───────────────────── 4. Mongo activity panel ─────────────
function EventThumb({ src, isDedup, onClick }) {
    const [errored, setErrored] = useState(false);
    const Tag = onClick ? "button" : "div";
    const interactiveProps = onClick
        ? {
              type: "button",
              onClick,
              "aria-label": "Open full-size image",
          }
        : {};
    const cls = classNames(
        "dpm-event-thumb",
        (!src || errored) && "dpm-event-thumb-placeholder",
        onClick && "dpm-event-thumb-clickable",
    );
    if (!src || errored) {
        return (
            <Tag className={cls} {...interactiveProps}>
                <span aria-hidden="true">{isDedup ? "🔄" : "📷"}</span>
            </Tag>
        );
    }
    return (
        <Tag className={cls} {...interactiveProps}>
            <img
                src={src}
                alt=""
                loading="lazy"
                onError={() => setErrored(true)}
            />
            {isDedup && <span className="dpm-event-thumb-overlay" aria-hidden="true">🔄</span>}
        </Tag>
    );
}

function ConfidenceBar({ value }) {
    if (value == null) return <span className="dpm-confidence-empty">—</span>;
    const pct = Math.max(0, Math.min(100, value * 100));
    return (
        <div className="dpm-confidence-bar" title={`Avg confidence: ${pct.toFixed(0)}%`}>
            <div className="dpm-confidence-fill" style={{ width: `${pct.toFixed(1)}%` }} />
            <span className="dpm-confidence-num">{pct.toFixed(0)}%</span>
        </div>
    );
}

function SeverityBadge({ severity }) {
    if (!severity) return null;
    const cls = `dpm-severity-${String(severity).toLowerCase()}`;
    return <span className={classNames("dpm-severity-badge", cls)}>{severity}</span>;
}

// Small diff badge for MERGED / REOPENED rows. Only renders the
// transitions that actually changed (count, conf, severity, status).
function MergeDiff({ a }) {
    const parts = [];
    if (a.previous_status && a.lifecycle_status && a.previous_status !== a.lifecycle_status) {
        parts.push(`status ${a.previous_status} → ${a.lifecycle_status}`);
    }
    if (a.previous_severity && a.severity && a.previous_severity !== a.severity) {
        parts.push(`severity ${a.previous_severity} → ${a.severity}`);
    }
    if (typeof a.previous_detection_count === "number" && typeof a.detection_count === "number"
        && a.previous_detection_count !== a.detection_count) {
        parts.push(`count ${a.previous_detection_count} → ${a.detection_count}`);
    }
    if (typeof a.previous_avg_confidence === "number" && typeof a.avg_confidence === "number"
        && Math.abs(a.previous_avg_confidence - a.avg_confidence) >= 0.005) {
        parts.push(`conf ${a.previous_avg_confidence.toFixed(2)} → ${a.avg_confidence.toFixed(2)}`);
    }
    if (parts.length === 0) return null;
    return <span className="dpm-merge-diff">{parts.join(" · ")}</span>;
}

function EventActivityRow({ a, onOpenImage }) {
    // Three row flavors: event_created, event_merged, event_reopened. dedup_hit is kept as a legacy fallback for older clients but is no longer emitted by the current worker.
    const isCreated = a.type === "event_created";
    const isReopened = a.type === "event_reopened";
    const isMerged = a.type === "event_merged" || a.type === "dedup_hit"; // legacy: dedup_hit -> MERGED visual
    const tagText = isCreated ? "EVENT_CREATED" : isReopened ? "REOPENED" : "MERGED";
    const tagColor = isCreated ? "dpm-tag-green" : isReopened ? "dpm-tag-purple" : "dpm-tag-orange";
    const rowMod = isCreated ? "dpm-activity-created" : isReopened ? "dpm-activity-reopened" : "dpm-activity-dedup";
    return (
        <li className={classNames("dpm-activity-row", rowMod)}>
            <EventThumb
                src={thumbUrl(a.frame_thumbnail_path)}
                isDedup={!isCreated}
                onClick={onOpenImage ? () => onOpenImage(a) : undefined}
            />
            <div className="dpm-activity-body">
                <div className="dpm-activity-line-1">
                    <span className={classNames("dpm-activity-tag", tagColor)}>
                        {tagText}
                    </span>
                    <SeverityBadge severity={a.severity} />
                    {a.event_id && <code className="dpm-activity-id">{shortId(a.event_id)}</code>}
                    <span className="dpm-relative-time">{fmtRelative(a.timestamp)}</span>
                </div>
                <div className="dpm-activity-line-2">
                    <span className="dpm-activity-loc-mono">
                        {a.location
                            ? `${a.location.lat?.toFixed?.(3) ?? "?"}, ${a.location.lon?.toFixed?.(3) ?? "?"}`
                            : "—"}
                    </span>
                    {a.zone && <span className="dpm-activity-zone">· {a.zone}</span>}
                    <ConfidenceBar value={a.avg_confidence} />
                </div>
                {!isCreated && (
                    <div className="dpm-activity-line-3">
                        <MergeDiff a={a} />
                    </div>
                )}
            </div>
        </li>
    );
}

function MongoActivityPanel({ mongoActivity, dedupSuppressedLastHour, onOpenImage }) {
    return (
        <section className="dpm-panel">
            <header className="dpm-panel-head">
                <h2>MongoDB Activity</h2>
                <span className="dpm-panel-sub">{mongoActivity.length} recent · {dedupSuppressedLastHour} dedup-suppressed in last hour</span>
            </header>
            {mongoActivity.length === 0 ? (
                <div className="dpm-empty">No events yet.</div>
            ) : (
                <ol className="dpm-activity-list">
                    {mongoActivity.map((a) => (
                        <EventActivityRow key={a.id} a={a} onOpenImage={onOpenImage} />
                    ))}
                </ol>
            )}
        </section>
    );
}

// ───────────────────── Page ────────────────────────────────
/**
 * Top-level dashboard component. Probes /api/dev/observability/stream once
 * to detect DEV_MODE; if 404, renders DisabledBanner. Otherwise mounts the
 * SSE hook and wires the four panels + modal stack (image modal can layer
 * on top of the job-detail modal). Body scroll is locked while any modal
 * is open; Esc closes the topmost modal only.
 */
export default function PipelineMonitorPage() {
    // Probe the SSE endpoint once. If it returns 404 the dashboard is disabled
    // server-side (DEV_MODE=false) and we should NOT keep an EventSource open.
    const [enabled, setEnabled] = useState(null); // null = probing
    useEffect(() => {
        fetch("/api/dev/observability/stream", { method: "GET", headers: { Range: "bytes=0-0" } })
            .then((r) => {
                if (r.status === 404) {
                    setEnabled(false);
                } else {
                    // Server is happy; we'll let the EventSource take over.
                    // Cancel this probe by closing the stream.
                    try { r.body && r.body.cancel && r.body.cancel(); } catch (_) { /* ignore */ }
                    setEnabled(true);
                }
            })
            .catch(() => setEnabled(true)); // network blip — try the SSE anyway
    }, []);

    // Always call the hook so React's hook order is stable. Toggle the
    // internal connect/disconnect via the `enabled` argument.
    const stream = useObservabilityStream(enabled === true);

    // Modal state. Image modal can stack on top of Job Detail modal.
    const [modalImage, setModalImage] = useState(null);
    const [detailUpload, setDetailUpload] = useState(null);
    const anyModalOpen = !!modalImage || !!detailUpload;

    // Esc closes the topmost modal only.
    useEffect(() => {
        if (!anyModalOpen) return undefined;
        const handler = (e) => {
            if (e.key !== "Escape") return;
            if (modalImage) setModalImage(null);
            else if (detailUpload) setDetailUpload(null);
        };
        document.addEventListener("keydown", handler);
        return () => document.removeEventListener("keydown", handler);
    }, [anyModalOpen, modalImage, detailUpload]);

    // Body scroll lock while any modal is open.
    useEffect(() => {
        if (!anyModalOpen) return undefined;
        const prev = document.body.style.overflow;
        document.body.style.overflow = "hidden";
        return () => { document.body.style.overflow = prev; };
    }, [anyModalOpen]);

    if (enabled === false) return <DisabledBanner />;

    return (
        <div className="dpm-page">
            <header className="dpm-header">
                <div>
                    <h1>Pipeline Monitor</h1>
                    <p className="dpm-sub">Dev-only observability for the RoadSenseAI pipeline.</p>
                </div>
                <ConnectionBadge
                    status={stream.status}
                    reconnectIn={stream.reconnectIn}
                    lastEventAt={stream.lastEventAt}
                />
            </header>

            <MetricsBar metrics={stream.metrics} />

            <div className="dpm-grid">
                <div className="dpm-col">
                    <QueuePanel queue={stream.queue} jobHistory={stream.jobHistory} />
                    <WorkersPanel
                        workers={stream.workers}
                        uploadStages={stream.uploadStages}
                        workerSession={stream.workerSession}
                    />
                </div>
                <div className="dpm-col">
                    <StagesPanel
                        uploadStages={stream.uploadStages}
                        onOpenDetail={setDetailUpload}
                    />
                    <MongoActivityPanel
                        mongoActivity={stream.mongoActivity}
                        dedupSuppressedLastHour={stream.dedupSuppressedLastHour}
                        onOpenImage={setModalImage}
                    />
                </div>
            </div>

            {detailUpload && (
                <JobDetailModal
                    upload={stream.uploadStages?.[detailUpload.upload_id] || detailUpload}
                    mongoActivity={stream.mongoActivity}
                    onOpenImage={setModalImage}
                    onClose={() => setDetailUpload(null)}
                />
            )}
            {modalImage && (
                <ImageModal event={modalImage} onClose={() => setModalImage(null)} />
            )}
        </div>
    );
}
