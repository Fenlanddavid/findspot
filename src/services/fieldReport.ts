import { Find, Track } from "../db";

function isCoinFind(find: Find): boolean {
  const obj = (find.objectType || "").toLowerCase();
  return (
    obj.includes("coin") ||
    obj.includes("hammered") ||
    !!(find.coinType && find.coinType.trim()) ||
    !!(find.coinDenomination && find.coinDenomination.trim())
  );
}

export function toFarmerLabel(find: Find): string {
  const period = find.period || "";
  const mat = (find.material && find.material !== "Other") ? find.material.toLowerCase() : "";
  const obj = (find.objectType || "").trim();

  if (isCoinFind(find)) {
    // e.g. "Roman silver coin (Denarius)", "Iron Age gold coin (Stater)"
    const parts = [period, mat, "coin"].filter(Boolean).join(" ");
    const denom = find.coinDenomination?.trim();
    return denom ? `${parts} (${denom})` : parts || "Coin";
  }

  // Non-coin: "Anglo-Saxon silver buckle", "Bronze Age copper alloy axe head"
  if (period || obj) {
    return [period, mat, obj].filter(Boolean).join(" ") || "Historic find";
  }

  // No period, no object — fall back to material
  if (mat === "gold") return "Gold find";
  if (mat === "silver") return "Silver find";
  if (mat === "pottery") return "Pottery";
  if (mat === "flint" || mat === "stone") return "Worked flint / stone";

  return "Historic find";
}

export function toFarmerDetail(find: Find): string | null {
  const parts: string[] = [];

  if (isCoinFind(find)) {
    // Label already shows: period + material + "coin" + denomination
    // Detail: coin type (e.g. "Hammered silver"), ruler, date range, decoration
    if (find.coinType) parts.push(find.coinType);
    if (find.ruler) parts.push(find.ruler);
    if (find.dateRange) parts.push(find.dateRange);
    if (find.decoration) parts.push(find.decoration);
  } else {
    // Label already shows: period + material + objectType
    // Detail: ruler, date range, decoration
    if (find.ruler) parts.push(find.ruler);
    if (find.dateRange) parts.push(find.dateRange);
    if (find.decoration) parts.push(find.decoration);
  }

  return parts.length > 0 ? parts.join(" · ") : null;
}

export function summariseFinds(finds: Find[]) {
  const labels: Record<string, number> = {};
  let coins = 0;
  let total = 0;

  for (const f of finds) {
    if (f.isPending) continue;
    total++;
    const label = toFarmerLabel(f);
    labels[label] = (labels[label] || 0) + 1;
    if (label.toLowerCase().includes("coin")) coins++;
  }

  const groups = Object.entries(labels)
    .sort((a, b) => b[1] - a[1])
    .map(([label, count]) => ({ label, count }));

  return { total, coins, groups };
}

export function formatDuration(
  startTime?: string,
  endTime?: string,
  tracks?: Track[]
): string | null {
  if (startTime && endTime) {
    const ms = new Date(endTime).getTime() - new Date(startTime).getTime();
    if (ms > 0) {
      const mins = Math.floor(ms / 60000);
      const hrs = Math.floor(mins / 60);
      if (hrs > 0) return `${hrs} hour${hrs !== 1 ? "s" : ""} ${mins % 60} minutes`;
      return `${mins} minutes`;
    }
  }

  if (tracks && tracks.length > 0) {
    const allPoints = tracks
      .flatMap(t => t.points || [])
      .filter(p => typeof p.timestamp === "number")
      .sort((a, b) => a.timestamp - b.timestamp);
    if (allPoints.length > 1) {
      const ms =
        allPoints[allPoints.length - 1].timestamp - allPoints[0].timestamp;
      const mins = Math.floor(ms / 60000);
      const hrs = Math.floor(mins / 60);
      if (hrs > 0) return `${hrs} hour${hrs !== 1 ? "s" : ""} ${mins % 60} minutes`;
      return `${mins} minutes`;
    }
  }

  return null;
}

export const DEFAULT_KEY_NOTES = [
  "All gates left as found",
  "All holes backfilled",
  "Ground conditions were good",
  "No damage caused to land or crops",
];
