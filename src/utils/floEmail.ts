import { WorkflowState } from "../types/significantFind";
import { Find } from "../db";

type FLOEntry = { name: string; email: string } | null;

function formatDate(iso?: string) {
  if (!iso) return new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  try {
    return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  } catch {
    return iso;
  }
}

function location(state: WorkflowState) {
  const parts: string[] = [];
  if (state.osGridRef) parts.push(state.osGridRef);
  if (state.w3w) parts.push(`///${state.w3w}`);
  if (!parts.length && state.lat != null) parts.push(`${state.lat.toFixed(5)}, ${state.lon?.toFixed(5)}`);
  return parts.join(" | ") || "Not recorded";
}

export function buildSecureFindEmail(
  state: WorkflowState,
  collectorName: string,
  flo: FLOEntry,
  createdAt?: string,
): { subject: string; body: string } {
  const date = formatDate(createdAt);
  const loc = location(state);
  const greeting = flo ? `Dear ${flo.name},` : "Dear Finds Liaison Officer,";

  const lines: string[] = [
    greeting,
    "",
    "I am writing to report a significant find made on your patch and would like your help with identification and recording. My full record is available to share — photographs, GPS data, and field observations.",
    "",
    "FIND DETAILS",
    `Date: ${date}`,
    `Location: ${loc}`,
    state.gpsAccuracyM != null ? `GPS accuracy: ±${state.gpsAccuracyM.toFixed(1)}m` : "",
    `Finder: ${collectorName || "[your name]"}`,
    state.findDescription ? `Type: ${state.findDescription}` : "",
    "",
  ].filter(l => l !== undefined);

  if (state.initialObservations) {
    lines.push("INITIAL OBSERVATIONS");
    lines.push(state.initialObservations);
    lines.push("");
  }

  if (state.depthCm != null || state.preExcavationNotes || state.periodEstimate) {
    lines.push("CONTEXT");
    if (state.depthCm != null) lines.push(`Depth: ${state.depthCm}cm`);
    if (state.preExcavationNotes) lines.push(`Spread/notes: ${state.preExcavationNotes}`);
    if (state.soilObservations) lines.push(`Associated finds: ${state.soilObservations}`);
    if (state.periodEstimate) lines.push(`Period estimate: ${state.periodEstimate}`);
    lines.push("");
  }

  if (state.firstPersonAccount) {
    lines.push("ACCOUNT OF DISCOVERY");
    lines.push(state.firstPersonAccount);
    lines.push("");
  }

  lines.push(
    "All pre-disturbance photographs and GPS data are saved in the FindSpot app and available on request. Please advise on next steps.",
    "",
    `Kind regards,`,
    collectorName || "[your name]",
  );

  const body = lines.filter(Boolean).join("\n");
  const subject = `Significant Find — ${state.osGridRef || "GPS recorded"} — ${date}`;

  return { subject, body };
}

export function buildScatterEmail(
  state: WorkflowState,
  scatterFinds: Find[],
  collectorName: string,
  flo: FLOEntry,
  createdAt?: string,
): { subject: string; body: string } {
  const date = formatDate(createdAt);
  const loc = location(state);
  const greeting = flo ? `Dear ${flo.name},` : "Dear Finds Liaison Officer,";

  // Rough area calc
  const located = scatterFinds.filter(f => f.lat != null);
  let areaDesc = "";
  if (located.length >= 2) {
    const lats = located.map(f => f.lat!);
    const lons = located.map(f => f.lon!);
    const span = Math.max(
      (Math.max(...lats) - Math.min(...lats)) * 111320,
      (Math.max(...lons) - Math.min(...lons)) * 111320 * Math.cos(lats[0] * Math.PI / 180),
    );
    areaDesc = span < 100 ? `${Math.round(span)} metres` : `${(span / 1000).toFixed(2)} km`;
  }

  const lines: string[] = [
    greeting,
    "",
    `I am writing to report a scatter of ${scatterFinds.length} find${scatterFinds.length !== 1 ? "s" : ""} recorded on ${date}. I would like your assistance with recording and any follow-up advice.`,
    "",
    "SCATTER DETAILS",
    `Date: ${date}`,
    `Centre point: ${loc}`,
    state.gpsAccuracyM != null ? `GPS accuracy: ±${state.gpsAccuracyM.toFixed(1)}m` : "",
    `Finds recorded: ${scatterFinds.length}`,
    areaDesc ? `Spread: ${areaDesc}` : "",
    `Finder: ${collectorName || "[your name]"}`,
    "",
    "FIND LIST",
    ...scatterFinds.map((f, i) =>
      `${i + 1}. ${f.objectType} — ${f.period}${f.depthCm ? ` — ${f.depthCm}cm` : ""}${f.osGridRef ? ` — ${f.osGridRef}` : ""}`
    ),
    "",
  ].filter(l => l !== undefined);

  if (state.firstPersonAccount) {
    lines.push("NOTES ON THE AREA");
    lines.push(state.firstPersonAccount);
    lines.push("");
  }

  lines.push(
    "GPS points and photographs for each find are saved in the FindSpot app and available to share.",
    "",
    "Kind regards,",
    collectorName || "[your name]",
  );

  const body = lines.filter(Boolean).join("\n");
  const subject = `Scatter Find Report — ${scatterFinds.length} finds — ${state.osGridRef || loc} — ${date}`;

  return { subject, body };
}

export function buildNotableFindEmail(
  state: WorkflowState,
  find: Find | undefined,
  collectorName: string,
  flo: FLOEntry,
  createdAt?: string,
): { subject: string; body: string } {
  const date = formatDate(createdAt);
  const loc = location(state);
  const greeting = flo ? `Dear ${flo.name},` : "Dear Finds Liaison Officer,";

  const lines: string[] = [
    greeting,
    "",
    "I am writing to report a notable find and would like your help with identification and recording.",
    "",
    "FIND DETAILS",
    `Date: ${date}`,
    `Location: ${loc}`,
    state.gpsAccuracyM != null ? `GPS accuracy: ±${state.gpsAccuracyM.toFixed(1)}m` : "",
    `Finder: ${collectorName || "[your name]"}`,
    find?.objectType ? `Object type: ${find.objectType}` : "",
    find?.period ? `Period: ${find.period}` : "",
    find?.material ? `Material: ${find.material}` : "",
    "",
  ].filter(l => l !== undefined);

  if (state.depthCm != null || state.orientationNotes || state.soilObservations || state.preExcavationNotes) {
    lines.push("CONTEXT");
    if (state.depthCm != null) lines.push(`Depth: ${state.depthCm}cm`);
    if (state.orientationNotes) lines.push(`Orientation: ${state.orientationNotes}`);
    if (state.soilObservations) lines.push(`Soil profile: ${state.soilObservations}`);
    if (state.preExcavationNotes) lines.push(`Associated material: ${state.preExcavationNotes}`);
    lines.push("");
  }

  if (state.firstPersonAccount) {
    lines.push("DESCRIPTION");
    lines.push(state.firstPersonAccount);
    lines.push("");
  }

  lines.push(
    "Photographs (in situ, in hand, close detail, recovery point) and GPS data are saved in FindSpot and available on request.",
    "",
    "Kind regards,",
    collectorName || "[your name]",
  );

  const body = lines.filter(Boolean).join("\n");
  const subject = `Notable Find — ${find?.objectType || "significant object"} — ${state.osGridRef || loc} — ${date}`;

  return { subject, body };
}

export function buildMailtoLink(email: string, subject: string, body: string): string {
  return `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
