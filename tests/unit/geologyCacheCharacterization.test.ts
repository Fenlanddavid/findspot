import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db, type GeologyContextRecord } from "../../src/db";
import {
  cacheEmptyGeologyContext,
  cacheGeologyContext,
  getCachedGeologyContext,
  sweepStaleGeologyCache,
} from "../../src/services/geologyContextCache";
import { buildTileKey } from "../../src/engines/geologyContext/geologyTileKey";
import {
  GEOLOGY_CACHE_TTL_MS,
  GEOLOGY_CLASSIFIER_VERSION,
  GEOLOGY_SOURCE_VERSION,
  type GeologyContext,
} from "../../src/engines/geologyContext/geologyContextTypes";

const NOW = 1_800_000_000_000;

function context(overrides: Partial<GeologyContext> = {}): GeologyContext {
  const tileKey = buildTileKey(52.2053, 0.1218);
  return {
    tileKey,
    centroid: { lat: 52.2053, lon: 0.1218 },
    source: { bedrock: "BGS_625K" },
    raw: { bedrockName: "Chalk" },
    landscapeClass: "chalk_downland",
    confidence: "high",
    scoreModifier: 7,
    explanation: ["Characterized geology context"],
    fetchedAt: NOW,
    classifierVersion: GEOLOGY_CLASSIFIER_VERSION,
    sourceVersion: GEOLOGY_SOURCE_VERSION,
    ...overrides,
  };
}

function record(value: GeologyContext): GeologyContextRecord {
  return {
    tileKey: value.tileKey,
    centroid: value.centroid,
    context: value,
    fetchedAt: value.fetchedAt,
    classifierVersion: value.classifierVersion,
    sourceVersion: value.sourceVersion,
  };
}

beforeEach(async () => {
  vi.spyOn(Date, "now").mockReturnValue(NOW);
  await db.open();
  await db.geologyContext.clear();
});

afterEach(async () => {
  await db.geologyContext.clear();
  vi.restoreAllMocks();
});

describe("geology cache persistence characterization", () => {
  it("round-trips a valid fresh context through its versioned tile key", async () => {
    const value = context();

    await cacheGeologyContext(value);

    expect(await getCachedGeologyContext(value.tileKey)).toEqual({
      kind: "context",
      context: value,
    });
    expect(await db.geologyContext.get(value.tileKey)).toEqual(record(value));
  });

  it("deletes stale and malformed rows instead of returning them", async () => {
    const stale = context({
      tileKey: "stale",
      fetchedAt: NOW - GEOLOGY_CACHE_TTL_MS - 1,
    });
    await db.geologyContext.put(record(stale));
    await db.geologyContext.put({
      ...record(context({ tileKey: "malformed" })),
      context: { unexpected: true },
    });

    expect(await getCachedGeologyContext("stale")).toEqual({ kind: "miss" });
    expect(await getCachedGeologyContext("malformed")).toEqual({ kind: "miss" });
    expect(await db.geologyContext.bulkGet(["stale", "malformed"])).toEqual([
      undefined,
      undefined,
    ]);
  });

  it("round-trips a valid empty marker without changing the database schema", async () => {
    const tileKey = buildTileKey(52.3, 0.2);

    await cacheEmptyGeologyContext(tileKey, { lat: 52.3, lon: 0.2 }, NOW);

    expect(await getCachedGeologyContext(tileKey)).toEqual({ kind: "empty" });
    expect(await db.geologyContext.get(tileKey)).toEqual({
      tileKey,
      centroid: { lat: 52.3, lon: 0.2 },
      empty: true,
      fetchedAt: NOW,
      classifierVersion: GEOLOGY_CLASSIFIER_VERSION,
      sourceVersion: GEOLOGY_SOURCE_VERSION,
    });
  });

  it("sweeps expired and mismatched-version rows while retaining current rows", async () => {
    const current = context({ tileKey: buildTileKey(52.2053, 0.1218) });
    const expired = context({
      tileKey: buildTileKey(53, -1),
      fetchedAt: NOW - GEOLOGY_CACHE_TTL_MS - 1,
    });
    const orphan = context({ tileKey: "geology:gcpuuz:classifier:v1:source:retired" });
    await db.geologyContext.bulkPut([record(current), record(expired), record(orphan)]);

    await sweepStaleGeologyCache();

    expect(await db.geologyContext.toArray()).toEqual([record(current)]);
  });
});
