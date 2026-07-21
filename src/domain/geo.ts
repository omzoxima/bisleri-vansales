import { VISIT_GEOFENCE_METRES } from '../shared';

/** Haversine distance in metres. */
export function distanceMetres(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export function withinGeofence(
  repLat: number,
  repLng: number,
  custLat: number,
  custLng: number,
  radiusM: number = VISIT_GEOFENCE_METRES,
): { ok: boolean; distanceM: number } {
  const distanceM = Math.round(distanceMetres(repLat, repLng, custLat, custLng));
  return { ok: distanceM <= radiusM, distanceM };
}
