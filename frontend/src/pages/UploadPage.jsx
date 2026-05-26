/**
 * Citizen upload page.
 *
 * Authenticated citizens (route /upload) submit a dashcam MP4 + GPX file pair
 * via a click-to-select drag-and-drop UI laid out with a three-step stepper
 * (Video → GPX → Processing). On submit, calls uploadsApi.create with both
 * files and navigates to /uploads/:uploadId/status to track processing. The
 * submit button is disabled until both files are present, and any backend
 * error message ("detail") surfaces inline above the button.
 */
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Upload, Video, MapPin, Loader2, CheckCircle2 } from "lucide-react";
import { uploadsApi } from "../api/client";

// Client-side upload size guards. Backend / reverse-proxy enforce limits too,
// but failing fast before the multipart POST starts saves the user from
// waiting through a doomed upload (a 2 GB clip on a slow connection can hang
// for many minutes before the server rejects).
const MAX_VIDEO_BYTES = 100 * 1024 * 1024; // 100 MB — matches the picker copy
const MAX_GPX_BYTES   = 5   * 1024 * 1024; // 5 MB — generous for ~50 km drives

/** Renders the MP4 + GPX upload form with a stepper progress indicator. */
export default function UploadPage() {
    const navigate = useNavigate();
    const [videoFile, setVideoFile] = useState(null);
    const [gpxFile, setGpxFile] = useState(null);
    const [uploading, setUploading] = useState(false);
    const [error, setError] = useState("");

    const handleSubmit = async (event) => {
        event.preventDefault();
        if (!videoFile || !gpxFile) {
            setError("Please select both MP4 video and GPX files.");
            return;
        }
        if (videoFile.size > MAX_VIDEO_BYTES) {
            setError(`Video is ${(videoFile.size / 1024 / 1024).toFixed(0)} MB; the limit is 100 MB.`);
            return;
        }
        if (gpxFile.size > MAX_GPX_BYTES) {
            setError(`GPX file is ${(gpxFile.size / 1024 / 1024).toFixed(2)} MB; the limit is 5 MB.`);
            return;
        }

        setError("");
        setUploading(true);

        try {
            const result = await uploadsApi.create(videoFile, gpxFile);
            const payload = result?.data ?? result ?? {};
            const uploadId = payload.upload_id || payload.id || payload._id;

            if (!uploadId) {
                setError("Upload succeeded but no upload ID was returned.");
                return;
            }

            navigate(`/uploads/${uploadId}/status`);
        } catch (err) {
            setError(err.response?.data?.detail || "Upload failed.");
        } finally {
            setUploading(false);
        }
    };

    // Step states
    const step1Done = !!videoFile;
    const step2Done = !!gpxFile;
    const step3Active = uploading;

    return (
        <div>
            <div className="page-banner banner-orange">
                <h1 className="banner-title"><Upload size={22} style={{ display: "inline", marginRight: "0.5rem" }} />Report a Road Issue</h1>
                <p className="banner-subtitle">Upload your road footage and GPS track</p>
            </div>

            {/* ── Step Indicator ── */}
            <div className="stepper">
                <div className={`step ${step1Done ? "completed" : "active"}`}>
                    <div className="step-circle">{step1Done ? <CheckCircle2 size={18} /> : "1"}</div>
                    <span>Video Evidence</span>
                </div>
                <div className={`step-line ${step1Done ? "active" : ""}`} />
                <div className={`step ${step2Done ? "completed" : step1Done ? "active" : ""}`}>
                    <div className="step-circle">{step2Done ? <CheckCircle2 size={18} /> : "2"}</div>
                    <span>GPX File</span>
                </div>
                <div className={`step-line ${step2Done ? "active" : ""}`} />
                <div className={`step ${step3Active ? "active" : step1Done && step2Done ? "active" : ""}`}>
                    <div className="step-circle">{step3Active ? <Loader2 size={18} className="upload-spin" /> : "3"}</div>
                    <span>Processing</span>
                </div>
            </div>

            <div className="card" style={{ maxWidth: "48rem", margin: "0 auto" }}>
                <div className="card-content">
                    <div className="text-center mb-6">
                        <h2 style={{ fontSize: "1.25rem", fontWeight: 700, marginBottom: "0.25rem" }}>Upload Evidence</h2>
                        <p className="text-muted" style={{ fontSize: "0.85rem" }}>Both MP4 video and GPX file are required</p>
                    </div>

                    <form onSubmit={handleSubmit}>
                        <div className="form-group">
                            <label className="form-label">
                                <Video size={16} style={{ marginRight: 6, verticalAlign: "middle" }} />
                                Video File (MP4) *
                            </label>
                            <div
                                className={`upload-drop-zone ${videoFile ? "upload-drop-done" : ""}`}
                                onClick={() => document.getElementById("video-input").click()}
                            >
                                <input
                                    id="video-input"
                                    type="file"
                                    accept="video/mp4,video/*"
                                    style={{ display: "none" }}
                                    onChange={(event) => setVideoFile(event.target.files[0])}
                                />
                                {videoFile ? (
                                    <>
                                        <CheckCircle2 size={24} style={{ color: "var(--primary)", marginBottom: 4 }} />
                                        <p style={{ fontWeight: 600, color: "var(--primary)" }}>{videoFile.name}</p>
                                        <p className="text-muted" style={{ fontSize: "0.8rem" }}>{(videoFile.size / 1024 / 1024).toFixed(1)} MB</p>
                                    </>
                                ) : (
                                    <>
                                        <Upload size={24} style={{ color: "var(--text-muted)", marginBottom: 4 }} />
                                        <p style={{ fontWeight: 500 }}>Click to select a video file</p>
                                        <p className="text-muted" style={{ fontSize: "0.8rem" }}>MP4 recommended, max 100 MB</p>
                                    </>
                                )}
                            </div>
                        </div>

                        <div className="form-group mb-8">
                            <label className="form-label">
                                <MapPin size={16} style={{ marginRight: 6, verticalAlign: "middle" }} />
                                GPS Track File (GPX) *
                            </label>
                            <div
                                className={`upload-drop-zone ${gpxFile ? "upload-drop-done-gpx" : ""}`}
                                onClick={() => document.getElementById("gpx-input").click()}
                            >
                                <input
                                    id="gpx-input"
                                    type="file"
                                    accept=".gpx"
                                    style={{ display: "none" }}
                                    onChange={(event) => setGpxFile(event.target.files[0])}
                                />
                                {gpxFile ? (
                                    <>
                                        <CheckCircle2 size={24} style={{ color: "#15803d", marginBottom: 4 }} />
                                        <p style={{ fontWeight: 600, color: "#15803d" }}>{gpxFile.name}</p>
                                        <p className="text-muted" style={{ fontSize: "0.8rem" }}>{(gpxFile.size / 1024).toFixed(1)} KB</p>
                                    </>
                                ) : (
                                    <>
                                        <MapPin size={24} style={{ color: "var(--text-muted)", marginBottom: 4 }} />
                                        <p style={{ fontWeight: 500 }}>Click to select a GPX file</p>
                                        <p className="text-muted" style={{ fontSize: "0.8rem" }}>Required for time alignment and map placement</p>
                                    </>
                                )}
                            </div>
                        </div>

                        {error && (
                            <div className="badge badge-danger mb-4" style={{ width: "100%", justifyContent: "center", padding: "0.625rem", fontSize: "0.85rem" }}>
                                {error}
                            </div>
                        )}

                        <button type="submit" className="btn btn-primary btn-block" disabled={uploading || !videoFile || !gpxFile} style={{ padding: "0.875rem", fontSize: "1rem" }}>
                            {uploading ? "Uploading..." : "Submit Report"}
                        </button>
                    </form>
                </div>
            </div>
        </div>
    );
}
