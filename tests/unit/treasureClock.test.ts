// ─── Treasure Clock unit tests ──────────────────────────────────────────────
// Pure logic tests for qualification, clearing, tier boundaries, and ordering.

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mock Dexie DB ──────────────────────────────────────────────────────────

type MockRow = Record<string, unknown>;

const { mockSignificantFinds, mockPermissions, mockFinds } = vi.hoisted(() => {
  function _makeTable() {
    let data: MockRow[] = [];
    return {
      _setData(r: MockRow[]) { data = r; },
      get(id: unknown) {
        return Promise.resolve(data.find((r) => r.id === id));
      },
      where(key: string) {
        return {
          equals(val: unknown) {
            return {
              toArray() {
                return Promise.resolve(data.filter((r) => r[key] === val));
              },
            };
          },
          anyOf(vals: unknown[]) {
            return {
              toArray() {
                return Promise.resolve(data.filter((r) => (vals as string[]).includes(r[key] as string)));
              },
            };
          },
        };
      },
    };
  }
  return {
    mockSignificantFinds: _makeTable(),
    mockPermissions: _makeTable(),
    mockFinds: _makeTable(),
  };
});

vi.mock("../../src/db", () => ({
  db: {
    significantFinds: mockSignificantFinds,
    permissions: mockPermissions,
    finds: mockFinds,
  },
}));

import {
  qualifiesForClock,
  clockTier,
  deriveTreasureClock,
} from "../../src/services/treasureClock";
import type { SignificantFind } from "../../src/db";
import type { Find } from "../../src/db";
import { checkTreasureAct } from "../../src/utils/treasureActCheck";

// ─── Helpers ────────────────────────────────────────────────────────────────

const PROJECT_ID = "proj-001";
const PERM_ID = "perm-001";

function makeSF(overrides: Partial<SignificantFind> = {}): SignificantFind {
  return {
    id: "sf-" + Math.random().toString(36).slice(2, 8),
    projectId: PROJECT_ID,
    permissionId: PERM_ID,
    sessionId: null,
    path: "stop_secure",
    status: "in_progress",
    jurisdiction: "england_wales",
    lat: null,
    lon: null,
    gpsAccuracyM: null,
    osGridRef: "",
    w3w: "",
    preExcavationNotes: "",
    soilObservations: "",
    groundSurfacePhotoCaptured: false,
    scatterId: null,
    scatterFindIds: [],
    linkedFindId: null,
    treasureActResult: null,
    treasureActDraft: "",
    landownerSummary: "",
    createdAt: "2026-06-20T10:00:00.000Z",
    updatedAt: "2026-06-20T10:00:00.000Z",
    ...overrides,
  } as SignificantFind;
}

function makePerm(overrides: Partial<MockRow> = {}): MockRow {
  return {
    id: PERM_ID,
    name: "Test Field",
    ...overrides,
  };
}

function makeFind(overrides: Partial<Find> = {}): Find {
  return {
    id: "find-" + Math.random().toString(36).slice(2, 8),
    projectId: PROJECT_ID,
    permissionId: PERM_ID,
    fieldId: null,
    sessionId: null,
    findCode: "F001",
    objectType: "Object",
    lat: null,
    lon: null,
    gpsAccuracyM: null,
    osGridRef: "",
    w3w: "",
    period: "Unknown",
    material: "Other",
    weightG: null,
    widthMm: null,
    heightMm: null,
    depthMm: null,
    decoration: "",
    completeness: "Complete",
    findContext: "",
    storageLocation: "",
    notes: "",
    createdAt: "2026-06-20T10:00:00.000Z",
    updatedAt: "2026-06-20T10:00:00.000Z",
    ...overrides,
  };
}

function resetAll() {
  mockSignificantFinds._setData([]);
  mockPermissions._setData([]);
  mockFinds._setData([]);
}

const NOW = new Date("2026-07-05T12:00:00.000Z");

beforeEach(() => resetAll());

// ─── qualifiesForClock ──────────────────────────────────────────────────────

