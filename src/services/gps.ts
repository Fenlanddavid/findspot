export type GPSFix = {
  lat: number;
  lon: number;
  accuracyM: number | null;
};

export async function captureGPS(options?: {
  onProgress?: (accuracyM: number) => void;
  acceptRef?: { accept: (() => void) | null };
}): Promise<GPSFix> {
  return new Promise((resolve, reject) => {
    if (!("geolocation" in navigator)) {
      reject(new Error("No geolocation available on this device/browser."));
      return;
    }

    let bestFix: GPSFix | null = null;
    let watchId: number | null = null;

    // Force high-accuracy lock
    const timeoutId = setTimeout(() => {
      if (watchId !== null) navigator.geolocation.clearWatch(watchId);
      if (bestFix) resolve(bestFix);
      else reject(new Error("GPS timeout: Could not get a stable lock."));
    }, 10000); // 10s max wait for precision

    if (options?.acceptRef) {
      options.acceptRef.accept = () => {
        clearTimeout(timeoutId);
        if (watchId !== null) navigator.geolocation.clearWatch(watchId);
        if (bestFix) resolve(bestFix);
      };
    }

    watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const fix = {
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          accuracyM: Number.isFinite(pos.coords.accuracy) ? pos.coords.accuracy : null,
        };

        if (!bestFix || (fix.accuracyM !== null && (bestFix.accuracyM === null || fix.accuracyM < bestFix.accuracyM))) {
          bestFix = fix;
          if (fix.accuracyM !== null) options?.onProgress?.(fix.accuracyM);
        }

        // If we hit our target precision (under 10m), finish early
        if (fix.accuracyM !== null && fix.accuracyM <= 10) {
          clearTimeout(timeoutId);
          if (watchId !== null) navigator.geolocation.clearWatch(watchId);
          resolve(fix);
        }
      },
      (err) => {
        clearTimeout(timeoutId);
        if (watchId !== null) navigator.geolocation.clearWatch(watchId);
        reject(new Error(err.message || "GPS capture failed"));
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  });
}

type GridFigures = 6 | 8 | 10;

type Cartesian = {
  x: number;
  y: number;
  z: number;
};

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

const WGS84 = { a: 6378137.0, b: 6356752.3141 };
const AIRY1830 = { a: 6377563.396, b: 6356256.909 };

function toCartesian(lat: number, lon: number, height: number, ellipsoid: typeof WGS84): Cartesian {
  const phi = lat * DEG_TO_RAD;
  const lambda = lon * DEG_TO_RAD;
  const sinPhi = Math.sin(phi);
  const cosPhi = Math.cos(phi);
  const e2 = 1 - (ellipsoid.b * ellipsoid.b) / (ellipsoid.a * ellipsoid.a);
  const nu = ellipsoid.a / Math.sqrt(1 - e2 * sinPhi * sinPhi);

  return {
    x: (nu + height) * cosPhi * Math.cos(lambda),
    y: (nu + height) * cosPhi * Math.sin(lambda),
    z: ((1 - e2) * nu + height) * sinPhi,
  };
}

function applyWgs84ToOsgb36Transform(point: Cartesian): Cartesian {
  const tx = -446.448;
  const ty = 125.157;
  const tz = -542.06;
  const rx = -0.1502 / 3600 * DEG_TO_RAD;
  const ry = -0.2470 / 3600 * DEG_TO_RAD;
  const rz = -0.8421 / 3600 * DEG_TO_RAD;
  const s = 20.4894e-6;

  return {
    x: tx + (1 + s) * point.x - rz * point.y + ry * point.z,
    y: ty + rz * point.x + (1 + s) * point.y - rx * point.z,
    z: tz - ry * point.x + rx * point.y + (1 + s) * point.z,
  };
}

function cartesianToLatLon(point: Cartesian, ellipsoid: typeof AIRY1830): { lat: number; lon: number } {
  const e2 = 1 - (ellipsoid.b * ellipsoid.b) / (ellipsoid.a * ellipsoid.a);
  const p = Math.sqrt(point.x * point.x + point.y * point.y);
  const lon = Math.atan2(point.y, point.x);

  let lat = Math.atan2(point.z, p * (1 - e2));
  let previous: number;
  do {
    previous = lat;
    const nu = ellipsoid.a / Math.sqrt(1 - e2 * Math.sin(lat) * Math.sin(lat));
    lat = Math.atan2(point.z + e2 * nu * Math.sin(lat), p);
  } while (Math.abs(lat - previous) > 1e-12);

  return { lat: lat * RAD_TO_DEG, lon: lon * RAD_TO_DEG };
}

