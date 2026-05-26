/**
 * AddressLabel — small inline label that reverse-geocodes (lat, lon) and
 * renders the resulting address as muted secondary text.
 *
 * Renders nothing while the address is loading or if the lookup fails,
 * so callers can drop it next to coordinates without layout flicker.
 */
import useReverseGeocode from "../hooks/useReverseGeocode";

/**
 * @param {Object} props
 * @param {number} props.lat - Latitude to reverse-geocode.
 * @param {number} props.lon - Longitude to reverse-geocode.
 */
export default function AddressLabel({ lat, lon }) {
    const address = useReverseGeocode(lat, lon);
    if (!address) return null;
    return <span style={{ fontSize: "0.82rem", color: "var(--text-muted)" }}>{address}</span>;
}
