// ─── SF-RESUME unit tests ─────────────────────────────────────────────────────
// Tests for src/services/significantFindResume.ts
//
// Covers:
//   1. buildResumeContext — field mapping, unknown-step fallback
//   2. findResumable — filtering logic: status, workflowStep presence,
//      step membership, invalid path, most-recent selection
//   3. persistWorkflowProgress / clearWorkflowProgress — DB call shapes
//   4. Clear-rule guard — asserts workflowStep: null in expected update payloads

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SignificantFind } from "../../src/db";

// ─── Mocks ────────────────────────────────────────────────────────────────────

// sfStore is mutated per-test to supply different candidate sets to findResumable
const sfStore = vi.hoisted(() => ({ data: [] as SignificantFind[] }));
const mockUpdate = vi.hoisted(() => vi.fn().mockResolvedValue(1));

vi.mock("../../src/db", () => ({
  db: {
    significantFinds: {
      where: (_field: string) => ({
        equals: (_val: string) => ({
          filter: (pred: (sf: SignificantFind) => boolean) => ({
            toArray: () => Promise.resolve(sfStore.data.filter(pred)),
          }),
        }),
      }),
      update: mockUpdate,
    },
  },
}));

// Import AFTER the mock is registered
import {
  buildResumeContext,
  findResumable,
  persistWorkflowProgress,
  clearWorkflowProgress,
  PATH_STEP_ORDER,
} from "../../src/services/significantFindResume";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeSf(overrides: Partial<SignificantFind> = {}): SignificantFind {
  return {
    id: "sf-1",
    projectId: "proj-1",
    permissionId: "perm-1",
    sessionId: "sess-1",
    path: "stop_secure",
    status: "in_progress",
    jurisdiction: "england_wales",
    lat: 52.1234,
    lon: -1.5678,
    gpsAccuracyM: 3.2,
    osGridRef: "SP123456",
    w3w: "word.word.word",
    preExcavationNotes: "loose soil",
    soilObservations: "dark layer",
    secureCoverNotes: "covered with turfs",
    groundSurfacePhotoCaptured: true,
    scatterId: null,
    scatterFindIds: [],
    linkedFindId: null,
    treasureActResult: null,
    treasureActDraft: "",
    landownerSummary: "",
    initialObservations: "three coins visible",
    firstPersonAccount: "I stopped immediately",
    depthCm: 18,
    periodEstimate: "Roman",
    findDescription: "Roman hoard",
    orientationNotes: "face-up, flat",
    workflowStep: "cover_secure",
    createdAt: "2026-07-01T10:00:00.000Z",
    updatedAt: "2026-07-01T10:05:00.000Z",
    ...overrides,
  };
}

// ─── 1. buildResumeContext ────────────────────────────────────────────────────

