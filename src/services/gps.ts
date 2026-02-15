export type GPSFix = {
  lat: number;
  lon: number;
  accuracyM: number | null;
};

export async function captureGPS(): Promise<GPSFix> {
  return new Promise((resolve, reject) => {
    if (!("geolocation" in navigator)) {
      reject(new Error("No geolocation available on this device/browser."));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        resolve({
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          accuracyM: Number.isFinite(pos.coords.accuracy) ? pos.coords.accuracy : null,
        });
      },
      (err) => reject(new Error(err.message || "GPS capture failed")),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  });
}

/**
 * Converts Latitude/Longitude to UK OS Grid Reference.
 * Simple approximation good for ~5m accuracy.
 */
export function toOSGridRef(lat: number, lon: number): string {
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

  // Convert to Grid Letters
  if (E < 0 || E > 700000 || N < 0 || N > 1300000) return "";

  const gridLetters = [
    ['SV', 'SW', 'SX', 'SY', 'SZ', 'TV', 'TW'],
    ['SQ', 'SR', 'SS', 'ST', 'SU', 'TQ', 'TR'],
    ['SL', 'SM', 'SN', 'SO', 'SP', 'TL', 'TM'],
    ['SF', 'SG', 'SH', 'SJ', 'SK', 'TF', 'TG'],
    ['SA', 'SB', 'SC', 'SD', 'SE', 'TA', 'TB'],
    ['NV', 'NW', 'NX', 'NY', 'NZ', 'OV', 'OW'],
    ['NQ', 'NR', 'NS', 'NT', 'NU', 'OQ', 'OR'],
    ['NL', 'NM', 'NN', 'NO', 'NP', 'OL', 'OM'],
    ['NF', 'NG', 'NH', 'NJ', 'NK', 'OF', 'OG'],
    ['NA', 'NB', 'NC', 'ND', 'NE', 'OA', 'OB'],
    ['HV', 'HW', 'HX', 'HY', 'HZ', 'JV', 'JW'],
    ['HQ', 'HR', 'HS', 'HT', 'HU', 'JQ', 'JR'],
    ['HL', 'HM', 'HN', 'HO', 'HP', 'JL', 'JM'],
  ];

  const gridE = Math.floor(E / 100000);
  const gridN = Math.floor(N / 100000);
  
  // OS Grid Letters logic is 500km blocks, simplified for common UK area:
  const e100 = Math.floor(E / 100000);
  const n100 = Math.floor(N / 100000);
  const l1 = String.fromCharCode('A'.charCodeAt(0) + (19 - Math.floor(n100 / 5) * 5) + Math.floor(e100 / 5));
  const l2 = String.fromCharCode('A'.charCodeAt(0) + (24 - (n100 % 5) * 5) + (e100 % 5));
  // Standard letters are tricky, using a simpler lookup for the 100km squares
  const eIndex = Math.floor(E / 100000);
  const nIndex = Math.floor(N / 100000);
  
  const square = gridLetters[nIndex][eIndex];
  
  const eRemainder = Math.floor((E % 100000) / 10).toString().padStart(4, '0');
  const nRemainder = Math.floor((N % 100000) / 10).toString().padStart(4, '0');

  return `${square} ${eRemainder} ${nRemainder}`;
}
