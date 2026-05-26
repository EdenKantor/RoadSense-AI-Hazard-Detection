/**
 * useReverseGeocode hook.
 *
 * Resolves a (lat, lon) pair to a human-readable address via the backend
 * /api/geocode/reverse proxy. Results are memoised in a module-scoped Map
 * keyed by 5-decimal-rounded coordinates, so repeated lookups for nearby
 * points (or the same marker re-rendering) hit the cache instead of the
 * upstream provider.
 */
import { useEffect, useState } from "react";

// Module-level cache survives component unmounts and is shared across all
// hook callers, which is the entire point of doing reverse-geocoding once.
const cache = new Map();

/**
 * Resolves coordinates to an address string asynchronously.
 *
 * @param {number|null|undefined} lat - Latitude in degrees.
 * @param {number|null|undefined} lon - Longitude in degrees.
 * @returns {string|null} The resolved address, or null while loading / on error.
 */
export default function useReverseGeocode(lat, lon) {
    const [address, setAddress] = useState(null);

    useEffect(() => {
        if (lat == null || lon == null || !Number.isFinite(lat) || !Number.isFinite(lon)) return;

        const key = `${lat.toFixed(5)},${lon.toFixed(5)}`;
        if (cache.has(key)) {
            setAddress(cache.get(key));
            return;
        }

        // `cancelled` guards against setState after unmount when the user
        // navigates away (or coords change) while the fetch is still in flight.
        let cancelled = false;
        fetch(`/api/geocode/reverse?lat=${lat}&lon=${lon}`)
            .then((res) => res.json())
            .then((data) => {
                if (cancelled) return;
                const result = data?.address || null;
                cache.set(key, result);
                setAddress(result);
            })
            .catch(() => {});

        return () => { cancelled = true; };
    }, [lat, lon]);

    return address;
}