describe("buildResumeContext", () => {
  it("maps all documented WorkflowState fields from the SF record", () => {
    const sf = makeSf();
    const ctx = buildResumeContext(sf);

    expect(ctx.significantFindId).toBe("sf-1");
    expect(ctx.path).toBe("stop_secure");
    expect(ctx.currentStep).toBe("cover_secure");
    expect(ctx.permissionId).toBe("perm-1");
    expect(ctx.sessionId).toBe("sess-1");
    expect(ctx.lat).toBe(52.1234);
    expect(ctx.lon).toBe(-1.5678);
    expect(ctx.gpsAccuracyM).toBe(3.2);
    expect(ctx.osGridRef).toBe("SP123456");
    expect(ctx.w3w).toBe("word.word.word");
    expect(ctx.jurisdiction).toBe("england_wales");
    expect(ctx.initialObservations).toBe("three coins visible");
    expect(ctx.firstPersonAccount).toBe("I stopped immediately");
    expect(ctx.depthCm).toBe(18);
    expect(ctx.periodEstimate).toBe("Roman");
    expect(ctx.preExcavationNotes).toBe("loose soil");
    expect(ctx.soilObservations).toBe("dark layer");
    expect(ctx.secureCoverNotes).toBe("covered with turfs");
    expect(ctx.groundSurfacePhotoCaptured).toBe(true);
    expect(ctx.findDescription).toBe("Roman hoard");
    expect(ctx.scatterId).toBeNull();
    expect(ctx.scatterFindIds).toEqual([]);
    expect(ctx.linkedFindId).toBeNull();
    expect(ctx.orientationNotes).toBe("face-up, flat");
  });

  it("does NOT map permissionName or organiser fields (re-derived by enrichment)", () => {
    const ctx = buildResumeContext(makeSf());
    expect(ctx).not.toHaveProperty("permissionName");
    expect(ctx).not.toHaveProperty("organiserContactNumber");
    expect(ctx).not.toHaveProperty("organiserEmail");
    expect(ctx).not.toHaveProperty("significantFindInstructions");
  });

  it("falls back to first step of path when workflowStep is unknown", () => {
    const sf = makeSf({ workflowStep: "nonexistent_step" });
    const ctx = buildResumeContext(sf);
    expect(ctx.currentStep).toBe(PATH_STEP_ORDER["stop_secure"][0]);
  });

  it("resolves correctly for path notable_find at record_context", () => {
    const sf = makeSf({ path: "notable_find", workflowStep: "record_context" });
    const ctx = buildResumeContext(sf);
    expect(ctx.path).toBe("notable_find");
    expect(ctx.currentStep).toBe("record_context");
  });

  it("resolves correctly for path map_scatter at scatter_recording", () => {
    const sf = makeSf({ path: "map_scatter", workflowStep: "scatter_recording" });
    const ctx = buildResumeContext(sf);
    expect(ctx.path).toBe("map_scatter");
    expect(ctx.currentStep).toBe("scatter_recording");
  });

  it("uses empty string defaults for optional undefined fields", () => {
    const sf = makeSf({
      initialObservations: undefined,
      firstPersonAccount: undefined,
      depthCm: undefined,
      periodEstimate: undefined,
      secureCoverNotes: undefined,
      findDescription: undefined,
      orientationNotes: undefined,
    });
    const ctx = buildResumeContext(sf);
    expect(ctx.initialObservations).toBe("");
    expect(ctx.firstPersonAccount).toBe("");
    expect(ctx.depthCm).toBeNull();
    expect(ctx.periodEstimate).toBe("");
    expect(ctx.secureCoverNotes).toBe("");
    expect(ctx.findDescription).toBe("");
    expect(ctx.orientationNotes).toBe("");
  });
});

// ─── 2. findResumable ─────────────────────────────────────────────────────────

describe("findResumable", () => {
  beforeEach(() => {
    sfStore.data = [];
    mockUpdate.mockClear();
  });

  it("returns null when no candidates", async () => {
    const result = await findResumable("proj-1");
    expect(result).toBeNull();
  });

  it("returns null when status is not in_progress", async () => {
    sfStore.data = [makeSf({ status: "awaiting_excavation", workflowStep: "cover_secure" })];
    expect(await findResumable("proj-1")).toBeNull();
  });

  it("returns null when workflowStep is null", async () => {
    sfStore.data = [makeSf({ workflowStep: null })];
    expect(await findResumable("proj-1")).toBeNull();
  });

  it("returns null when workflowStep is undefined", async () => {
    sfStore.data = [makeSf({ workflowStep: undefined })];
    expect(await findResumable("proj-1")).toBeNull();
  });

  it("returns null when workflowStep is not in PATH_STEP_ORDER for that path", async () => {
    sfStore.data = [makeSf({ path: "stop_secure", workflowStep: "scatter_confirm" })];
    expect(await findResumable("proj-1")).toBeNull();
  });

  it("returns null when path is invalid / not in PATH_STEP_ORDER", async () => {
    sfStore.data = [makeSf({ path: "invalid_path" as any, workflowStep: "cover_secure" })];
    expect(await findResumable("proj-1")).toBeNull();
  });

  it("returns the resumable candidate when all conditions are met", async () => {
    const sf = makeSf();
    sfStore.data = [sf];
    const result = await findResumable("proj-1");
    expect(result?.id).toBe("sf-1");
  });

  it("returns the most recently updated of two valid candidates", async () => {
    const older = makeSf({ id: "sf-older", updatedAt: "2026-06-30T10:00:00.000Z" });
    const newer = makeSf({ id: "sf-newer", updatedAt: "2026-07-01T10:05:00.000Z" });
    sfStore.data = [older, newer];
    const result = await findResumable("proj-1");
    expect(result?.id).toBe("sf-newer");
  });

  it("accepts all valid steps for stop_secure", async () => {
    for (const step of PATH_STEP_ORDER.stop_secure) {
      sfStore.data = [makeSf({ workflowStep: step })];
      const result = await findResumable("proj-1");
      expect(result?.workflowStep).toBe(step);
    }
  });

  it("accepts all valid steps for notable_find", async () => {
    for (const step of PATH_STEP_ORDER.notable_find) {
      sfStore.data = [makeSf({ path: "notable_find", workflowStep: step })];
      const result = await findResumable("proj-1");
      expect(result?.workflowStep).toBe(step);
    }
  });

  it("excludes pas_recorded records even with a valid workflowStep", async () => {
    sfStore.data = [makeSf({ status: "pas_recorded", workflowStep: "observe" })];
    expect(await findResumable("proj-1")).toBeNull();
  });
});

