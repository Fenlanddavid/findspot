// ─── Permission Pulse — live-derived fact card for a permission ──────────────
// Pure Dexie reads only (no fetch, no caches) so useLiveQuery tracks changes.

import { db } from "../db";
import { qualifiesForClock } from "./treasureClock";

// ─── Types ───────────────────────────────────────────────────────────────────

export type PulseSeverity = "obligation" | "action" | "delta" | "ambient";

const SEVERITY_ORDER: PulseSeverity[] = [
  "obligation",
  "action",
  "delta",
  "ambient",
];

export type PulseTemplateId =
  | "sf_report_clock"
  | "sf_report_scotland"
  | "sf_coroner_notified"
  | "sf_awaiting_excavation"
  | "sf_in_progress"
  | "open_signals"
  | "last_visit"
  | "crop_change_stubble"
  | "crop_change_crop"
  | "last_visit_finds"
  | "seasonal_pattern";

export interface PulseFact {
  id: string;
  permissionId: string;
  severity: PulseSeverity;
  templateId: PulseTemplateId;
  slots: Record<string, string | number>;
  link?:
    | { kind: "scroll"; anchorId: string }
    | { kind: "route"; to: string }
    | { kind: "sf-resume"; sfId: string };
}

// ─── Template strings ────────────────────────────────────────────────────────

export const PULSE_TEMPLATES: Record<PulseTemplateId, string> = {
  sf_report_clock:
    "Recorded {days} day{s} ago \u2014 Treasure finds must be reported within 14 days of realising they may be Treasure.",
  sf_report_scotland:
    "Report to the Treasure Trove Unit \u2014 significant finds in Scotland must be reported.",
  sf_coroner_notified:
    "A reported find here is awaiting coroner process.",
  sf_awaiting_excavation:
    "A significant find location awaits excavation.",
  sf_in_progress:
    "A significant find record here is incomplete.",
  open_signals:
    "{count} un-dug signal{s} await{verb} investigation.",
  last_visit:
    "Last detected here {gapDays} days ago.",
  crop_change_stubble:
    "Now in stubble — was {prevCrop} on your last visit.",
  crop_change_crop:
    "Crop recorded as {crop}, previously {prevCrop}.",
  last_visit_finds:
    "Your last session produced {count} find{s}{nameClause}.",
  seasonal_pattern:
    "Your visits here have historically fallen between {monthA} and {monthB}.",
};

// Template ordering within each tier (fixed, deterministic)
const TEMPLATE_ORDER: PulseTemplateId[] = [
  // obligation
  "sf_report_clock",
  "sf_report_scotland",
  "sf_coroner_notified",
  "sf_awaiting_excavation",
  "sf_in_progress",
  // action
  "open_signals",
  // delta
  "last_visit",
  "crop_change_stubble",
  "crop_change_crop",
  "last_visit_finds",
  // ambient
  "seasonal_pattern",
];

// ─── Derivation ──────────────────────────────────────────────────────────────