describe("treasureClock — qualification", () => {
  it("path1 in_progress, no closure fields → on clock", async () => {
    const sf = makeSF({ path: "stop_secure", status: "in_progress" });
    await expect(qualifiesForClock(sf)).resolves.toBe(true);
  });

  it("path1 excavation_complete, no closure → on clock (still owed)", async () => {
    const sf = makeSF({ path: "stop_secure", status: "excavation_complete" });
    await expect(qualifiesForClock(sf)).resolves.toBe(true);
  });

  it("path1 + treasureReference → cleared", async () => {
    const sf = makeSF({ path: "stop_secure", treasureReference: "T-2026/001" });
    await expect(qualifiesForClock(sf)).resolves.toBe(false);
  });

  it("floContactDate whitespace → NOT cleared", async () => {
    const sf = makeSF({ path: "stop_secure", floContactDate: "  " });
    await expect(qualifiesForClock(sf)).resolves.toBe(true);
  });

  it("floContactDate text → cleared", async () => {
    const sf = makeSF({ path: "stop_secure", floContactDate: "Texted FLO" });
    await expect(qualifiesForClock(sf)).resolves.toBe(false);
  });

  it("path2, prehistoric base-metal scatter → on clock", async () => {
    const finds = [
      makeFind({ id: "f1", material: "Copper alloy", period: "Bronze Age" }),
      makeFind({ id: "f2", material: "Copper alloy", period: "Bronze Age" }),
      makeFind({ id: "f3", material: "Copper alloy", period: "Bronze Age" }),
    ];
    mockFinds._setData(finds);
    const sf = makeSF({ path: "map_scatter", scatterFindIds: ["f1", "f2", "f3"] });
    await expect(qualifiesForClock(sf)).resolves.toBe(true);
  });

  it("path2, all Lead/Modern → off", async () => {
    mockFinds._setData([
      makeFind({ id: "f1", material: "Lead", period: "Modern" }),
      makeFind({ id: "f2", material: "Lead", period: "Modern" }),
    ]);
    const sf = makeSF({ path: "map_scatter", scatterFindIds: ["f1", "f2"] });
    await expect(qualifiesForClock(sf)).resolves.toBe(false);
  });

  it("path2, one material Other → on clock fail-safe", async () => {
    mockFinds._setData([
      makeFind({ id: "f1", material: "Lead", period: "Modern" }),
      makeFind({ id: "f2", material: "Other", period: "Modern" }),
    ]);
    const sf = makeSF({ path: "map_scatter", scatterFindIds: ["f1", "f2"] });
    await expect(qualifiesForClock(sf)).resolves.toBe(true);
  });

  it("path3, Gold/Medieval linked find → on clock", async () => {
    mockFinds._setData([makeFind({ id: "f-gold", material: "Gold", period: "Medieval" })]);
    const sf = makeSF({ path: "notable_find", linkedFindId: "f-gold" });
    await expect(qualifiesForClock(sf)).resolves.toBe(true);
  });

  it("path3, Copper alloy/Roman linked find count 1 → off", async () => {
    mockFinds._setData([makeFind({ id: "f-roman", material: "Copper alloy", period: "Roman" })]);
    const sf = makeSF({ path: "notable_find", linkedFindId: "f-roman" });
    await expect(qualifiesForClock(sf)).resolves.toBe(false);
  });

  it("path3, auto-created defaults → off clock", async () => {
    mockFinds._setData([makeFind({ id: "f-default", material: "Other", period: "Unknown" })]);
    const sf = makeSF({ path: "notable_find", linkedFindId: "f-default" });
    await expect(qualifiesForClock(sf)).resolves.toBe(false);
  });

  it("status coroner_notified → cleared", async () => {
    const sf = makeSF({ status: "coroner_notified" });
    await expect(qualifiesForClock(sf)).resolves.toBe(false);
  });

  it("status pas_recorded → cleared", async () => {
    const sf = makeSF({ status: "pas_recorded" });
    await expect(qualifiesForClock(sf)).resolves.toBe(false);
  });

  it("treasureOutcome set → cleared", async () => {
    const sf = makeSF({ treasureOutcome: "treasure_declared" as never });
    await expect(qualifiesForClock(sf)).resolves.toBe(false);
  });

  it("scatterOutcome set → cleared", async () => {
    const sf = makeSF({ scatterOutcome: "reported" as never });
    await expect(qualifiesForClock(sf)).resolves.toBe(false);
  });

  it("notableOutcome set → cleared", async () => {
    const sf = makeSF({ notableOutcome: "reported" as never });
    await expect(qualifiesForClock(sf)).resolves.toBe(false);
  });

  it("pasRecordNumber set → cleared", async () => {
    const sf = makeSF({ pasRecordNumber: "PAS-123" });
    await expect(qualifiesForClock(sf)).resolves.toBe(false);
  });
});

describe("checkTreasureAct — current characterisation", () => {
  // This snapshot records the intentionally tightened behaviour introduced when
  // wiring checkTreasureAct into the live treasure clock, not the old dormant output.
  it("Scotland returns may_be_reportable unconditionally", () => {
    expect(checkTreasureAct({
      material: "Lead",
      period: "Modern",
      count: 1,
      jurisdiction: "scotland",
    }).result).toBe("may_be_reportable");
  });

  it("Gold/Medieval returns may_be_reportable", () => {
    expect(checkTreasureAct({
      material: "Gold",
      period: "Medieval",
      count: 1,
      jurisdiction: "england_wales",
    }).result).toBe("may_be_reportable");
  });

  it("Copper alloy/Roman singleton returns probably_not", () => {
    expect(checkTreasureAct({
      material: "Copper alloy",
      period: "Roman",
      count: 1,
      jurisdiction: "england_wales",
    }).result).toBe("probably_not");
  });
});

// ─── clockTier ──────────────────────────────────────────────────────────────

