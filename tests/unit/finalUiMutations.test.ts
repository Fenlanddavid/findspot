import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  db,
  type FieldGuideScanCache,
  type Find,
  type Media,
  type SignificantFind,
} from "../../src/db";
import {
  saveFieldGuideViewMode,
  saveFindMapStyle,
  saveLocationMapPreferences,
} from "../../src/services/mapPreferenceMutations";
import {
  saveHistoricScanCache,
  saveTerrainScanCache,
} from "../../src/services/fieldGuideMutations";
import {
  completeNotableFindRecord,
  createSignificantFindRecord,
  deleteSignificantFindAggregate,
  setSignificantFindStatus,
} from "../../src/services/significantFindMutations";

const NOW = "2026-07-22T21:00:00.000Z";

function find(id: string, overrides: Partial<Find> = {}): Find {
  return {
    id,
    projectId: "project-1",
    permissionId: "permission-1",
    fieldId: null,
    sessionId: null,
    findCode: id,
    objectType: "Test find",
    lat: null,
    lon: null,
    gpsAccuracyM: null,
    osGridRef: "",
    w3w: "",
    period: "Unknown",
    material: "Other",
    completeness: "Complete",
    notes: "",
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function significant(id: string, overrides: Partial<SignificantFind> = {}): SignificantFind {
  return {
    id,
    projectId: "project-1",
    permissionId: "permission-1",
    sessionId: null,
    path: "notable_find",
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
    treasureActDraft: "",
    landownerSummary: "",
    workflowStep: "photo_capture",
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function media(id: string, findId: string): Media {
  return {
    id,
    projectId: "project-1",
    findId,
    type: "photo",
    filename: `${id}.txt`,
    mime: "text/plain",
    blob: new Blob([id], { type: "text/plain" }),
    caption: "",
    scalePresent: false,
    createdAt: NOW,
  };
}

function cache(id: string, createdAt: number): FieldGuideScanCache {
  return {
    id,
    createdAt,
    rawClusters: [],
    sourceAvailability: {},
    engineVersion: "test",
  };
}

async function clearTables(): Promise<void> {
  await Promise.all([
    db.settings.clear(),
    db.fieldGuideCache.clear(),
    db.savedPoints.clear(),
    db.landscapeInterpretations.clear(),
    db.significantFinds.clear(),
    db.finds.clear(),
    db.media.clear(),
  ]);
}

beforeEach(async () => {
  await db.open();
  await clearTables();
});

afterEach(clearTables);

describe("final UI mutation services", () => {
  it("persists each map preference under its established setting key", async () => {
    await saveLocationMapPreferences("satellite", true);
    await saveFindMapStyle("satellite");
    await saveFieldGuideViewMode("detail");

    expect(await db.settings.get("mapStyle")).toMatchObject({ value: "satellite" });
    expect(await db.settings.get("showLidar")).toMatchObject({ value: true });
    expect(await db.settings.get("searchMapStyle")).toMatchObject({ value: "satellite" });
    expect(await db.settings.get("fieldGuideViewMode")).toMatchObject({ value: "detail" });
  });

  it("saves terrain cache while removing only rows older than the cutoff", async () => {
    await db.fieldGuideCache.bulkPut([
      cache("terrain-expired", 100),
      cache("terrain-fresh", 900),
    ]);

    await saveTerrainScanCache(cache("terrain-new", 1_000), 500);

    expect((await db.fieldGuideCache.toArray()).map(row => row.id).sort()).toEqual([
      "terrain-fresh",
      "terrain-new",
    ]);
  });

  it("saves historic cache without sweeping an old terrain row", async () => {
    await db.fieldGuideCache.bulkPut([
      cache("historic:expired", 100),
      cache("terrain:expired", 100),
    ]);

    await saveHistoricScanCache({
      ...cache("historic:new", 1_000),
      historicLookup: { geoData: { place: "Test" } },
    }, 500);

    expect((await db.fieldGuideCache.toArray()).map(row => row.id).sort()).toEqual([
      "historic:new",
      "terrain:expired",
    ]);
  });

  it("creates a significant record, marks its linked find and clears resume state on status change", async () => {
    await db.finds.put(find("linked-find"));
    await createSignificantFindRecord(
      significant("significant-1", { linkedFindId: "linked-find" }),
      "linked-find",
    );

    expect(await db.finds.get("linked-find")).toMatchObject({ isNotableFind: true });
    expect(await db.significantFinds.get("significant-1")).toBeDefined();

    await setSignificantFindStatus("significant-1", "awaiting_excavation");
    expect(await db.significantFinds.get("significant-1")).toMatchObject({
      status: "awaiting_excavation",
      workflowStep: null,
    });
  });

  it("completes a notable record and links the newly created find atomically", async () => {
    await db.significantFinds.put(significant("significant-1"));
    const linked = find("new-linked", { isNotableFind: true });

    await completeNotableFindRecord("significant-1", linked, "2026-07-22T21:30:00.000Z");

    expect(await db.finds.get(linked.id)).toEqual(linked);
    expect(await db.significantFinds.get("significant-1")).toMatchObject({
      linkedFindId: linked.id,
      workflowStep: null,
      updatedAt: "2026-07-22T21:30:00.000Z",
    });
  });

  it("deletes only the significant aggregate and its linked media", async () => {
    await db.finds.bulkPut([
      find("linked-find"),
      find("scatter-find", { scatterId: "scatter-1" }),
      find("keep-find"),
    ]);
    await db.significantFinds.put(significant("significant-1", {
      path: "map_scatter",
      scatterId: "scatter-1",
      scatterFindIds: ["scatter-find"],
      linkedFindId: "linked-find",
    }));
    await db.media.bulkPut([
      media("significant-media", "significant-1"),
      media("linked-media", "linked-find"),
      media("scatter-media", "scatter-find"),
      media("keep-media", "keep-find"),
    ]);

    await deleteSignificantFindAggregate("significant-1");

    expect(await db.significantFinds.get("significant-1")).toBeUndefined();
    expect(await db.finds.toCollection().primaryKeys()).toEqual(["keep-find"]);
    expect(await db.media.toCollection().primaryKeys()).toEqual(["keep-media"]);
  });
});
