// ─── Treasure Clock — statutory reporting window for significant finds ───────
// Pure Dexie reads only (no fetch, no caches) so useLiveQuery tracks changes.
// s.8 Treasure Act 1996: 14 days from the day the finder believes the find
// may be Treasure. createdAt is the on-device proxy (conservative).

import { db } from "../db";
import type { Find, SignificantFind } from "../db";
import { checkTreasureAct } from "../utils/treasureActCheck";

// ─── Types ───────────────────────────────────────────────────────────────────

export type TreasureClockTier =
  | "quiet"
  | "amber"
  | "red"
  | "overdue"
  | "scotland_notice";

export interface TreasureClockItem {
  sfId: string;
  permissionId: string;
  permissionName: string;
  daysElapsed: number;
  tier: TreasureClockTier;
  jurisdiction: SignificantFind["jurisdiction"];
}

// ─── Qualification ───────────────────────────────────────────────────────────

function hasText(value: string | null | undefined): boolean {
  return (value ?? "").trim() !== "";
}

function isOpenForClock(sf: SignificantFind): boolean {
  // ── Cleared? Any of these fields means the obligation is discharged. ──
  if (
    sf.status === "coroner_notified" ||
    sf.status === "pas_recorded"
  ) return false;
  if (hasText(sf.treasureReference)) return false;
  if (hasText(sf.floContactDate)) return false;
  if (hasText(sf.pasRecordNumber)) return false;
  if (sf.treasureOutcome) return false;
  if (sf.scatterOutcome) return false;
  if (sf.notableOutcome) return false;

  return true;
}

function isUnclassified(find: Find): boolean {
  return find.material === "Other" || find.period === "Unknown";
}

function treasureCheckSaysReportable(
  find: Find,
  sf: SignificantFind,
  count: number,
): boolean {
  return checkTreasureAct({
    material: find.material,
    period: find.period,
    count,
    jurisdiction: sf.jurisdiction,
  }).result === "may_be_reportable";
}

async function getFindsById(ids: string[]): Promise<Map<string, Find>> {
  if (ids.length === 0) return new Map();
  const rows = await db.finds.where("id").anyOf(ids).toArray();
  return new Map(rows.map((find) => [find.id, find]));
}

/** True when a SF is "on the clock" — qualifying AND not yet cleared. */
export async function qualifiesForClock(sf: SignificantFind): Promise<boolean> {
  if (!isOpenForClock(sf)) return false;

  // ── Qualifying? ────────────────────────────────────────────────────────
  // Path 1 (stop_secure): ALWAYS qualifies — the path IS the declaration.
  if (sf.path === "stop_secure") return true;

  if (sf.path === "map_scatter") {
    if (sf.scatterFindIds.length === 0) return false;
    const findsById = await getFindsById(sf.scatterFindIds);

    return sf.scatterFindIds.some((findId) => {
      const find = findsById.get(findId);
      if (!find) return true;
      if (isUnclassified(find)) return true;
      return treasureCheckSaysReportable(find, sf, sf.scatterFindIds.length);
    });
  }

  if (sf.path === "notable_find") {
    if (!sf.linkedFindId) return false;
    const find = await db.finds.get(sf.linkedFindId);
    if (!find || isUnclassified(find)) return false;
    return treasureCheckSaysReportable(find, sf, 1);
  }

  return false;
}

// ─── Tier calculation ────────────────────────────────────────────────────────

export function clockTier(
  daysElapsed: number,
  jurisdiction: SignificantFind["jurisdiction"],
): TreasureClockTier {
  // Scotland: no countdown numbers, just a notice at any age.
  if (jurisdiction === "scotland") return "scotland_notice";

  // england_wales, northern_ireland, unknown (fail-safe: assume stricter 14-day)
  if (daysElapsed >= 15) return "overdue";
  if (daysElapsed >= 12) return "red";
  if (daysElapsed >= 7) return "amber";
  return "quiet";
}

// ─── Derivation ──────────────────────────────────────────────────────────────

export async function deriveTreasureClock(
  projectId: string,
  now: Date,
): Promise<TreasureClockItem[]> {
  const allSFs = await db.significantFinds
    .where("projectId")
    .equals(projectId)
    .toArray();

  // Build a permission name lookup (only for qualifying SFs)
  const qualifying: SignificantFind[] = [];
  for (const sf of allSFs) {
    if (await qualifiesForClock(sf)) qualifying.push(sf);
  }
  if (qualifying.length === 0) return [];

  const permIds = [...new Set(qualifying.map((sf) => sf.permissionId))];
  const perms = await db.permissions.where("id").anyOf(permIds).toArray();
  const permNameMap = new Map(perms.map((p) => [p.id, p.name || "Unnamed"]));

  const items: TreasureClockItem[] = qualifying.map((sf) => {
    const daysElapsed = Math.floor(
      (now.getTime() - new Date(sf.createdAt).getTime()) / 86_400_000,
    );
    return {
      sfId: sf.id,
      permissionId: sf.permissionId,
      permissionName: permNameMap.get(sf.permissionId) ?? "Unnamed",
      daysElapsed,
      tier: clockTier(daysElapsed, sf.jurisdiction),
      jurisdiction: sf.jurisdiction,
    };
  });

  // Sorted daysElapsed desc (most urgent first), deterministic by sfId
  items.sort((a, b) => b.daysElapsed - a.daysElapsed || a.sfId.localeCompare(b.sfId));

  return items;
}
