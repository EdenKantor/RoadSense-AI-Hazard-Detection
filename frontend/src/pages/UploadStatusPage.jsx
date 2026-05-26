/**
 * Upload tracker page.
 *
 * Authenticated citizen-facing page at /uploads/:uploadId/status that polls
 * GET /api/uploads/{id}/detail every 5 seconds for live processing state and
 * renders a stepper (Reported → Processing → Verified → Published → Done),
 * an activity log built from status_history, and — once Done — a Report
 * Summary card with the representative detection image (clickable lightbox),
 * primary location, severity, and detection count, plus links to view the
 * report on the citizen map or start another upload. Polling stops once the
 * upload reaches a terminal state ("Done" or "Failed"), and the page also
 * handles an explicit "Failed" UI with the backend error_message and a
 * "duplicates suppressed" banner when prior reports covered the same potholes.
 */
import { useState, useEffect, useRef } from "react";
import { useParams, Link } from "react-router-dom";
import { uploadsApi } from "../api/client";
import {
    MapPin,
    Calendar,
    Shield,
    Crosshair,
    CheckCircle2,
    Circle,
    Loader2,
    XCircle,
    Map,
    Info,
    X,
    FileText,
    Cpu,
    ScanSearch,
    Globe,
    CircleCheck,
} from "lucide-react";

const TERMINAL = ["Done", "Failed"];
// 5s polling cadence: fast enough to feel "live" while a report is being
// processed (most uploads finish in tens of seconds to a few minutes), slow
// enough not to hammer the backend across many concurrent viewers.
const POLL_INTERVAL_MS = 5000;

/* The pipeline steps shown in the stepper */
const STEPS = [
    { key: "Reported", label: "Reported", icon: FileText },
    { key: "Processing", label: "Processing", icon: Cpu },
    { key: "Verified", label: "Verified", icon: ScanSearch },
    { key: "Published", label: "Published", icon: Globe },
    { key: "Done", label: "Done", icon: CircleCheck },
];

/**
 * Map the backend upload status enum to the index of the currently active
 * step in the STEPS array. Returns -1 for "Failed" so the stepper can render
 * a failure marker rather than a positive progress position.
 */
function stepIndex(status) {
    if (status === "Queued") return 0;
    if (status === "Processing") return 1;
    if (status === "Done") return 4;
    if (status === "Failed") return -1;
    return 0;
}

