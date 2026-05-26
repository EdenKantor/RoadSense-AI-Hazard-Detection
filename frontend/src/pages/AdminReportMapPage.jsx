/**
 * Admin per-upload event map page.
 *
 * Admin-only Leaflet map showing every pothole event detected from a single
 * upload, color-coded by severity (High/red, Medium/amber, Low/green). Each
 * marker popup links to the matching event detail. Loaded from the same
 * processing-review endpoint as AdminProcessingReviewPage.
 */
import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import L from "leaflet";
import { MapContainer, Marker, Popup, TileLayer } from "react-leaflet";
import { adminApi } from "../api/client";
import { ArrowLeft } from "lucide-react";

function createDotIcon(severity) {
    const colors = { High: "#ef4444", Medium: "#f59e0b", Low: "#22c55e" };
    const color = colors[severity] || "#3b82f6";
    return L.divIcon({
        className: "custom-pothole-marker",
        html: `<div style="background:${color};width:20px;height:20px;border-radius:50%;border:3px solid white;box-shadow:0 2px 8px rgba(0,0,0,0.3);"></div>`,
        iconSize: [20, 20],
        iconAnchor: [10, 10],
        popupAnchor: [0, -10],
    });
}

export default function AdminReportMapPage() {
    const { uploadId } = useParams();
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [sevFilter, setSevFilter] = useState({ High: true, Medium: true, Low: true });

    useEffect(() => {
        setLoading(true);
        adminApi.processingReview(uploadId)
            .then((res) => setData(res.data))
            .catch(() => {})
            .finally(() => setLoading(false));
    }, [uploadId]);

    const events = data?.events || [];
    const filtered = useMemo(() => events.filter(e => sevFilter[e.severity]), [events, sevFilter]);

    const mapCenter = useMemo(() => {
        if (filtered.length === 0) return [31.0461, 34.8516];
        const latSum = filtered.reduce((a, e) => a + e.location.coordinates[1], 0);
        const lonSum = filtered.reduce((a, e) => a + e.location.coordinates[0], 0);
        return [latSum / filtered.length, lonSum / filtered.length];
    }, [filtered]);

    const toggle = (sev) => setSevFilter(prev => ({ ...prev, [sev]: !prev[sev] }));

    if (loading) return <div className="rd-page"><p className="text-muted" style={{ padding: "2rem" }}>Loading map...</p></div>;

    return (
        <div className="rdm-page">
            <div className="rdm-header">
                <Link to={`/admin/uploads/${uploadId}/review`} className="rd-back"><ArrowLeft size={16} /> Back to Report Details</Link>
                <div className="rdm-title-row">
                    <div>
                        <h1 className="rd-title" style={{ margin: 0 }}>Detected Events Map</h1>
                        <p className="text-muted" style={{ margin: "0.15rem 0 0", fontSize: "0.88rem" }}>Upload ID: {uploadId?.slice(0, 10)}</p>
                    </div>
                    <div className="rdm-filter-wrap">
                        <span className="rdm-filter-count">{filtered.length} of {events.length} events shown</span>
                        <div className="rdm-filters">
                            <span className="rdm-filter-label">Filter by Severity:</span>
                            {[{ sev: "High", color: "#ef4444" }, { sev: "Medium", color: "#f59e0b" }, { sev: "Low", color: "#22c55e" }].map(({ sev, color }) => (
                                <label key={sev} className={`rdm-filter-pill ${sevFilter[sev] ? "rdm-filter-active" : ""}`} style={{ "--fc": color }}>
                                    <input type="checkbox" checked={sevFilter[sev]} onChange={() => toggle(sev)} />
                                    <span className="rdm-filter-dot" style={{ background: color }} />
                                    {sev} ({events.filter(e => e.severity === sev).length})
                                </label>
                            ))}
                        </div>
                    </div>
                </div>
            </div>

            <div className="rdm-map">
                <MapContainer center={mapCenter} zoom={14} style={{ height: "100%", width: "100%" }}>
                    <TileLayer
                        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                    />
                    {filtered.map((ev) => {
                        const [lon, lat] = ev.location.coordinates;
                        return (
                            <Marker key={ev.event_id} position={[lat, lon]} icon={createDotIcon(ev.severity)}>
                                <Popup>
                                    <div style={{ width: 200 }}>
                                        {ev.frame_thumbnail_path && (
                                            <img
                                                src={`/static/output/${uploadId}/${ev.frame_thumbnail_path.replace(/\\/g, "/").split("/").pop()}`}
                                                alt="Detection" style={{ width: "100%", borderRadius: "0.3rem", marginBottom: "0.4rem" }}
                                                onError={(e) => { e.currentTarget.style.display = "none"; }}
                                            />
                                        )}
                                        <strong>Event {ev.event_id.slice(0, 8)}</strong><br />
                                        Severity: <span style={{ color: ev.severity === "High" ? "#ef4444" : ev.severity === "Medium" ? "#f59e0b" : "#22c55e", fontWeight: 600 }}>{ev.severity}</span><br />
                                        Confidence: {(ev.avg_confidence * 100).toFixed(1)}%<br />
                                        Detections: {ev.detection_count}<br />
                                        Status: {ev.lifecycle_status}
                                    </div>
                                </Popup>
                            </Marker>
                        );
                    })}
                </MapContainer>
            </div>
        </div>
    );
}
