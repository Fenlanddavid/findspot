import type { SignificantFind } from "../../db";

export function formatSignificantDate(iso: string) {
  try {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return "Unknown date";
    return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  } catch {
    return "Unknown date";
  }
}

export function formatSignificantLocation(sf: SignificantFind) {
  if (sf.osGridRef) return sf.osGridRef;
  if (sf.lat != null && sf.lon != null) return `${sf.lat.toFixed(4)}, ${sf.lon.toFixed(4)}`;
  return "Location not recorded";
}

export const PATH_LABELS: Record<SignificantFind["path"], string> = {
  stop_secure: "Stop & Secure",
  map_scatter: "Map Scatter",
  notable_find: "Notable Find",
};

export const PATH_COLORS: Record<SignificantFind["path"], string> = {
  stop_secure: "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400",
  map_scatter: "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400",
  notable_find: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400",
};

export const STATUS_COLORS: Record<SignificantFind["status"], string> = {
  in_progress: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
  awaiting_excavation: "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400",
  excavation_complete: "bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400",
  coroner_notified: "bg-purple-100 text-purple-700 dark:bg-purple-950/40 dark:text-purple-400",
  pas_recorded: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400",
};

export const JURISDICTION_LABELS: Record<SignificantFind["jurisdiction"], string> = {
  england_wales: "England / Wales",
  scotland: "Scotland",
  northern_ireland: "Northern Ireland",
  unknown: "Unknown",
};

export type StatusStep = { value: SignificantFind["status"]; label: string };

const PATH1_STEPS: StatusStep[] = [
  { value: "in_progress", label: "In progress" },
  { value: "awaiting_excavation", label: "Awaiting excavation" },
  { value: "excavation_complete", label: "Excavation complete" },
  { value: "coroner_notified", label: "PAS notified" },
  { value: "pas_recorded", label: "Treasure process" },
];

const PATH2_STEPS: StatusStep[] = [
  { value: "in_progress", label: "Recorded" },
  { value: "awaiting_excavation", label: "FLO contacted" },
  { value: "pas_recorded", label: "PAS / complete" },
];

const PATH3_STEPS: StatusStep[] = [
  { value: "in_progress", label: "Recorded" },
  { value: "awaiting_excavation", label: "FLO contacted" },
  { value: "excavation_complete", label: "Identified by FLO" },
  { value: "pas_recorded", label: "PAS recorded" },
];

export function getStepsForPath(path: SignificantFind["path"]): StatusStep[] {
  if (path === "map_scatter") return PATH2_STEPS;
  if (path === "notable_find") return PATH3_STEPS;
  return PATH1_STEPS;
}

export function getStatusLabel(path: SignificantFind["path"], status: SignificantFind["status"]) {
  const step = getStepsForPath(path).find(s => s.value === status);
  return step?.label ?? status;
}
