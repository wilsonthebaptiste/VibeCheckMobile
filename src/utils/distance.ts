/** Earth's mean radius in miles. Matches the backend's `venues/utils.py`. */
const EARTH_RADIUS_MILES = 3958.8;

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/**
 * Great-circle distance in miles.
 *
 * Deliberately the same formula and the same radius as the server's
 * `haversine_distance`, because the two are compared against the SAME
 * threshold: the client decides locally whether it has arrived, and the server
 * re-checks that claim before recording it. A different approximation here
 * (equirectangular, or a different radius) would put a band of positions where
 * the phone announces "you made it" and the server answers 403.
 */
export function haversineMiles(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const deltaLat = toRadians(lat2 - lat1);
  const deltaLng = toRadians(lng2 - lng1);

  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(deltaLng / 2) ** 2;

  return EARTH_RADIUS_MILES * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
