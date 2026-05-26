/**
 * useObservabilityStream — dev-only React hook consumed by PipelineMonitorPage.
 *
 * Subscribes to the backend SSE feed at /api/dev/observability/stream and turns
 * the worker's pub/sub channel (queue/worker/mongo snapshots + per-stage
 * pipeline_progress events + mongo_event broadcasts) into the normalized
 * React state the dashboard renders. Available only when the backend is
 * started with DEV_MODE=true; in production builds the endpoint 404s.
 *
 * Connection states: "connecting" -> "connected" -> "disconnected" / "reconnecting"
 * Reconnect backoff: 1s, 2s, 4s, 8s, 16s, capped at 30s. The hook drives the
 * reconnect explicitly (closing the EventSource and re-opening on a timer)
 * instead of relying on the browser's auto-reconnect, so the connection
 * badge can show a meaningful countdown.
 *
 * Returned shape:
 *   {
 *     status: "connected" | "disconnected" | "reconnecting" | "connecting",
 *     queue:   { counts, pending_job_ids, timestamp } | null,
 *     workers: [...]                                 // last worker_snapshot
 *     mongoRecent: [...]                             // last mongo_snapshot.recent_events
 *     dedupSuppressedLastHour: number,
 *     uploadStages: { [upload_id]: { worker_id, stages: { [stage_id]: {state, duration_ms} }, lastEventAt } },
 *     mongoActivity: [{type, ...}, ...]              // bounded-size scrolling feed
 *     reconnectIn: number | null                     // ms until next reconnect
 *   }
 */

import { useEffect, useRef, useState } from "react";

const STREAM_URL = "/api/dev/observability/stream";
const MAX_ACTIVITY = 20;        // mongo activity feed cap (UI shows last 20)
const MAX_UPLOADS_TRACKED = 20; // pipeline-stages panel cap
const MAX_LATENCY_SAMPLES = 10; // average latency over last N completed jobs
const MAX_JOB_HISTORY = 30;     // queue-history tab cap (Round 2)
const THROUGHPUT_WINDOW_MS = 5 * 60 * 1000; // 5-minute rolling window

const BACKOFF_MS = [1000, 2000, 4000, 8000, 16000, 30000];

const STAGE_ORDER = [
    "gpx_parse",
    "frame_sample",
    "yolo_inference",
    "confidence_filter",
    "timestamp_align",
    "dbscan_consolidation",
    "severity_heuristic",
    "persist_dedup",
];

/**
 * Subscribe to the dev observability SSE stream and expose normalized
 * snapshots + a rolling activity feed for the Pipeline Monitor dashboard.
 * Pass `enabled=false` to skip opening the connection (used while the
 * page probes whether DEV_MODE is on).
 *
 * @param {boolean} [enabled=true] When false, no EventSource is opened.
 * @returns {object} Current connection status, queue/worker/mongo state,
 *   per-upload stage progression, derived metrics (latency / throughput /
 *   success rate), and the STAGE_ORDER constant for rendering steppers.
 */
