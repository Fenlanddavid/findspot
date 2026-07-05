// ─── Permission Pulse derivation tests ───────────────────────────────────────
// Seeds fake data via mocked Dexie tables, then asserts fact output.

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mock Dexie DB ───────────────────────────────────────────────────────────

type MockRow = Record<string, unknown>;

// vi.hoisted runs before imports, so the mock tables exist when vi.mock fires.
const { mockSignificantFinds, mockUndugSignals, mockSessions, mockFinds } =
  vi.hoisted(() => {
    function _makeTable() {
      let data: Record<string, unknown>[] = [];
      return {
        _setData(r: Record<string, unknown>[]) { data = r; },
        where(key: string) {
          return {
            equals(val: unknown) {
              return {
                toArray() {
                  return Promise.resolve(
                    data.filter((r) => {
                      if (key.startsWith("[")) {
                        const fields = key.replace(/[\[\]]/g, "").split("+");
                        const vals = val as unknown[];
                        return fields.every((f, i) => r[f] === vals[i]);
                      }
                      return r[key] === val;
                    })
                  );
                },
                count() {
                  return this.toArray().then((a: unknown[]) => a.length);
                },
              };
            },
          };
        },
      };
    }
    return {
      mockSignificantFinds: _makeTable(),
      mockUndugSignals: _makeTable(),
      mockSessions: _makeTable(),
      mockFinds: _makeTable(),
    };
  });

vi.mock("../../src/db", () => ({
  db: {
    significantFinds: mockSignificantFinds,
    undugSignals: mockUndugSignals,
    sessions: mockSessions,
    finds: mockFinds,
  },
}));

import { derivePermissionPulse } from "../../src/services/permissionPulse";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const PERM_ID = "perm-001";

function makeSession(overrides: Partial<MockRow> = {}): MockRow {
  return {
    id: "sess-" + Math.random().toString(36).slice(2, 8),
    permissionId: PERM_ID,
    date: "2026-01-15T10:00:00.000Z",
    isFinished: true,
    cropType: "",
    isStubble: false,
    landUse: "Arable",
    createdAt: "2026-01-15T10:00:00.000Z",
    ...overrides,
  };
}

function makeFind(overrides: Partial<MockRow> = {}): MockRow {
  return {
    id: "find-" + Math.random().toString(36).slice(2, 8),
    permissionId: PERM_ID,
    sessionId: "sess-001",
    objectType: "",
    createdAt: "2026-01-15T10:00:00.000Z",
    ...overrides,
  };
}

function makeSF(overrides: Partial<MockRow> = {}): MockRow {
  return {
    id: "sf-" + Math.random().toString(36).slice(2, 8),
    permissionId: PERM_ID,
    status: "in_progress",
    createdAt: "2026-01-15T10:00:00.000Z",
    ...overrides,
  };
}

function makeSignal(overrides: Partial<MockRow> = {}): MockRow {
  return {
    id: "us-" + Math.random().toString(36).slice(2, 8),
    permissionId: PERM_ID,
    status: "open",
    createdAt: 1_700_000_000_000,
    lat: 51.5,
    lng: -1.2,
    ...overrides,
  };
}