describe("treasureClock — tier boundaries", () => {
  it("day 0 → quiet", () => expect(clockTier(0, "england_wales")).toBe("quiet"));
  it("day 6 → quiet", () => expect(clockTier(6, "england_wales")).toBe("quiet"));
  it("day 7 → amber", () => expect(clockTier(7, "england_wales")).toBe("amber"));
  it("day 11 → amber", () => expect(clockTier(11, "england_wales")).toBe("amber"));
  it("day 12 → red", () => expect(clockTier(12, "england_wales")).toBe("red"));
  it("day 14 → red", () => expect(clockTier(14, "england_wales")).toBe("red"));
  it("day 15 → overdue", () => expect(clockTier(15, "england_wales")).toBe("overdue"));
  it("day 30 → overdue", () => expect(clockTier(30, "england_wales")).toBe("overdue"));
});

describe("treasureClock — jurisdiction", () => {
  it("scotland → scotland_notice at any day count", () => {
    expect(clockTier(0, "scotland")).toBe("scotland_notice");
    expect(clockTier(7, "scotland")).toBe("scotland_notice");
    expect(clockTier(15, "scotland")).toBe("scotland_notice");
  });

  it("unknown → 14-day tiers (fail-safe)", () => {
    expect(clockTier(6, "unknown")).toBe("quiet");
    expect(clockTier(7, "unknown")).toBe("amber");
    expect(clockTier(12, "unknown")).toBe("red");
    expect(clockTier(15, "unknown")).toBe("overdue");
  });

  it("northern_ireland → 14-day tiers", () => {
    expect(clockTier(7, "northern_ireland")).toBe("amber");
    expect(clockTier(15, "northern_ireland")).toBe("overdue");
  });
});

// ─── deriveTreasureClock ────────────────────────────────────────────────────

describe("treasureClock — derivation ordering", () => {
  it("two qualifying SFs sorted daysElapsed desc", async () => {
    const older = makeSF({
      id: "sf-old",
      createdAt: "2026-06-15T10:00:00.000Z",
    });
    const newer = makeSF({
      id: "sf-new",
      createdAt: "2026-06-25T10:00:00.000Z",
    });
    mockSignificantFinds._setData([newer, older]);
    mockPermissions._setData([makePerm()]);

    const items = await deriveTreasureClock(PROJECT_ID, NOW);
    expect(items).toHaveLength(2);
    expect(items[0].sfId).toBe("sf-old"); // more days elapsed → first
    expect(items[1].sfId).toBe("sf-new");
    expect(items[0].daysElapsed).toBeGreaterThan(items[1].daysElapsed);
  });

  it("returns empty for no qualifying SFs", async () => {
    mockSignificantFinds._setData([
      makeSF({ status: "pas_recorded" }),
    ]);
    const items = await deriveTreasureClock(PROJECT_ID, NOW);
    expect(items).toHaveLength(0);
  });

  it("resolves permission name", async () => {
    mockSignificantFinds._setData([makeSF()]);
    mockPermissions._setData([makePerm({ name: "North Meadow" })]);

    const items = await deriveTreasureClock(PROJECT_ID, NOW);
    expect(items[0].permissionName).toBe("North Meadow");
  });

  it("computes daysElapsed correctly", async () => {
    // createdAt is 15 days before NOW
    const sf = makeSF({
      createdAt: new Date(NOW.getTime() - 15 * 86_400_000).toISOString(),
    });
    mockSignificantFinds._setData([sf]);
    mockPermissions._setData([makePerm()]);

    const items = await deriveTreasureClock(PROJECT_ID, NOW);
    expect(items[0].daysElapsed).toBe(15);
    expect(items[0].tier).toBe("overdue");
  });

  it("path3 linked find edit flips live, with days from SF createdAt", async () => {
    const createdAt = new Date(NOW.getTime() - 9 * 86_400_000).toISOString();
    mockSignificantFinds._setData([
      makeSF({
        id: "sf-edited",
        path: "notable_find",
        linkedFindId: "find-edited",
        createdAt,
      }),
    ]);
    mockPermissions._setData([makePerm()]);

    mockFinds._setData([
      makeFind({ id: "find-edited", material: "Other", period: "Unknown" }),
    ]);
    expect(await deriveTreasureClock(PROJECT_ID, NOW)).toHaveLength(0);

    mockFinds._setData([
      makeFind({ id: "find-edited", material: "Silver", period: "Roman" }),
    ]);
    const items = await deriveTreasureClock(PROJECT_ID, NOW);
    expect(items).toHaveLength(1);
    expect(items[0].sfId).toBe("sf-edited");
    expect(items[0].daysElapsed).toBe(9);
    expect(items[0].tier).toBe("amber");
  });

  it("scotland SF has scotland_notice tier", async () => {
    const sf = makeSF({ jurisdiction: "scotland" });
    mockSignificantFinds._setData([sf]);
    mockPermissions._setData([makePerm()]);

    const items = await deriveTreasureClock(PROJECT_ID, NOW);
    expect(items[0].tier).toBe("scotland_notice");
  });
});