export async function derivePermissionPulse(
  permissionId: string,
  now: Date
): Promise<PulseFact[]> {
  const facts: PulseFact[] = [];

  // ── o1: unresolved significant finds ───────────────────────────────────
  const allSFs = await db.significantFinds
    .where("permissionId")
    .equals(permissionId)
    .toArray();

  const unresolvedStatuses = [
    "in_progress",
    "awaiting_excavation",
    "coroner_notified",
  ] as const;

  const templateForSFStatus: Record<string, PulseTemplateId> = {
    coroner_notified: "sf_coroner_notified",
    awaiting_excavation: "sf_awaiting_excavation",
    in_progress: "sf_in_progress",
  };

  for (const sf of allSFs) {
    // Treasure clock takes priority: emit sf_report_clock/scotland INSTEAD
    // of the generic status fact for qualifying SFs (avoid double-fact).
    if (await qualifiesForClock(sf)) {
      const isScotland = sf.jurisdiction === "scotland";
      const daysElapsed = Math.floor(
        (now.getTime() - new Date(sf.createdAt).getTime()) / 86_400_000,
      );
      facts.push({
        id: `sf_report_clock:${sf.id}`,
        permissionId,
        severity: "obligation",
        templateId: isScotland ? "sf_report_scotland" : "sf_report_clock",
        slots: isScotland
          ? {}
          : { days: daysElapsed, s: daysElapsed === 1 ? "" : "s" },
        link: { kind: "route", to: `/finds-box?tab=significant&sf=${sf.id}` },
      });
    } else if (
      unresolvedStatuses.includes(
        sf.status as (typeof unresolvedStatuses)[number]
      )
    ) {
      facts.push({
        id: `sf_unresolved:${sf.id}`,
        permissionId,
        severity: "obligation",
        templateId: templateForSFStatus[sf.status],
        slots: {},
        link: { kind: "sf-resume", sfId: sf.id },
      });
    }
  }

  // ── a1: open signals ───────────────────────────────────────────────────
  const openSignalCount = await db.undugSignals
    .where("[permissionId+status]")
    .equals([permissionId, "open"])
    .count();

  if (openSignalCount > 0) {
    facts.push({
      id: "open_signals",
      permissionId,
      severity: "action",
      templateId: "open_signals",
      slots: {
        count: openSignalCount,
        s: openSignalCount === 1 ? "" : "s",
        verb: openSignalCount === 1 ? "s" : "",
      },
      link: { kind: "scroll", anchorId: "undug-signal-section" },
    });
  }

  // ── Sessions (shared by d1, d2, d3, m1) ────────────────────────────────
  const sessions = await db.sessions
    .where("permissionId")
    .equals(permissionId)
    .toArray();

  // Sort newest first; prefer finished sessions
  sessions.sort((a, b) => {
    const da = new Date(a.date).getTime();
    const db_ = new Date(b.date).getTime();
    return db_ - da;
  });

  const lastSession = sessions.find((s) => s.isFinished) || sessions[0];

  // ── d1: last visit ─────────────────────────────────────────────────────
  if (lastSession) {
    const gapDays = Math.floor(
      (now.getTime() - new Date(lastSession.date).getTime()) / 86_400_000
    );
    if (gapDays > 0) {
      facts.push({
        id: "last_visit",
        permissionId,
        severity: "delta",
        templateId: "last_visit",
        slots: { gapDays },
        link: { kind: "route", to: `/session/${lastSession.id}` },
      });
    }
  }

  // ── d2: crop change ────────────────────────────────────────────────────
  if (sessions.length >= 2) {
    const recent = sessions[0];
    const prev = sessions[1];
    const recentCrop = (recent.cropType || "").trim();
    const prevCrop = (prev.cropType || "").trim();

    if (recentCrop !== "" && prevCrop !== "") {
      // Check for stubble flip
      if (
        recent.isStubble &&
        !prev.isStubble &&
        recentCrop.toLowerCase() === prevCrop.toLowerCase()
      ) {
        // Stubble flip on same crop — only emit stubble template
        facts.push({
          id: "crop_change_stubble",
          permissionId,
          severity: "delta",
          templateId: "crop_change_stubble",
          slots: { prevCrop },
        });
      } else if (recentCrop.toLowerCase() !== prevCrop.toLowerCase()) {
        // Different crop (or stubble flip with crop change)
        if (recent.isStubble && !prev.isStubble) {
          facts.push({
            id: "crop_change_stubble",
            permissionId,
            severity: "delta",
            templateId: "crop_change_stubble",
            slots: { prevCrop },
          });
        } else {
          facts.push({
            id: "crop_change_crop",
            permissionId,
            severity: "delta",
            templateId: "crop_change_crop",
            slots: { crop: recentCrop, prevCrop },
          });
        }
      }
      // case-insensitive same + no stubble flip → omit
    }
  }

  // ── d3: last visit finds ───────────────────────────────────────────────
  if (lastSession) {
    const sessionFinds = await db.finds
      .where("sessionId")
      .equals(lastSession.id)
      .toArray();

    if (sessionFinds.length > 0) {
      // Sort newest first to pick name
      sessionFinds.sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
      const newest = sessionFinds[0];
      const name = (newest.objectType || "").trim();
      const nameClause =
        name !== "" ? `, including "${name}"` : "";
      facts.push({
        id: "last_visit_finds",
        permissionId,
        severity: "delta",
        templateId: "last_visit_finds",
        slots: {
          count: sessionFinds.length,
          s: sessionFinds.length === 1 ? "" : "s",
          nameClause,
        },
      });
    }
  }

  // ── m1: seasonal pattern ───────────────────────────────────────────────
  if (sessions.length >= 4) {
    const months = sessions.map((s) => new Date(s.date).getMonth()); // 0-11
    const nowMonth = now.getMonth();

    // Slide 12 windows of 4 consecutive months, pick max coverage
    let bestWindow: [number, number] | null = null;
    let bestCount = 0;

    for (let start = 0; start < 12; start++) {
      const windowMonths = new Set<number>();
      for (let i = 0; i < 4; i++) windowMonths.add((start + i) % 12);
      const count = months.filter((m) => windowMonths.has(m)).length;
      if (count > bestCount) {
        bestCount = count;
        bestWindow = [start, (start + 3) % 12];
      }
    }

    if (bestWindow && bestCount / months.length >= 0.7) {
      const [startMonth, endMonth] = bestWindow;
      // Only emit when now is OUTSIDE the window
      const windowMonths = new Set<number>();
      for (let i = 0; i < 4; i++)
        windowMonths.add((startMonth + i) % 12);
      if (!windowMonths.has(nowMonth)) {
        const monthName = (m: number) =>
          new Date(2000, m, 1).toLocaleString("en-GB", { month: "long" });
        facts.push({
          id: "seasonal_pattern",
          permissionId,
          severity: "ambient",
          templateId: "seasonal_pattern",
          slots: {
            monthA: monthName(startMonth),
            monthB: monthName(endMonth),
          },
        });
      }
    }
  }

  // ── Sort: severity tier → template order → newest first ────────────────
  facts.sort((a, b) => {
    const sevA = SEVERITY_ORDER.indexOf(a.severity);
    const sevB = SEVERITY_ORDER.indexOf(b.severity);
    if (sevA !== sevB) return sevA - sevB;
    const tplA = TEMPLATE_ORDER.indexOf(a.templateId);
    const tplB = TEMPLATE_ORDER.indexOf(b.templateId);
    return tplA - tplB;
  });

  return facts;
}
