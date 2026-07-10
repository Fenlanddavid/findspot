import { Jurisdiction } from "../types/significantFind";

// Northern Ireland bounding box
const NI_LAT_MIN = 54.0;
const NI_LAT_MAX = 55.35;
const NI_LON_MIN = -8.2;
const NI_LON_MAX = -5.4;

// Scotland client-side heuristic. Border areas are deliberately left unknown
// rather than risking a confident but wrong legal jurisdiction.
const SCOTLAND_NORTH_LAT = 55.85;
const SCOTLAND_WEST_LAT = 55.0;
const SCOTLAND_FAR_WEST_LAT = 54.63;

export function detectJurisdiction(lat: number, lon: number): Jurisdiction {
  // Northern Ireland check first (overlaps Scotland latitude range)
  if (
    lat >= NI_LAT_MIN &&
    lat <= NI_LAT_MAX &&
    lon >= NI_LON_MIN &&
    lon <= NI_LON_MAX
  ) {
    return "northern_ireland";
  }

  // Scotland: reliable north-of-border areas first, then west-coast/Galloway.
  if (
    lat >= SCOTLAND_NORTH_LAT ||
    (lat >= SCOTLAND_WEST_LAT && lon <= -3.0) ||
    (lat >= SCOTLAND_FAR_WEST_LAT && lon <= -4.7)
  ) {
    return "scotland";
  }

  if (lat >= SCOTLAND_FAR_WEST_LAT && lat < SCOTLAND_NORTH_LAT && lon > -4.7 && lon < -1.2) {
    return "unknown";
  }

  // Everything else in UK bounds is England/Wales
  if (lat >= 49.8 && lat <= 60.9 && lon >= -8.7 && lon <= 2.0) {
    return "england_wales";
  }

  return "unknown";
}

// Wales bounding box — additive helper, kept separate from Jurisdiction
// to avoid touching PAS/reporting logic.
export const WALES_LAT_MIN = 51.3;
export const WALES_LAT_MAX = 53.4;
export const WALES_LON_MIN = -5.4;
export const WALES_LON_MAX = -2.6;

export function isInWales(lat: number, lon: number): boolean {
    return (
        lat >= WALES_LAT_MIN && lat <= WALES_LAT_MAX &&
        lon >= WALES_LON_MIN && lon <= WALES_LON_MAX
    );
}

export function bboxIntersectsWales(
    bbox: [number, number, number, number],
): boolean {
    const [west, south, east, north] = bbox;
    return (
        west <= WALES_LON_MAX &&
        east >= WALES_LON_MIN &&
        south <= WALES_LAT_MAX &&
        north >= WALES_LAT_MIN
    );
}

export type SMJurisdiction =
    | "england_wales"
    | "scotland"
    | "northern_ireland";

function isInUkBounds(lat: number, lon: number): boolean {
    // Exclude the near-continent corner that sits inside the broad UK bbox.
    // Kent's east coast remains inside; Calais and adjacent French coast do not.
    if (lat < 51.05 && lon > 1.5) return false;
    return lat >= 49.8 && lat <= 60.9 && lon >= -8.7 && lon <= 2.0;
}

export function bboxRequiredSMJurisdictions(
    bbox: [west: number, south: number, east: number, north: number],
): Set<SMJurisdiction> | "outside_uk" {
    const [west, south, east, north] = bbox;
    const samples: Array<[number, number]> = [
        [south, west],
        [south, east],
        [north, east],
        [north, west],
        [(south + north) / 2, (west + east) / 2],
    ];
    const required = new Set<SMJurisdiction>();

    for (const [lat, lon] of samples) {
        if (!isInUkBounds(lat, lon)) return "outside_uk";
        const jurisdiction = detectJurisdiction(lat, lon);
        if (jurisdiction === "england_wales") {
            required.add("england_wales");
        } else if (jurisdiction === "scotland") {
            required.add("scotland");
        } else if (jurisdiction === "northern_ireland") {
            required.add("northern_ireland");
        } else {
            required.add("england_wales");
            required.add("scotland");
        }
    }

    return required;
}
