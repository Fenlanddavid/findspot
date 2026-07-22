import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  db,
  type Find,
  type Media,
  type Permission,
  type Session,
  type SignificantFind,
  type Track,
  type UndugSignal,
} from "../../src/db";
import {
  deleteFindAndReopenSignal,
  saveCompletedFind,
} from "../../src/services/findMutations";
import { keepClubDayAsPersonalRecord } from "../../src/services/permissionMutations";
import { deleteSessionCascade } from "../../src/services/sessionMutations";

const NOW = "2026-07-22T20:00:00.000Z";

function permission(overrides: Partial<Permission> = {}): Permission {
  return {
    id: "permission-1",
    projectId: "project-1",
    name: "Test permission",
    type: "individual",
    lat: null,
    lon: null,
    gpsAccuracyM: null,
    collector: "Detectorist",
    landType: "other",
    permissionGranted: true,
    notes: "",
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function session(id: string, overrides: Partial<Session> = {}): Session {
  return {
    id,
    projectId: "project-1",
    permissionId: "permission-1",
    fieldId: null,
    date: NOW,
    lat: null,
    lon: null,
    gpsAccuracyM: null,
    landUse: "",
    cropType: "",
    isStubble: false,
    notes: "",
    isFinished: true,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function find(id: string, sessionId: string | null, overrides: Partial<Find> = {}): Find {
  return {
    id,
    projectId: "project-1",
    permissionId: "permission-1",
    fieldId: null,
    sessionId,
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

async function clearCoreTables(): Promise<void> {
  await Promise.all([
    db.permissions.clear(),
    db.sessions.clear(),
    db.finds.clear(),
    db.significantFinds.clear(),
    db.media.clear(),
    db.tracks.clear(),
    db.undugSignals.clear(),
    db.importedPackages.clear(),
  ]);
}

beforeEach(async () => {
  await db.open();
  await clearCoreTables();
});

afterEach(clearCoreTables);

describe("core record mutation services", () => {
  it("deletes one session aggregate without touching another session", async () => {
    const targetSignificant = {
      id: "significant-target",
      projectId: "project-1",
      permissionId: "permission-1",
      sessionId: "session-target",
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
      createdAt: NOW,
      updatedAt: NOW,
    } satisfies SignificantFind;
    const targetTrack = {
      id: "track-target",
      projectId: "project-1",
      sessionId: "session-target",
      name: "Target track",
      points: [],
      isActive: false,
      color: "#fff",
      createdAt: NOW,
      updatedAt: NOW,
    } satisfies Track;
    const keptTrack = { ...targetTrack, id: "track-kept", sessionId: "session-kept" };

    await db.sessions.bulkPut([session("session-target"), session("session-kept")]);
    await db.finds.bulkPut([find("find-target", "session-target"), find("find-kept", "session-kept")]);
    await db.significantFinds.put(targetSignificant);
    await db.media.bulkPut([
      media("media-target", "find-target"),
      media("media-significant", targetSignificant.id),
      media("media-kept", "find-kept"),
    ]);
    await db.tracks.bulkPut([targetTrack, keptTrack]);

    await deleteSessionCascade("session-target");

    expect(await db.sessions.get("session-target")).toBeUndefined();
    expect(await db.finds.get("find-target")).toBeUndefined();
    expect(await db.significantFinds.get(targetSignificant.id)).toBeUndefined();
    expect(await db.media.toCollection().primaryKeys()).toEqual(["media-kept"]);
    expect(await db.tracks.toCollection().primaryKeys()).toEqual(["track-kept"]);
    expect(await db.sessions.get("session-kept")).toBeDefined();
    expect(await db.finds.get("find-kept")).toBeDefined();
  });

  it("resolves and reopens an undug signal across find save and deletion", async () => {
    const signal = {
      id: "signal-1",
      createdAt: Date.parse(NOW),
      lat: 52,
      lng: 0.1,
      status: "open",
    } satisfies UndugSignal;
    await db.undugSignals.put(signal);
    const saved = find("find-1", null, { sourceSignalId: signal.id });
    const { createdAt, ...withoutCreatedAt } = saved;

    await saveCompletedFind(withoutCreatedAt, {
      existing: false,
      createdAt,
      sourceSignalId: signal.id,
    });
    await db.media.put(media("media-1", saved.id));

    expect(await db.undugSignals.get(signal.id)).toMatchObject({
      status: "dug-find",
      resolvedFindId: saved.id,
    });

    await deleteFindAndReopenSignal(saved.id, signal.id);

    expect(await db.finds.get(saved.id)).toBeUndefined();
    expect(await db.media.get("media-1")).toBeUndefined();
    expect(await db.undugSignals.get(signal.id)).toMatchObject({ status: "open" });
    expect(await db.undugSignals.get(signal.id)).not.toHaveProperty("resolvedFindId");
  });

  it("keeps a club-day record while removing organiser attribution", async () => {
    await db.permissions.put(permission({
      isClubDayMember: true,
      sharedPermissionId: "shared-1",
      organiserContactNumber: "01234",
      organiserEmail: "club@example.test",
      clubDayPublicNotes: "Public notes",
    }));
    await db.sessions.put(session("session-1", {
      sharedPermissionId: "shared-1",
      recorderId: "recorder-1",
      recorderName: "Detectorist",
    }));
    await db.finds.put(find("find-1", "session-1", {
      sharedPermissionId: "shared-1",
      recorderId: "recorder-1",
      recorderName: "Detectorist",
    }));
    await db.importedPackages.put({
      id: "import-1",
      packageHash: "hash-1",
      importedAt: NOW,
      sharedPermissionId: "shared-1",
    });

    await keepClubDayAsPersonalRecord("permission-1", "2026-07-22T21:00:00.000Z");

    expect(await db.permissions.get("permission-1")).toMatchObject({
      isClubDayMember: false,
      isPersonalRallyRecord: true,
      landownerPhone: "01234",
      landownerEmail: "club@example.test",
      notes: "Public notes",
    });
    expect(await db.sessions.get("session-1")).not.toHaveProperty("sharedPermissionId");
    expect(await db.finds.get("find-1")).not.toHaveProperty("sharedPermissionId");
    expect(await db.importedPackages.count()).toBe(0);
  });
});