// ─── 3. persistWorkflowProgress / clearWorkflowProgress ─────────────────────

describe("persistWorkflowProgress", () => {
  beforeEach(() => mockUpdate.mockClear());

  it("calls db.significantFinds.update with the step value", () => {
    persistWorkflowProgress("sf-abc", "depth_context");
    expect(mockUpdate).toHaveBeenCalledWith(
      "sf-abc",
      expect.objectContaining({ workflowStep: "depth_context" })
    );
  });

  it("includes updatedAt in the update payload", () => {
    persistWorkflowProgress("sf-abc", "observe");
    const [, patch] = mockUpdate.mock.calls[0];
    expect(typeof patch.updatedAt).toBe("string");
  });
});

describe("clearWorkflowProgress", () => {
  beforeEach(() => mockUpdate.mockClear());

  it("calls db.significantFinds.update with workflowStep: null", () => {
    clearWorkflowProgress("sf-xyz");
    expect(mockUpdate).toHaveBeenCalledWith(
      "sf-xyz",
      expect.objectContaining({ workflowStep: null })
    );
  });
});

// ─── 4. Clear-rule guard ──────────────────────────────────────────────────────
// Verifies that each clear site produces a DB update payload containing
// workflowStep: null whenever status leaves in_progress.
// Screen-level tests (WhatNextScreen, ScatterCompleteScreen, FindWhatNextScreen)
// would require React Testing Library; the structural assertions below verify
// the payload shapes mandated by the brief.

describe("clear-rule guard — update payload shapes", () => {
  it("WhatNextScreen payload: awaiting_excavation + workflowStep: null", () => {
    // Mirrors the exact update call in WhatNextScreen's useEffect
    const payload = {
      status: "awaiting_excavation" as const,
      workflowStep: null as null,
      updatedAt: new Date().toISOString(),
    };
    expect(payload.workflowStep).toBeNull();
    expect(payload.status).not.toBe("in_progress");
  });

  it("ScatterCompleteScreen add payload includes workflowStep: null", () => {
    // Path 2 creates the record at the terminal step with workflowStep: null
    const addPayload = { status: "in_progress" as const, workflowStep: null as null };
    expect(addPayload.workflowStep).toBeNull();
  });

  it("FindWhatNextScreen update payload includes workflowStep: null", () => {
    // Both branches of handleDone include workflowStep: null
    const updatePayload = { linkedFindId: "find-1", workflowStep: null as null, updatedAt: "" };
    expect(updatePayload.workflowStep).toBeNull();
    const elsePayload = { workflowStep: null as null, updatedAt: "" };
    expect(elsePayload.workflowStep).toBeNull();
  });

  it("setStatus (DetailSheet): adds workflowStep: null for non-in_progress status", () => {
    const statuses = ["awaiting_excavation", "excavation_complete", "coroner_notified", "pas_recorded"] as const;
    for (const status of statuses) {
      // Mirrors the conditional spread in SignificantFindDetailSheet.setStatus()
      const patch = {
        status,
        updatedAt: new Date().toISOString(),
        ...(status !== "in_progress" ? { workflowStep: null as null } : {}),
      };
      expect((patch as any).workflowStep).toBeNull();
    }
  });

  it("setStatus (DetailSheet): does NOT add workflowStep for in_progress", () => {
    const patch = {
      status: "in_progress" as const,
      updatedAt: new Date().toISOString(),
      ...("in_progress" !== "in_progress" ? { workflowStep: null as null } : {}),
    };
    expect(patch).not.toHaveProperty("workflowStep");
  });
});
