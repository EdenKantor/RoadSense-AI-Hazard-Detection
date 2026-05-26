/**
 * MapView — Leaflet-based pothole event map.
 *
 * Renders an OpenStreetMap tile layer with a clustered marker layer powered
 * by react-leaflet-cluster. Each event marker is a coloured div-icon whose
 * colour encodes the event's lifecycle status, and clicking a marker opens
 * a popup with severity, count, location, address (reverse-geocoded), the
 * report timestamp, and an optional thumbnail. The component also exposes
 * a few helper sub-components that participate in the Leaflet lifecycle:
 * BoundsWatcher (notifies parent of viewport changes), MapCenterController
 * (fly-to on prop change) and MapResizeController (invalidates size when
 * the layout changes — prevents the well-known grey-tile bug).
 */
import { useEffect, useMemo } from "react";
import useReverseGeocode from "../hooks/useReverseGeocode";
import L from "leaflet";
import {
    MapContainer,
    Marker,
    Popup,
    TileLayer,
    useMap,
    useMapEvents,
} from "react-leaflet";
import MarkerClusterGroup from "react-leaflet-cluster";
import "leaflet/dist/leaflet.css";
import "leaflet.markercluster/dist/MarkerCluster.css";
import "leaflet.markercluster/dist/MarkerCluster.Default.css";

const FALLBACK_CENTER = [31.7683, 35.2137];

const STATUS_COLORS = {
    Resolved: "#10b981",
    "In Progress": "#f97316",
    Pending: "#f59e0b",
    Reported: "#f59e0b",
    UnderReview: "#f97316",
    Scheduled: "#f97316",
    Rejected: "#ef4444",
};

/**
 * Strips directory prefixes (forward or back slashes) and returns just the
 * file name. Backend paths use mixed separators on Windows hosts.
 */
function normalizeFileName(input) {
    if (!input || typeof input !== "string") return null;
    const cleaned = input.replaceAll("\\", "/");
    const segments = cleaned.split("/").filter(Boolean);
    if (!segments.length) return null;
    return segments[segments.length - 1];
}

/** Builds the static thumbnail URL for an event's frame, or null if missing. */
function previewUrlForEvent(event) {
    const fileName = normalizeFileName(event?.frame_thumbnail_path);
    if (!fileName || !event?.upload_id) return null;
    return `http://127.0.0.1:8000/static/output/${event.upload_id}/${fileName}`;
}

/**
 * Returns a Leaflet divIcon coloured by the event's lifecycle status.
 * Falls back to the Pending colour for unknown statuses.
 */
function createCustomIcon(status) {
    const color = STATUS_COLORS[status] || STATUS_COLORS.Pending;
    return L.divIcon({
        className: "custom-pothole-marker",
        html: `<div style="background-color:${color};width:20px;height:20px;border-radius:50%;border:3px solid white;box-shadow:0 0 4px rgba(0,0,0,0.3);"></div>`,
        iconSize: [20, 20],
        iconAnchor: [10, 10],
        popupAnchor: [0, -10],
    });
}

/** Custom cluster-bubble icon showing the child marker count. */
function createClusterIcon(cluster) {
    const count = cluster.getChildCount();
    return L.divIcon({
        html: `<div class="map-cluster-badge"><span>${count}</span></div>`,
        className: "map-cluster-shell",
        iconSize: [38, 38],
    });
}

/** Formats `detected_at` (preferred) or `created_at` for display. */
function formatReportedAt(event) {
    const value = event?.detected_at || event?.created_at;
    if (!value) return "Unknown";
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return "Unknown";
    return parsed.toLocaleString();
}