export default function useObservabilityStream(enabled = true) {
    const [status, setStatus] = useState("connecting");
    const [queue, setQueue] = useState(null);
    const [workers, setWorkers] = useState([]);
    const [mongoRecent, setMongoRecent] = useState([]);
    const [dedupSuppressedLastHour, setDedupSuppressedLastHour] = useState(0);
    const [uploadStages, setUploadStages] = useState({});
    const [mongoActivity, setMongoActivity] = useState([]);
    const [reconnectIn, setReconnectIn] = useState(null);

    // Top metrics bar state (Step 1)
    const [totalEvents, setTotalEvents] = useState(0);
    const [latencySamples, setLatencySamples] = useState([]);   // last N total_duration_ms
    const [completionTimes, setCompletionTimes] = useState([]); // Date.now() of recent job_completes (5-min window)

    // Per-worker session-local metrics (Step 3): { [worker_id]: {session_jobs, last_duration_ms} }
    const [workerSession, setWorkerSession] = useState({});

    // Connection badge pulse (Step 5): bumped on every interesting event,
    // throttled to ~500 ms by lastPulseAt below.
    const [lastEventAt, setLastEventAt] = useState(0);
    const lastPulseAtRef = useRef(0);

    // Queue history tab (Round 2): last 30 completed/failed jobs, newest-first.
    const [jobHistory, setJobHistory] = useState([]);
    // job_complete / job_failed payloads don't carry job_id; only job_picked
    // does. Mirror the mapping so we can resolve the RQ job id at completion.
    const jobIdByUploadIdRef = useRef({});

    const sourceRef = useRef(null);
    const attemptRef = useRef(0);
    const reconnectTimerRef = useRef(null);
    const countdownTimerRef = useRef(null);
    const enabledRef = useRef(enabled);

    useEffect(() => { enabledRef.current = enabled; }, [enabled]);

    useEffect(() => {
        if (!enabled) return undefined;

        const cleanup = () => {
            if (sourceRef.current) {
                try { sourceRef.current.close(); } catch (_) { /* ignore */ }
                sourceRef.current = null;
            }
            if (reconnectTimerRef.current) {
                clearTimeout(reconnectTimerRef.current);
                reconnectTimerRef.current = null;
            }
            if (countdownTimerRef.current) {
                clearInterval(countdownTimerRef.current);
                countdownTimerRef.current = null;
            }
        };

        const scheduleReconnect = () => {
            cleanup();
            if (!enabledRef.current) return;
            const delay = BACKOFF_MS[Math.min(attemptRef.current, BACKOFF_MS.length - 1)];
            attemptRef.current += 1;
            setStatus("reconnecting");
            setReconnectIn(delay);
            // Visible countdown (refresh every 250ms)
            const startedAt = Date.now();
            countdownTimerRef.current = setInterval(() => {
                const remaining = Math.max(0, delay - (Date.now() - startedAt));
                setReconnectIn(remaining);
                if (remaining <= 0) clearInterval(countdownTimerRef.current);
            }, 250);
            reconnectTimerRef.current = setTimeout(() => {
                connect();
            }, delay);
        };

        const handlePipelineProgress = (envelope) => {
            const ev = envelope?.inner;
            if (!ev || !ev.upload_id) return;
            const id = ev.upload_id;
            const t = ev.event_type;

            // Round 2: track RQ job_id at job_picked so we can stamp it on
            // jobHistory entries when the job ultimately completes/fails.
            if (t === "job_picked" && ev.job_id) {
                jobIdByUploadIdRef.current[id] = ev.job_id;
            }

            // Round 2: append to jobHistory on job_complete / job_failed.
            if (t === "job_complete" || t === "job_failed") {
                setJobHistory((prev) => {
                    const entry = t === "job_complete" ? {
                        key: `${id}-${ev.timestamp || Date.now()}`,
                        upload_id: id,
                        job_id: jobIdByUploadIdRef.current[id] || null,
                        worker_id: ev.worker_id || null,
                        status: "DONE",
                        duration_ms: ev.total_duration_ms ?? null,
                        events_persisted: ev.events_persisted ?? null,
                        duplicates_suppressed: ev.duplicates_suppressed ?? null,
                        completed_at: ev.timestamp,
                    } : {
                        key: `${id}-${ev.timestamp || Date.now()}`,
                        upload_id: id,
                        job_id: jobIdByUploadIdRef.current[id] || null,
                        worker_id: ev.worker_id || null,
                        status: "FAILED",
                        duration_ms: null,
                        error_class: ev.error_class || null,
                        error_message: ev.error_message || null,
                        completed_at: ev.timestamp,
                    };
                    return [entry, ...prev].slice(0, MAX_JOB_HISTORY);
                });
            }

            // Metrics: latency + throughput updates fire on job_complete only.
            if (t === "job_complete") {
                if (typeof ev.total_duration_ms === "number") {
                    setLatencySamples((prev) => {
                        const next = [...prev, ev.total_duration_ms];
                        return next.slice(-MAX_LATENCY_SAMPLES);
                    });
                }
                setCompletionTimes((prev) => {
                    const cutoff = Date.now() - THROUGHPUT_WINDOW_MS;
                    return [...prev, Date.now()].filter((ts) => ts >= cutoff);
                });
                // Per-worker session counters (Step 3)
                if (ev.worker_id) {
                    setWorkerSession((prev) => {
                        const cur = prev[ev.worker_id] || { session_jobs: 0, last_duration_ms: null };
                        return {
                            ...prev,
                            [ev.worker_id]: {
                                session_jobs: cur.session_jobs + 1,
                                last_duration_ms: typeof ev.total_duration_ms === "number"
                                    ? ev.total_duration_ms
                                    : cur.last_duration_ms,
                            },
                        };
                    });
                }
            }

            setUploadStages((prev) => {
                const cur = prev[id] || {
                    upload_id: id,
                    worker_id: ev.worker_id,
                    job_id: ev.job_id || null,
                    stages: {},
                    state: "active",
                    lastEventAt: ev.timestamp,
                };
                cur.worker_id = ev.worker_id || cur.worker_id;
                cur.lastEventAt = ev.timestamp;

                if (t === "stage_start" && ev.stage_id) {
                    cur.stages = {
                        ...cur.stages,
                        [ev.stage_id]: { state: "active", duration_ms: null, started_at: ev.timestamp, metrics: null },
                    };
                } else if (t === "stage_complete" && ev.stage_id) {
                    const prevStage = cur.stages?.[ev.stage_id];
                    cur.stages = {
                        ...cur.stages,
                        [ev.stage_id]: {
                            state: "done",
                            duration_ms: ev.duration_ms ?? null,
                            started_at: prevStage?.started_at,
                            metrics: ev.metrics || null,
                        },
                    };
                } else if (t === "job_picked") {
                    cur.state = "active";
                    cur.job_id = ev.job_id || cur.job_id;
                } else if (t === "job_complete") {
                    cur.state = "done";
                    cur.events_persisted = ev.events_persisted;
                    cur.duplicates_suppressed = ev.duplicates_suppressed;
                    cur.total_duration_ms = ev.total_duration_ms;
                } else if (t === "job_failed") {
                    cur.state = "failed";
                    cur.error_class = ev.error_class;
                    cur.error_message = ev.error_message;
                    if (ev.stage_id) {
                        const prevStage = cur.stages?.[ev.stage_id];
                        cur.stages = {
                            ...cur.stages,
                            [ev.stage_id]: {
                                state: "failed",
                                duration_ms: null,
                                started_at: prevStage?.started_at,
                                metrics: prevStage?.metrics || null,
                            },
                        };
                    }
                }

                // Bound the map to the most recent N uploads (by lastEventAt)
                const next = { ...prev, [id]: { ...cur } };
                const ids = Object.keys(next);
                if (ids.length > MAX_UPLOADS_TRACKED) {
                    const sorted = ids
                        .map((k) => ({ k, t: next[k].lastEventAt || "" }))
                        .sort((a, b) => (a.t < b.t ? 1 : -1));
                    const keep = new Set(sorted.slice(0, MAX_UPLOADS_TRACKED).map((s) => s.k));
                    Object.keys(next).forEach((k) => { if (!keep.has(k)) delete next[k]; });
                }
                return next;
            });
        };

        const handleMongoEvent = (envelope) => {
            const ev = envelope?.inner;
            if (!ev) return;
            // totalEvents only counts NEW events. Merges and re-opens enrich an
            // existing event without changing the distinct-pothole count.
            if (ev.event_type === "event_created") {
                setTotalEvents((n) => n + 1);
            }
            setMongoActivity((prev) => {
                const item = {
                    id: `${ev.timestamp || Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                    // The MongoDB activity feed surfaces three event types from the worker's pub/sub channel.
                    type: ev.event_type,
                    upload_id: ev.upload_id,
                    event_id: ev.event_id || ev.existing_event_id || null,
                    severity: ev.severity || null,
                    zone: ev.zone || null,
                    location: ev.location || null,
                    frame_thumbnail_path: ev.frame_thumbnail_path || null,
                    avg_confidence: typeof ev.avg_confidence === "number" ? ev.avg_confidence : null,
                    // previous_* fields enable diff badges (severity / count / status transitions) in the activity row.
                    previous_severity: ev.previous_severity || null,
                    previous_avg_confidence: typeof ev.previous_avg_confidence === "number"
                        ? ev.previous_avg_confidence
                        : null,
                    detection_count: typeof ev.detection_count === "number" ? ev.detection_count : null,
                    previous_detection_count: typeof ev.previous_detection_count === "number"
                        ? ev.previous_detection_count
                        : null,
                    lifecycle_status: ev.lifecycle_status || null,
                    previous_status: ev.previous_status || null,
                    timestamp: ev.timestamp,
                };
                return [item, ...prev].slice(0, MAX_ACTIVITY);
            });
        };

        // Throttled pulse setter: bumps lastEventAt at most every 500 ms, so a
        // burst of incoming events doesn't strobe the connection badge.
        const bumpPulse = () => {
            const now = Date.now();
            if (now - lastPulseAtRef.current < 500) return;
            lastPulseAtRef.current = now;
            setLastEventAt(now);
        };

        const connect = () => {
            cleanup();
            setStatus("connecting");
            setReconnectIn(null);
            const es = new EventSource(STREAM_URL);
            sourceRef.current = es;

            es.addEventListener("heartbeat", () => {
                attemptRef.current = 0;
                setStatus("connected");
                // Heartbeat intentionally does NOT bump pulse — it'd run every 15s for nothing.
            });

            es.addEventListener("queue_snapshot", (e) => {
                try { setQueue(JSON.parse(e.data)); attemptRef.current = 0; setStatus("connected"); bumpPulse(); } catch (_) { /* ignore */ }
            });

            es.addEventListener("worker_snapshot", (e) => {
                try { setWorkers(JSON.parse(e.data).workers || []); attemptRef.current = 0; setStatus("connected"); bumpPulse(); } catch (_) { /* ignore */ }
            });

            es.addEventListener("mongo_snapshot", (e) => {
                try {
                    const data = JSON.parse(e.data);
                    setMongoRecent(data.recent_events || []);
                    setDedupSuppressedLastHour(data.dedup_suppressed_last_hour || 0);
                    attemptRef.current = 0;
                    setStatus("connected");
                    bumpPulse();
                } catch (_) { /* ignore */ }
            });

            es.addEventListener("pipeline_progress", (e) => {
                try { handlePipelineProgress(JSON.parse(e.data)); attemptRef.current = 0; setStatus("connected"); bumpPulse(); } catch (_) { /* ignore */ }
            });

            es.addEventListener("mongo_event", (e) => {
                try { handleMongoEvent(JSON.parse(e.data)); attemptRef.current = 0; setStatus("connected"); bumpPulse(); } catch (_) { /* ignore */ }
            });

            es.onopen = () => {
                attemptRef.current = 0;
                setStatus("connected");
                setReconnectIn(null);
            };

            es.onerror = () => {
                // EventSource auto-reconnects, but we want explicit backoff control.
                // Close and reopen on our schedule so the badge state is meaningful.
                if (sourceRef.current === es) {
                    setStatus("disconnected");
                    scheduleReconnect();
                }
            };
        };

        connect();
        return cleanup;
    }, [enabled]);

    // Derived metrics (computed at return time, no extra setState).
    const avgLatencyMs = latencySamples.length > 0
        ? latencySamples.reduce((a, b) => a + b, 0) / latencySamples.length
        : null;

    // Throughput: completions inside the rolling 5-minute window divided by 5.
    // Filter at read time so stale entries don't stick around.
    const _now = Date.now();
    const _activeCompletions = completionTimes.filter((ts) => ts >= _now - THROUGHPUT_WINDOW_MS);
    const throughputPerMin = _activeCompletions.length / (THROUGHPUT_WINDOW_MS / 60000);

    // Cumulative success rate from the latest queue snapshot. Per spec, this
    // counts since RQ created the queue (not session-local). Null when no jobs
    // have terminated yet.
    let successRatePct = null;
    const finished = queue?.counts?.finished ?? 0;
    const failed = queue?.counts?.failed ?? 0;
    if (finished + failed > 0) {
        successRatePct = (finished / (finished + failed)) * 100;
    }

    return {
        status,
        queue,
        workers,
        mongoRecent,
        dedupSuppressedLastHour,
        uploadStages,
        mongoActivity,
        reconnectIn,
        metrics: {
            totalEvents,
            avgLatencyMs,
            throughputPerMin,
            successRatePct,
        },
        workerSession,
        lastEventAt,
        jobHistory,
        STAGE_ORDER,
    };
}

export { STAGE_ORDER };
