"""
Reverse geocoding proxy — uses BigDataCloud free API.
Caches successful results in-memory.

GET /api/geocode/reverse?lat=...&lon=...
"""
import httpx
from fastapi import APIRouter, Query

router = APIRouter()

_cache: dict[str, dict] = {}


@router.get("/reverse")
async def reverse_geocode(
    lat: float = Query(...),
    lon: float = Query(...),
) -> dict:
    """Reverse-geocode a coordinate pair to a human-readable address.

    Args:
        lat: Latitude in decimal degrees.
        lon: Longitude in decimal degrees.

    Returns:
        A dict with an "address" key holding a "City, Neighbourhood" string,
        or {"address": None} if lookup failed or no useful data was returned.
    """
    # Round to 5 decimals (~1m precision) to share cache hits across nearby points.
    key = f"{lat:.5f},{lon:.5f}"
    if key in _cache:
        return _cache[key]

    try:
        async with httpx.AsyncClient(follow_redirects=True) as client:
            resp = await client.get(
                "https://api.bigdatacloud.net/data/reverse-geocode-client",
                params={"latitude": lat, "longitude": lon, "localityLanguage": "en"},
                timeout=8.0,
            )
            resp.raise_for_status()
            data = resp.json()
    except Exception:
        return {"address": None}

    city = data.get("city") or data.get("locality") or ""
    # Try to get more specific info from localityInfo
    informative = data.get("localityInfo", {}).get("informative", [])
    neighbourhood = ""
    for item in informative:
        name = item.get("name", "")
        if name and item.get("order", 99) >= 10:
            neighbourhood = name
            break

    parts = []
    if city:
        parts.append(city)
    if neighbourhood and neighbourhood != city:
        parts.append(neighbourhood)

    addr = ", ".join(parts) if parts else None
    result = {"address": addr}
    if addr:
        _cache[key] = result
    return result


@router.get("/city")
async def get_city_for_coords(
    lat: float = Query(...),
    lon: float = Query(...),
):
    """Return just the city name for given coordinates."""
    # Reuse the same BigDataCloud logic but return just city
    key = f"city_{lat:.5f},{lon:.5f}"
    if key in _cache:
        return _cache[key]

    try:
        async with httpx.AsyncClient(follow_redirects=True) as client:
            resp = await client.get(
                "https://api.bigdatacloud.net/data/reverse-geocode-client",
                params={"latitude": lat, "longitude": lon, "localityLanguage": "en"},
                timeout=8.0,
            )
            resp.raise_for_status()
            data = resp.json()
    except Exception:
        return {"city": None}

    city = data.get("city") or data.get("locality") or None
    result = {"city": city}
    if city:
        _cache[key] = result
    return result