/** Returns "lat, lon" with 5 decimals, or "Unknown" if coords are malformed. */
function formatLocation(event) {
    const coords = event?.location?.coordinates;
    if (!Array.isArray(coords) || coords.length !== 2) return "Unknown";
    const [lon, lat] = coords;
    return `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
}

/**
 * Headless component that calls `onBoundsChange` with the current viewport
 * bounds whenever the map finishes panning/zooming, plus once on mount.
 *
 * @param {Object} props
 * @param {function} props.onBoundsChange - Called with {min_lat, max_lat, min_lon, max_lon}.
 */
function BoundsWatcher({ onBoundsChange }) {
    const map = useMapEvents({
        moveend(e) {
            const b = e.target.getBounds();
            onBoundsChange({
                min_lat: b.getSouth(),
                max_lat: b.getNorth(),
                min_lon: b.getWest(),
                max_lon: b.getEast(),
            });
        },
    });

    useEffect(() => {
        const b = map.getBounds();
        onBoundsChange({
            min_lat: b.getSouth(),
            max_lat: b.getNorth(),
            min_lon: b.getWest(),
            max_lon: b.getEast(),
        });
    }, [map, onBoundsChange]);

    return null;
}

/**
 * Headless component that flies the map to a new centre when the prop
 * changes, preserving any zoom level >= 13.
 *
 * @param {Object} props
 * @param {[number, number]} props.center - [lat, lon] target centre.
 */
function MapCenterController({ center }) {
    const map = useMap();

    useEffect(() => {
        if (!Array.isArray(center) || center.length !== 2) return;
        map.flyTo(center, Math.max(map.getZoom(), 13), { duration: 0.7 });
    }, [center, map]);

    return null;
}

/**
 * Headless component that calls map.invalidateSize() whenever the container
 * is resized. Without this, Leaflet renders grey/blank tiles when the map
 * is mounted inside a flex/grid container that hasn't finished sizing, or
 * when the sidebar collapses. Watches both ResizeObserver and window resize.
 */
function MapResizeController() {
    const map = useMap();

    useEffect(() => {
        // Defer to the next frame so Leaflet sees the post-layout container size.
        const invalidate = () => {
            window.requestAnimationFrame(() => {
                map.invalidateSize();
            });
        };

        invalidate();

        const container = map.getContainer();
        let observer = null;

        if (typeof ResizeObserver !== "undefined") {
            observer = new ResizeObserver(() => invalidate());
            observer.observe(container);
        }

        window.addEventListener("resize", invalidate);

        return () => {
            window.removeEventListener("resize", invalidate);
            if (observer) observer.disconnect();
        };
    }, [map]);

    return null;
}

/**
 * Popup body shown when a pothole marker is clicked: short event id,
 * severity + status badges, location with reverse-geocoded address,
 * detection count, reported timestamp, and an optional thumbnail.
 *
 * @param {Object} props
 * @param {Object} props.event - Event document from the backend.
 */
function MarkerPopupContent({ event }) {
    const thumbUrl = previewUrlForEvent(event);
    const coords = event?.location?.coordinates;
    const address = useReverseGeocode(coords?.[1], coords?.[0]);

    const shortId = (event?.event_id || "0000").slice(0, 4).toUpperCase();
    const severity = (event?.severity || "Unknown").toLowerCase();
    const status = (event?.lifecycle_status || "Reported");
    const statusLower = status.toLowerCase();
    const count = event?.detection_count || 0;

    return (
        <div className="map-popup-card">
            <div className="mp-header">
                <span className="mp-emoji">🕳️</span>
                <strong>Pothole Event #{shortId}</strong>
            </div>

            <div className="mp-badges">
                <span className={`mp-badge mp-sev-${severity}`}>{event?.severity || "Unknown"} Severity</span>
                <span className={`mp-badge mp-status-${statusLower.replace(/\s/g, "")}`}>{status}</span>
            </div>

            <div className="mp-divider" />

            <div className="mp-row">
                <span className="mp-label">📍 Location:</span>
                <span className="mp-value">{formatLocation(event)}</span>
            </div>
            {address && (
                <div className="mp-sub-row">{address}</div>
            )}

            <div className="mp-row">
                <span className="mp-label">🕳️ Count:</span>
                <span className="mp-count-pill">{count} pothole{count !== 1 ? "s" : ""}</span>
            </div>

            <div className="mp-row">
                <span className="mp-label">📅 Reported:</span>
                <span className="mp-value">{formatReportedAt(event)}</span>
            </div>

            {thumbUrl && (
                <img
                    src={thumbUrl}
                    alt=""
                    className="map-popup-thumb"
                    onError={(e) => { e.currentTarget.style.display = "none"; }}
                />
            )}
        </div>
    );
}

export default function MapView({ events = [], onBoundsChange, center, zoom = 8 }) {
    const safeCenter = Array.isArray(center) && center.length === 2 ? center : FALLBACK_CENTER;

    const safeEvents = useMemo(() => {
        return (events || []).filter((event) => {
            const coords = event?.location?.coordinates;
            return Array.isArray(coords) && coords.length === 2 && Number.isFinite(coords[0]) && Number.isFinite(coords[1]);
        });
    }, [events]);

    return (
        <MapContainer
            center={safeCenter}
            zoom={zoom}
            className="map-container"
            style={{ width: "100%", height: "100%" }}
            dragging
            scrollWheelZoom
            doubleClickZoom
            boxZoom
            keyboard
            touchZoom
            closePopupOnClick
            preferCanvas
            whenReady={(e) => e.target.invalidateSize()}
        >
            <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />

            {onBoundsChange && <BoundsWatcher onBoundsChange={onBoundsChange} />}
            {Array.isArray(center) && center.length === 2 && <MapCenterController center={safeCenter} />}
            <MapResizeController />

            <MarkerClusterGroup
                chunkedLoading
                showCoverageOnHover={false}
                spiderfyOnMaxZoom
                maxClusterRadius={60}
                disableClusteringAtZoom={14}
                removeOutsideVisibleBounds
                iconCreateFunction={createClusterIcon}
            >
                {safeEvents.map((event) => {
                    const [lon, lat] = event.location.coordinates;
                    const icon = createCustomIcon(event.lifecycle_status);

                    return (
                        <Marker key={event.event_id} position={[lat, lon]} icon={icon}>
                            <Popup autoClose={true} closeOnClick={true} autoPan={false} keepInView={false} closeButton={true}><MarkerPopupContent event={event} /></Popup>
                        </Marker>
                    );
                })}
            </MarkerClusterGroup>
        </MapContainer>
    );
}