function resetAll() {
  mockSignificantFinds._setData([]);
  mockUndugSignals._setData([]);
  mockSessions._setData([]);
  mockFinds._setData([]);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

const NOW = new Date("2026-07-05T12:00:00.000Z");

beforeEach(() => resetAll());

describe("permissionPulse — empty permission", () => {
  it("returns [] for a permission with no data", async () => {
    const facts = await derivePermissionPulse(PERM_ID, NOW);
    expect(facts).toEqual([]);
  });
});

describe("permissionPulse — ordering", () => {
  it("obligation always at index 0 even when seeded last; full tier order", async () => {
    // Seed ambient (sessions), delta, action, then obligation — obligation must come first
    mockSessions._setData([
      makeSession({ id: "s1", date: "2025-10-01T10:00:00.000Z" }),
      makeSession({ id: "s2", date: "2025-11-01T10:00:00.000Z" }),
      makeSession({ id: "s3", date: "2025-12-01T10:00:00.000Z" }),
      makeSession({ id: "s4", date: "2026-01-01T10:00:00.000Z" }),
      makeSession({ id: "s5", date: "2026-02-01T10:00:00.000Z" }),
    ]);
    mockUndugSignals._setData([makeSignal()]);
    mockSignificantFinds._setData([makeSF({ id: "sf-last", status: "coroner_notified" })]);

    const facts = await derivePermissionPulse(PERM_ID, NOW);

    expect(facts[0].severity).toBe("obligation");
    const severities = facts.map((f) => f.severity);
    const severityOrder = ["obligation", "action", "delta", "ambient"];
    let lastIdx = -1;
    for (const sev of severities) {
      const idx = severityOrder.indexOf(sev);
      expect(idx).toBeGreaterThanOrEqual(lastIdx);
      lastIdx = idx;
    }
  });
});

describe("permissionPulse — determinism", () => {
  it("two calls with same now produce deeply equal output", async () => {
    mockSessions._setData([
      makeSession({ id: "s1", date: "2026-05-01T10:00:00.000Z" }),
    ]);
    mockUndugSignals._setData([makeSignal({ id: "us-1" })]);

    const a = await derivePermissionPulse(PERM_ID, NOW);
    const b = await derivePermissionPulse(PERM_ID, NOW);
    expect(a).toEqual(b);
  });
});

describe("permissionPulse — o1 (significant finds)", () => {
  it("emits one fact per unresolved SF", async () => {
    mockSignificantFinds._setData([
      makeSF({ id: "sf-1", status: "in_progress" }),
      makeSF({ id: "sf-2", status: "coroner_notified" }),
    ]);

    const facts = await derivePermissionPulse(PERM_ID, NOW);
    const sfFacts = facts.filter((f) => f.id.startsWith("sf_unresolved"));
    expect(sfFacts).toHaveLength(2);
  });

  it("excavation_complete and pas_recorded produce nothing", async () => {
    mockSignificantFinds._setData([
      makeSF({ id: "sf-1", status: "excavation_complete" }),
      makeSF({ id: "sf-2", status: "pas_recorded" }),
    ]);

    const facts = await derivePermissionPulse(PERM_ID, NOW);
    const sfFacts = facts.filter((f) => f.id.startsWith("sf_unresolved"));
    expect(sfFacts).toHaveLength(0);
  });
});

describe("permissionPulse — a1 (open signals)", () => {
  it("count 0 produces no fact", async () => {
    const facts = await derivePermissionPulse(PERM_ID, NOW);
    expect(facts.find((f) => f.templateId === "open_signals")).toBeUndefined();
  });

  it("count 1 uses singular template", async () => {
    mockUndugSignals._setData([makeSignal({ id: "us-1" })]);
    const facts = await derivePermissionPulse(PERM_ID, NOW);
    const f = facts.find((f) => f.templateId === "open_signals");
    expect(f).toBeDefined();
    expect(f!.slots.count).toBe(1);
    expect(f!.slots.s).toBe("");
    expect(f!.slots.verb).toBe("s");
  });

  it("count 3 uses plural template", async () => {
    mockUndugSignals._setData([
      makeSignal({ id: "us-1" }),
      makeSignal({ id: "us-2" }),
      makeSignal({ id: "us-3" }),
    ]);
    const facts = await derivePermissionPulse(PERM_ID, NOW);
    const f = facts.find((f) => f.templateId === "open_signals");
    expect(f!.slots.count).toBe(3);
    expect(f!.slots.s).toBe("s");
    expect(f!.slots.verb).toBe("");
  });
});

describe("permissionPulse — d1 (last visit)", () => {
  it("gapDays 0 is omitted", async () => {
    mockSessions._setData([
      makeSession({ id: "s1", date: NOW.toISOString() }),
    ]);
    const facts = await derivePermissionPulse(PERM_ID, NOW);
    expect(facts.find((f) => f.templateId === "last_visit")).toBeUndefined();
  });

  it("43 days ago produces slot value 43", async () => {
    const date = new Date(NOW.getTime() - 43 * 86_400_000);
    mockSessions._setData([
      makeSession({ id: "s1", date: date.toISOString() }),
    ]);
    const facts = await derivePermissionPulse(PERM_ID, NOW);
    const f = facts.find((f) => f.templateId === "last_visit");
    expect(f).toBeDefined();
    expect(f!.slots.gapDays).toBe(43);
  });
});

describe("permissionPulse — d2 (crop change)", () => {
  it("both crops recorded + changed produces fact", async () => {
    mockSessions._setData([
      makeSession({ id: "s2", date: "2026-06-01T10:00:00.000Z", cropType: "Barley" }),
      makeSession({ id: "s1", date: "2026-03-01T10:00:00.000Z", cropType: "Wheat" }),
    ]);
    const facts = await derivePermissionPulse(PERM_ID, NOW);
    const f = facts.find((f) => f.templateId === "crop_change_crop");
    expect(f).toBeDefined();
    expect(f!.slots.crop).toBe("Barley");
    expect(f!.slots.prevCrop).toBe("Wheat");
  });

  it("either empty produces no fact", async () => {
    mockSessions._setData([
      makeSession({ id: "s2", date: "2026-06-01T10:00:00.000Z", cropType: "Barley" }),
      makeSession({ id: "s1", date: "2026-03-01T10:00:00.000Z", cropType: "" }),
    ]);
    const facts = await derivePermissionPulse(PERM_ID, NOW);
    expect(facts.find((f) => f.templateId === "crop_change_crop")).toBeUndefined();
    expect(facts.find((f) => f.templateId === "crop_change_stubble")).toBeUndefined();
  });

  it("case/whitespace-only difference is omitted", async () => {
    mockSessions._setData([
      makeSession({ id: "s2", date: "2026-06-01T10:00:00.000Z", cropType: " Wheat " }),
      makeSession({ id: "s1", date: "2026-03-01T10:00:00.000Z", cropType: "wheat" }),
    ]);
    const facts = await derivePermissionPulse(PERM_ID, NOW);
    expect(facts.find((f) => f.templateId === "crop_change_crop")).toBeUndefined();
  });

  it("stubble flip emits stubble template", async () => {
    mockSessions._setData([
      makeSession({ id: "s2", date: "2026-06-01T10:00:00.000Z", cropType: "Wheat", isStubble: true }),
      makeSession({ id: "s1", date: "2026-03-01T10:00:00.000Z", cropType: "Wheat", isStubble: false }),
    ]);
    const facts = await derivePermissionPulse(PERM_ID, NOW);
    const f = facts.find((f) => f.templateId === "crop_change_stubble");
    expect(f).toBeDefined();
    expect(f!.slots.prevCrop).toBe("Wheat");
  });
});

describe("permissionPulse — d3 (last visit finds)", () => {
  it("finds on last session only; older session finds ignored", async () => {
    const s1 = makeSession({ id: "sess-old", date: "2026-03-01T10:00:00.000Z" });
    const s2 = makeSession({ id: "sess-last", date: "2026-06-01T10:00:00.000Z" });
    mockSessions._setData([s1, s2]);
    mockFinds._setData([
      makeFind({ id: "f-old", sessionId: "sess-old", objectType: "Old Coin" }),
      makeFind({ id: "f-new1", sessionId: "sess-last", objectType: "Button" }),
      makeFind({ id: "f-new2", sessionId: "sess-last", objectType: "" }),
    ]);

    const facts = await derivePermissionPulse(PERM_ID, NOW);
    const f = facts.find((f) => f.templateId === "last_visit_finds");
    expect(f).toBeDefined();
    expect(f!.slots.count).toBe(2);
  });

  it("name slot omitted when objectType is empty", async () => {
    mockSessions._setData([
      makeSession({ id: "sess-1", date: "2026-06-01T10:00:00.000Z" }),
    ]);
    mockFinds._setData([
      makeFind({ id: "f-1", sessionId: "sess-1", objectType: "" }),
    ]);

    const facts = await derivePermissionPulse(PERM_ID, NOW);
    const f = facts.find((f) => f.templateId === "last_visit_finds");
    expect(f).toBeDefined();
    expect(f!.slots.nameClause).toBe("");
  });
});

describe("permissionPulse — m1 (seasonal pattern)", () => {
  it("5 sessions Oct-Jan, now=July → fact emitted", async () => {
    mockSessions._setData([
      makeSession({ id: "s1", date: "2025-10-15T10:00:00.000Z" }),
      makeSession({ id: "s2", date: "2025-11-15T10:00:00.000Z" }),
      makeSession({ id: "s3", date: "2025-12-15T10:00:00.000Z" }),
      makeSession({ id: "s4", date: "2026-01-15T10:00:00.000Z" }),
      makeSession({ id: "s5", date: "2025-10-20T10:00:00.000Z" }),
    ]);

    const facts = await derivePermissionPulse(PERM_ID, NOW); // July
    const f = facts.find((f) => f.templateId === "seasonal_pattern");
    expect(f).toBeDefined();
  });

  it("now=November (inside window) → omitted", async () => {
    mockSessions._setData([
      makeSession({ id: "s1", date: "2025-10-15T10:00:00.000Z" }),
      makeSession({ id: "s2", date: "2025-11-15T10:00:00.000Z" }),
      makeSession({ id: "s3", date: "2025-12-15T10:00:00.000Z" }),
      makeSession({ id: "s4", date: "2026-01-15T10:00:00.000Z" }),
      makeSession({ id: "s5", date: "2025-10-20T10:00:00.000Z" }),
    ]);

    const novNow = new Date("2026-11-05T12:00:00.000Z");
    const facts = await derivePermissionPulse(PERM_ID, novNow);
    expect(facts.find((f) => f.templateId === "seasonal_pattern")).toBeUndefined();
  });

  it("3 sessions → omitted (below floor)", async () => {
    mockSessions._setData([
      makeSession({ id: "s1", date: "2025-10-15T10:00:00.000Z" }),
      makeSession({ id: "s2", date: "2025-11-15T10:00:00.000Z" }),
      makeSession({ id: "s3", date: "2025-12-15T10:00:00.000Z" }),
    ]);

    const facts = await derivePermissionPulse(PERM_ID, NOW);
    expect(facts.find((f) => f.templateId === "seasonal_pattern")).toBeUndefined();
  });

  it("Dec-Jan wrap window works", async () => {
    mockSessions._setData([
      makeSession({ id: "s1", date: "2025-11-15T10:00:00.000Z" }),
      makeSession({ id: "s2", date: "2025-12-15T10:00:00.000Z" }),
      makeSession({ id: "s3", date: "2026-01-15T10:00:00.000Z" }),
      makeSession({ id: "s4", date: "2026-02-15T10:00:00.000Z" }),
    ]);

    const facts = await derivePermissionPulse(PERM_ID, NOW); // July — outside Nov-Feb
    const f = facts.find((f) => f.templateId === "seasonal_pattern");
    expect(f).toBeDefined();
  });
});
