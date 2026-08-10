/**
 * Determines whether a GPS point is inside a polygon, using the
 * ray-casting algorithm: imagine a horizontal ray shooting out from
 * the point to infinity. Count how many polygon edges it crosses.
 * Odd count = inside the shape. Even count = outside.
 *
 * @param {number} lat - the point's latitude
 * @param {number} lng - the point's longitude
 * @param {number[][]} polygon - array of [lng, lat] pairs forming the shape
 * @returns {boolean}
 */
export function isPointInPolygon(lat, lng, polygon) {
  let inside = false;

  // Walk through each edge of the polygon (each pair of consecutive points)
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i]; // [lng, lat] of this corner
    const [xj, yj] = polygon[j]; // [lng, lat] of the previous corner

    // This condition checks: does the horizontal ray from our point
    // cross this particular edge? The math is a standard formula for
    // ray-casting; the key intuition is "does this edge span across
    // our point's latitude, and if so, is the crossing to our right?"
    const intersects =
      yi > lat !== yj > lat &&
      lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;

    if (intersects) inside = !inside; // flip inside/outside each crossing
  }

  return inside;
}

/**
 * Checks a point against every zone in a list, returning the zones
 * it falls inside (a point could theoretically be in multiple
 * overlapping zones).
 *
 * @param {number} lat
 * @param {number} lng
 * @param {Array} zones - rows from geofence_zones, each with boundary_geojson
 * @returns {Array} the zones the point is inside
 */
export function findBreachedZones(lat, lng, zones) {
  return zones.filter((zone) => {
    const polygon = zone.boundary_geojson.coordinates[0]; // outer ring of the polygon
    return isPointInPolygon(lat, lng, polygon);
  });
}

/**
 * Calculates the real-world distance (in meters) between two GPS
 * points using the Haversine formula — accounts for the Earth's
 * curvature, unlike naive flat-plane distance math, which becomes
 * inaccurate over any meaningful distance.
 */
export function haversineDistanceMeters(lat1, lng1, lat2, lng2) {
  const EARTH_RADIUS_METERS = 6371000;

  // Convert degrees to radians — trigonometric functions in JS
  // (Math.sin, Math.cos) expect radians, not degrees.
  const toRadians = (deg) => (deg * Math.PI) / 180;

  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLng / 2) ** 2;

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return EARTH_RADIUS_METERS * c;
}

/**
 * Given a tourist's current position and their planned route (a list
 * of [lng, lat] waypoints), finds the distance to the NEAREST point
 * on that route. A large distance means they've likely gone off-path.
 */
export function distanceFromRoute(lat, lng, routeWaypoints) {
  let minDistance = Infinity;

  for (const [routeLng, routeLat] of routeWaypoints) {
    const distance = haversineDistanceMeters(lat, lng, routeLat, routeLng);
    if (distance < minDistance) {
      minDistance = distance;
    }
  }

  return minDistance;
}