function wgs84ToOsgb36(lat: number, lon: number): { lat: number; lon: number } {
  const cartesian = toCartesian(lat, lon, 0, WGS84);
  return cartesianToLatLon(applyWgs84ToOsgb36Transform(cartesian), AIRY1830);
}

function osgb36LatLonToEastNorth(lat: number, lon: number): { easting: number; northing: number } {
  const deg2rad = Math.PI / 180;
  const radLat = lat * deg2rad;
  const radLon = lon * deg2rad;

  const a = 6377563.396, b = 6356256.909;              // Airy 1830 major & minor semi-axes
  const F0 = 0.9996012717;                             // NatGrid scale factor on central meridian
  const lat0 = 49 * deg2rad, lon0 = -2 * deg2rad;      // NatGrid true origin
  const N0 = -100000, E0 = 400000;                     // northing & easting of true origin, metres
  const e2 = 1 - (b * b) / (a * a);                    // eccentricity squared
  const n = (a - b) / (a + b), n2 = n * n, n3 = n * n * n;

  const cosLat = Math.cos(radLat), sinLat = Math.sin(radLat);
  const nu = a * F0 / Math.sqrt(1 - e2 * sinLat * sinLat);              // transverse radius of curvature
  const rho = a * F0 * (1 - e2) / Math.pow(1 - e2 * sinLat * sinLat, 1.5); // meridional radius of curvature
  const eta2 = nu / rho - 1;

  const Ma = (1 + n + (5 / 4) * n2 + (5 / 4) * n3) * (radLat - lat0);
  const Mb = (3 * n + 3 * n2 + (21 / 8) * n3) * Math.sin(radLat - lat0) * Math.cos(radLat + lat0);
  const Mc = ((15 / 8) * n2 + (15 / 8) * n3) * Math.sin(2 * (radLat - lat0)) * Math.cos(2 * (radLat + lat0));
  const Md = (35 / 24) * n3 * Math.sin(3 * (radLat - lat0)) * Math.cos(3 * (radLat + lat0));
  const M = b * F0 * (Ma - Mb + Mc - Md);              // meridional arc

  const cos3lat = cosLat * cosLat * cosLat;
  const cos5lat = cos3lat * cosLat * cosLat;
  const tan2lat = Math.tan(radLat) * Math.tan(radLat);
  const tan4lat = tan2lat * tan2lat;

  const I = M + N0;
  const II = (nu / 2) * sinLat * cosLat;
  const III = (nu / 24) * sinLat * cos3lat * (5 - tan2lat + 9 * eta2);
  const IIIA = (nu / 720) * sinLat * cos5lat * (61 - 58 * tan2lat + tan4lat);
  const IV = nu * cosLat;
  const V = (nu / 6) * cos3lat * (nu / rho - tan2lat);
  const VI = (nu / 120) * cos5lat * (5 - 18 * tan2lat + tan4lat + 14 * eta2 - 58 * tan2lat * eta2);

  const deltaLon = radLon - lon0;
  const N = I + II * deltaLon * deltaLon + III * Math.pow(deltaLon, 4) + IIIA * Math.pow(deltaLon, 6);
  const E = E0 + IV * deltaLon + V * Math.pow(deltaLon, 3) + VI * Math.pow(deltaLon, 5);

  return { easting: E, northing: N };
}

function gridLettersFor(easting: number, northing: number): string {
  const e100k = Math.floor(easting / 100000);
  const n100k = Math.floor(northing / 100000);

  let l1 = (19 - n100k) - ((19 - n100k) % 5) + Math.floor((e100k + 10) / 5);
  let l2 = ((19 - n100k) * 5 % 25) + (e100k % 5);

  if (l1 > 7) l1 += 1;
  if (l2 > 7) l2 += 1;

  return String.fromCharCode(l1 + 65, l2 + 65);
}

/**
 * Converts WGS84 latitude/longitude to a UK National Grid Reference.
 * Defaults to 10 figures: two letters plus 5 easting and 5 northing digits.
 */
export function toOSGridRef(lat: number, lon: number, figures: GridFigures = 10): string {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return "";

  const osgb36 = wgs84ToOsgb36(lat, lon);
  const { easting, northing } = osgb36LatLonToEastNorth(osgb36.lat, osgb36.lon);

  if (easting < 0 || easting > 700000 || northing < 0 || northing > 1300000) return "";

  const digits = figures / 2;
  const divisor = Math.pow(10, 5 - digits);
  const e = Math.floor((easting % 100000) / divisor).toString().padStart(digits, "0");
  const n = Math.floor((northing % 100000) / divisor).toString().padStart(digits, "0");

  return `${gridLettersFor(easting, northing)} ${e} ${n}`;
}