/** Format an ISO timestamp as a "1 Jan 2026" date string (en-GB locale). */
function formatDate(iso) {
    if (!iso) return "—";
    const d = new Date(iso);
    return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/** Format an ISO timestamp as "1 Jan 2026, 14:30" (en-GB locale). */
function formatDateTime(iso) {
    if (!iso) return "—";
    const d = new Date(iso);
    return d.toLocaleString("en-GB", {
        day: "numeric", month: "short", year: "numeric",
        hour: "2-digit", minute: "2-digit",
    });
}

/** Renders the live upload tracker: stepper, activity log, and summary card. */
export default function UploadStatusPage() {
    const { uploadId } = useParams();
    const [data, setData] = useState(null);
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(true);
    const [lightboxUrl, setLightboxUrl] = useState(null);
    const intervalRef = useRef(null);

    const fetchDetail = async () => {
        try {
            const res = await uploadsApi.detail(uploadId);
            setData(res.data);
            setLoading(false);
            if (TERMINAL.includes(res.data.status)) {
                clearInterval(intervalRef.current);
            }
        } catch {
            setError("Could not fetch upload details.");
            setLoading(false);
            clearInterval(intervalRef.current);
        }
    };

    // Re-establish the poll only when the URL's uploadId changes (e.g. user
    // navigates from one upload to another). fetchDetail is intentionally not
    // in the deps — it closes over the current uploadId via useParams.
    useEffect(() => {
        fetchDetail();
        intervalRef.current = setInterval(fetchDetail, POLL_INTERVAL_MS);
        return () => clearInterval(intervalRef.current);
    }, [uploadId]);

    const currentStep = data ? stepIndex(data.status) : 0;
    const isFailed = data?.status === "Failed";
    const isDone = data?.status === "Done";

    /* Build activity log entries from status_history */
    const activityLog = [];
    if (data) {
        const hist = data.status_history || [];
        const labelMap = {
            Queued: "Report submitted",
            Processing: "Processing started",
            Done: "Detection completed",
            Failed: "Processing failed",
        };
        for (const h of hist) {
            activityLog.push({
                label: labelMap[h.status] || h.status,
                timestamp: h.timestamp,
                status: h.status,
                error: h.error_message,
            });
        }
        // If Done, add "Published to map" entry using the Done timestamp
        if (isDone) {
            const doneEntry = hist.find(h => h.status === "Done");
            if (doneEntry) {
                // Insert "Published to map" before "Done" visually
                const doneIdx = activityLog.findIndex(a => a.status === "Done");
                if (doneIdx >= 0) {
                    activityLog[doneIdx].label = "Published to map";
                }
            }
        }
    }

    /* Determine remaining steps for the activity log */
    const allActivitySteps = [
        { label: "Report submitted", key: "Queued" },
        { label: "Processing started", key: "Processing" },
        { label: "Detection completed", key: "detection" },
        { label: "Published to map", key: "Done" },
    ];

    /* Map history statuses to completed keys */
    const completedKeys = new Set((data?.status_history || []).map(h => h.status));
    if (isDone) completedKeys.add("detection");

    if (loading) {
        return (
            <div className="ut-page">
                <p className="text-muted" style={{ padding: "3rem", textAlign: "center" }}>Loading report details...</p>
            </div>
        );
    }

    return (
        <div className="ut-page">
            {/* Banner */}
            <div className="hc-banner" style={{ marginBottom: "1.5rem", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                    <h1 className="hc-banner-title">Upload Tracker</h1>
                    <p className="hc-banner-sub">Track your report processing status and results</p>
                </div>
                <Link to="/citizen/reports" className="ut-back-btn-banner">Back to My Reports</Link>
            </div>

            {error && <div className="ut-error">{error}</div>}

            {data && (
                <>
                    {/* Stepper Bar */}
                    <div className="ut-stepper">
                        {STEPS.map((step, i) => {
                            const Icon = step.icon;
                            let cls = "ut-step";
                            if (isFailed && i > 0) cls += " ut-step-disabled";
                            else if (i < currentStep) cls += " ut-step-done";
                            else if (i === currentStep) cls += " ut-step-active";
                            else cls += " ut-step-pending";

                            return (
                                <div key={step.key} className="ut-step-wrapper">
                                    <div className={cls}>
                                        <div className="ut-step-circle">
                                            {isFailed && i === 1 ? (
                                                <XCircle size={18} />
                                            ) : i < currentStep ? (
                                                <CheckCircle2 size={18} />
                                            ) : i === currentStep && !isFailed ? (
                                                data.status === "Processing" && i === 1 ? <Loader2 size={18} className="ut-spin" /> : <Icon size={18} />
                                            ) : (
                                                <Circle size={18} />
                                            )}
                                        </div>
                                        <span className="ut-step-label">{step.label}</span>
                                    </div>
                                    {i < STEPS.length - 1 && (
                                        <div className={`ut-step-line ${i < currentStep ? "ut-line-done" : ""} ${isFailed && i >= 0 ? "ut-line-failed" : ""}`} />
                                    )}
                                </div>
                            );
                        })}
                    </div>

                    {/* Failed Banner */}
                    {isFailed && (
                        <div className="ut-failed-banner">
                            <XCircle size={20} />
                            <div>
                                <strong>Processing Failed</strong>
                                {data.error_message && <p>{data.error_message}</p>}
                            </div>
                        </div>
                    )}

                    {/* Duplicates Suppressed Banner */}
                    {isDone && data.duplicates_suppressed > 0 && (
                        <div className="ut-dup-banner">
                            <Info size={20} />
                            <div>
                                <strong>
                                    {data.duplicates_suppressed} pothole{data.duplicates_suppressed !== 1 ? "s" : ""} already reported
                                </strong>
                                <p>
                                    {data.duplicates_suppressed === 1
                                        ? "1 pothole from your video was already reported by another user and is being tracked on the map."
                                        : `${data.duplicates_suppressed} potholes from your video were already reported by other users and are being tracked on the map.`}
                                    {data.event_count > 0
                                        ? ` ${data.event_count} new pothole${data.event_count !== 1 ? "s" : ""} ${data.event_count !== 1 ? "were" : "was"} added successfully.`
                                        : " No new potholes were added from this report."}
                                </p>
                            </div>
                        </div>
                    )}

                    {/* Main Content — only show Report Summary when Done */}
                    {isDone && data.event_count > 0 && (
                        <div className="ut-content-row">
                            {/* Report Summary */}
                            <div className="ut-card ut-summary-card">
                                <h2 className="ut-card-title">Report Summary</h2>
                                <div className="ut-summary-body">
                                    {data.representative_image && (
                                        <div className="ut-summary-image" onClick={() => setLightboxUrl(data.representative_image)} style={{ cursor: "zoom-in" }}>
                                            <img src={data.representative_image} alt="Detection" />
                                        </div>
                                    )}
                                    <div className="ut-summary-details">
                                        <div className="ut-detail-row">
                                            <FileText size={16} className="ut-detail-icon" />
                                            <div>
                                                <span className="ut-detail-label">Report ID</span>
                                                <span className="ut-detail-value ut-mono">{uploadId}</span>
                                            </div>
                                        </div>
                                        <div className="ut-detail-row">
                                            <MapPin size={16} className="ut-detail-icon" />
                                            <div>
                                                <span className="ut-detail-label">Location</span>
                                                <span className="ut-detail-value">
                                                    {data.primary_location
                                                        ? `${data.primary_location.coordinates[1].toFixed(4)}, ${data.primary_location.coordinates[0].toFixed(4)}`
                                                        : "—"}
                                                </span>
                                            </div>
                                        </div>
                                        <div className="ut-detail-row">
                                            <Calendar size={16} className="ut-detail-icon" />
                                            <div>
                                                <span className="ut-detail-label">Date Reported</span>
                                                <span className="ut-detail-value">{formatDate(data.created_at)}</span>
                                            </div>
                                        </div>
                                        <div className="ut-detail-row">
                                            <Shield size={16} className="ut-detail-icon" />
                                            <div>
                                                <span className="ut-detail-label">Status</span>
                                                <span className="ut-detail-value">{data.status}</span>
                                            </div>
                                        </div>
                                        <div className="ut-detail-row">
                                            <Crosshair size={16} className="ut-detail-icon" />
                                            <div>
                                                <span className="ut-detail-label">Detections</span>
                                                <span className="ut-detail-value">{data.event_count} pothole{data.event_count !== 1 ? "s" : ""}</span>
                                            </div>
                                        </div>
                                        <div className="ut-detail-row">
                                            <Shield size={16} className="ut-detail-icon" />
                                            <div>
                                                <span className="ut-detail-label">Severity</span>
                                                <span className={`ut-severity-badge ut-sev-${(data.primary_severity || "").toLowerCase()}`}>
                                                    {data.primary_severity || "—"}
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                                <div className="ut-summary-actions">
                                    <Link to={`/citizen/map?upload=${uploadId}`} className="ut-btn ut-btn-primary">
                                        <Map size={16} /> View on Map
                                    </Link>
                                    <Link to="/upload" className="ut-btn ut-btn-ghost">
                                        Report Another Issue
                                    </Link>
                                </div>
                            </div>

                            {/* Activity Log */}
                            <div className="ut-card ut-activity-card">
                                <h2 className="ut-card-title">Activity Log</h2>
                                <div className="ut-activity-list">
                                    {allActivitySteps.map((step, i) => {
                                        const isComplete = completedKeys.has(step.key);
                                        const histEntry = (data.status_history || []).find(h => h.status === step.key);
                                        const timestamp = step.key === "detection" && isDone
                                            ? (data.status_history || []).find(h => h.status === "Done")?.timestamp
                                            : histEntry?.timestamp;

                                        return (
                                            <div key={step.key} className={`ut-activity-item ${isComplete ? "ut-activity-done" : "ut-activity-pending"}`}>
                                                <div className="ut-activity-dot-col">
                                                    <div className={`ut-activity-dot ${isComplete ? "ut-dot-done" : "ut-dot-pending"}`}>
                                                        {isComplete ? <CheckCircle2 size={16} /> : <Circle size={14} />}
                                                    </div>
                                                    {i < allActivitySteps.length - 1 && <div className={`ut-activity-line ${isComplete ? "ut-aline-done" : ""}`} />}
                                                </div>
                                                <div className="ut-activity-content">
                                                    <span className="ut-activity-label">{step.label}</span>
                                                    {isComplete && timestamp && (
                                                        <span className="ut-activity-time">{formatDateTime(timestamp)}</span>
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        </div>
                    )}

                    {/* When not Done (Queued/Processing) — show simplified activity log only */}
                    {!isDone && !isFailed && (
                        <div className="ut-card ut-activity-standalone">
                            <h2 className="ut-card-title">Activity Log</h2>
                            <p className="ut-activity-hint">Your report is being processed. This page updates automatically.</p>
                            <div className="ut-activity-list">
                                {allActivitySteps.map((step, i) => {
                                    const isComplete = completedKeys.has(step.key);
                                    const isCurrent = (
                                        (step.key === "Queued" && data.status === "Queued") ||
                                        (step.key === "Processing" && data.status === "Processing")
                                    );
                                    const histEntry = (data.status_history || []).find(h => h.status === step.key);

                                    return (
                                        <div key={step.key} className={`ut-activity-item ${isComplete ? "ut-activity-done" : isCurrent ? "ut-activity-current" : "ut-activity-pending"}`}>
                                            <div className="ut-activity-dot-col">
                                                <div className={`ut-activity-dot ${isComplete ? "ut-dot-done" : isCurrent ? "ut-dot-current" : "ut-dot-pending"}`}>
                                                    {isComplete ? <CheckCircle2 size={16} /> : isCurrent ? <Loader2 size={16} className="ut-spin" /> : <Circle size={14} />}
                                                </div>
                                                {i < allActivitySteps.length - 1 && <div className={`ut-activity-line ${isComplete ? "ut-aline-done" : ""}`} />}
                                            </div>
                                            <div className="ut-activity-content">
                                                <span className="ut-activity-label">{step.label}</span>
                                                {isComplete && histEntry?.timestamp && (
                                                    <span className="ut-activity-time">{formatDateTime(histEntry.timestamp)}</span>
                                                )}
                                                {isCurrent && <span className="ut-activity-time ut-activity-processing">In progress...</span>}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    {/* Failed — show activity log with error */}
                    {isFailed && (
                        <div className="ut-card ut-activity-standalone">
                            <h2 className="ut-card-title">Activity Log</h2>
                            <div className="ut-activity-list">
                                {allActivitySteps.map((step, i) => {
                                    const histEntry = (data.status_history || []).find(h => h.status === step.key);
                                    const isComplete = completedKeys.has(step.key);
                                    const isFail = step.key === "Processing" && data.status === "Failed";

                                    return (
                                        <div key={step.key} className={`ut-activity-item ${isComplete ? "ut-activity-done" : isFail ? "ut-activity-failed" : "ut-activity-pending"}`}>
                                            <div className="ut-activity-dot-col">
                                                <div className={`ut-activity-dot ${isComplete ? "ut-dot-done" : isFail ? "ut-dot-failed" : "ut-dot-pending"}`}>
                                                    {isComplete ? <CheckCircle2 size={16} /> : isFail ? <XCircle size={16} /> : <Circle size={14} />}
                                                </div>
                                                {i < allActivitySteps.length - 1 && <div className={`ut-activity-line ${isComplete ? "ut-aline-done" : ""}`} />}
                                            </div>
                                            <div className="ut-activity-content">
                                                <span className="ut-activity-label">{isFail ? "Processing failed" : step.label}</span>
                                                {isComplete && histEntry?.timestamp && (
                                                    <span className="ut-activity-time">{formatDateTime(histEntry.timestamp)}</span>
                                                )}
                                                {isFail && histEntry?.timestamp && (
                                                    <span className="ut-activity-time">{formatDateTime(histEntry.timestamp)}</span>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    {/* Footer sync info */}
                    <div className="ut-footer">
                        Last synchronized: {data.updated_at ? new Date(data.updated_at).toLocaleTimeString() : "—"}
                    </div>
                </>
            )}

            {/* Lightbox */}
            {lightboxUrl && (
                <div className="ut-lightbox" onClick={() => setLightboxUrl(null)}>
                    <button className="ut-lightbox-close" onClick={() => setLightboxUrl(null)}><X size={24} /></button>
                    <img src={lightboxUrl} alt="Detection preview" onClick={e => e.stopPropagation()} />
                </div>
            )}
        </div>
    );
}
