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
