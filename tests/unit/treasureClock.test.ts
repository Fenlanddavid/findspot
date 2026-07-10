// ─── Treasure Clock unit tests ──────────────────────────────────────────────
// Pure logic tests for qualification, clearing, tier boundaries, and ordering.

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mock Dexie DB ──────────────────────────────────────────────────────────

type MockRow = Record<string, unknown>;

const { mockSignificantFinds, mockPermissions } = vi.hoisted(() => {
  function _makeTable() {
    let data: MockRow[] = [];
    return {
      _setData(r: MockRow[]) { data = r; },
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
  };
});

vi.mock("../../src/db", () => ({
  db: {
    significantFinds: mockSignificantFinds,
    permissions: mockPermissions,
  },
}));

import {
  qualifiesForClock,
  clockTier,
  deriveTreasureClock,
} from "../../src/services/treasureClock";
import type { SignificantFind } from "../../src/db";

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

function resetAll() {
  mockSignificantFinds._setData([]);
  mockPermissions._setData([]);
}

const NOW = new Date("2026-07-05T12:00:00.000Z");

beforeEach(() => resetAll());

// ─── qualifiesForClock ──────────────────────────────────────────────────────

describe("treasureClock — qualification", () => {
  it("path1 in_progress, no closure fields → on clock", () => {
    const sf = makeSF({ path: "stop_secure", status: "in_progress" });
    expect(qualifiesForClock(sf)).toBe(true);
  });

  it("path1 excavation_complete, no closure → on clock (still owed)", () => {
    const sf = makeSF({ path: "stop_secure", status: "excavation_complete" });
    expect(qualifiesForClock(sf)).toBe(true);
  });

  it("path1 + treasureReference → cleared", () => {
    const sf = makeSF({ path: "stop_secure", treasureReference: "T-2026/001" });
    expect(qualifiesForClock(sf)).toBe(false);
  });

  it("path3 may_be_reportable, no floContactDate → on clock", () => {
    const sf = makeSF({
      path: "notable_find",
      treasureActResult: "may_be_reportable",
    });
    expect(qualifiesForClock(sf)).toBe(true);
  });

  it("path3 may_be_reportable + floContactDate → cleared", () => {
    const sf = makeSF({
      path: "notable_find",
      treasureActResult: "may_be_reportable",
      floContactDate: "2026-06-25",
    });
    expect(qualifiesForClock(sf)).toBe(false);
  });

  it("path3 treasureActResult null → NOT on clock", () => {
    const sf = makeSF({ path: "notable_find", treasureActResult: null });
    expect(qualifiesForClock(sf)).toBe(false);
  });

  it("path2 probably_not → NOT on clock", () => {
    const sf = makeSF({
      path: "map_scatter",
      treasureActResult: "probably_not",
    });
    expect(qualifiesForClock(sf)).toBe(false);
  });

  it("status coroner_notified → cleared", () => {
    const sf = makeSF({ status: "coroner_notified" });
    expect(qualifiesForClock(sf)).toBe(false);
  });

  it("status pas_recorded → cleared", () => {
    const sf = makeSF({ status: "pas_recorded" });
    expect(qualifiesForClock(sf)).toBe(false);
  });

  it("treasureOutcome set → cleared", () => {
    const sf = makeSF({ treasureOutcome: "treasure_declared" as never });
    expect(qualifiesForClock(sf)).toBe(false);
  });

  it("scatterOutcome set → cleared", () => {
    const sf = makeSF({ scatterOutcome: "reported" as never });
    expect(qualifiesForClock(sf)).toBe(false);
  });

  it("notableOutcome set → cleared", () => {
    const sf = makeSF({ notableOutcome: "reported" as never });
    expect(qualifiesForClock(sf)).toBe(false);
  });

  it("pasRecordNumber set → cleared", () => {
    const sf = makeSF({ pasRecordNumber: "PAS-123" });
    expect(qualifiesForClock(sf)).toBe(false);
  });

  it("path2 may_be_reportable → on clock", () => {
    const sf = makeSF({
      path: "map_scatter",
      treasureActResult: "may_be_reportable",
    });
    expect(qualifiesForClock(sf)).toBe(true);
  });

  it("path3 unknown → NOT on clock", () => {
    const sf = makeSF({ path: "notable_find", treasureActResult: "unknown" });
    expect(qualifiesForClock(sf)).toBe(false);
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

  it("scotland SF has scotland_notice tier", async () => {
    const sf = makeSF({ jurisdiction: "scotland" });
    mockSignificantFinds._setData([sf]);
    mockPermissions._setData([makePerm()]);

    const items = await deriveTreasureClock(PROJECT_ID, NOW);
    expect(items[0].tier).toBe("scotland_notice");
  });
});
