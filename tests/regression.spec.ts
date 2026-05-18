import { expect, test, type Page } from "@playwright/test";

function encodePack(pack: object): string {
  return Buffer.from(JSON.stringify(pack), "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

async function dismissNonBlockingPrompts(page: Page) {
  await page.getByRole("button", { name: /^Later$/ }).click({ timeout: 500 }).catch(() => {});
}

async function bootApp(page: Page) {
  await page.goto("./");
  await dismissNonBlockingPrompts(page);
  await expect(page.getByText("Local-first storage")).toBeVisible();
}

async function createPermission(page: Page, name: string) {
  await page.goto("./permission");
  await page.getByLabel("Permission Name / Location").fill(name);
  await page.getByRole("button", { name: "Create Record" }).click();
  await expect(page).toHaveURL(/\/permission\/[^/?#]+$/);
  await expect(page.getByText(name)).toBeVisible();
}

async function readIndexedDbStore(page: Page, storeName: string) {
  return page.evaluate((name) => new Promise<unknown[]>((resolve, reject) => {
    const request = indexedDB.open("findspot_uk");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction(name, "readonly");
      const rows = tx.objectStore(name).getAll();
      rows.onerror = () => reject(rows.error);
      rows.onsuccess = () => resolve(rows.result);
    };
  }), storeName);
}

async function putIndexedDbRows(page: Page, storeName: string, rows: object[]) {
  await page.evaluate(({ name, rows }) => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open("findspot_uk");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction(name, "readwrite");
      const store = tx.objectStore(name);
      for (const row of rows) store.put(row);
      tx.onerror = () => reject(tx.error);
      tx.oncomplete = () => resolve();
    };
  }), { name: storeName, rows });
}

async function getMediaBlobText(page: Page, mediaId: string) {
  return page.evaluate((id) => new Promise<string | null>((resolve, reject) => {
    const request = indexedDB.open("findspot_uk");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction("media", "readonly");
      const rowRequest = tx.objectStore("media").get(id);
      rowRequest.onerror = () => reject(rowRequest.error);
      rowRequest.onsuccess = async () => {
        const row = rowRequest.result;
        if (!row?.blob) {
          resolve(null);
          return;
        }
        resolve(await row.blob.text());
      };
    };
  }), mediaId);
}

async function putPendingFindWithMedia(page: Page, projectId: string, permissionId: string) {
  const now = new Date().toISOString();
  await page.evaluate(({ projectId, permissionId, now }) => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open("findspot_uk");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction(["finds", "media"], "readwrite");
      tx.onerror = () => reject(tx.error);
      tx.oncomplete = () => resolve();
      tx.objectStore("finds").put({
        id: "pending-with-photo",
        projectId,
        permissionId,
        fieldId: null,
        sessionId: null,
        findCode: "REG-PENDING",
        objectType: "Pending Quick Find",
        isPending: true,
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
        notes: "seeded pending find",
        createdAt: now,
        updatedAt: now,
      });
      tx.objectStore("media").put({
        id: "pending-media",
        projectId,
        findId: "pending-with-photo",
        type: "photo",
        photoType: "in-situ",
        filename: "pending.txt",
        mime: "text/plain",
        blob: new Blob(["pending media"], { type: "text/plain" }),
        caption: "",
        scalePresent: false,
        createdAt: now,
      });
    };
  }), { projectId, permissionId, now });
}

async function importSettingsBackup(page: Page, filename: string, data: object) {
  await page.goto("./settings");
  await page.locator('input[type="file"][accept=".json"]').setInputFiles({
    name: filename,
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(data)),
  });
  await expect(page.getByText(new RegExp(`Restore "${filename.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"\\?`))).toBeVisible();
  await page.getByLabel(/Type RESTORE/).fill("RESTORE");
  await Promise.all([
    page.waitForURL(/\/$/),
    page.getByRole("button", { name: "Confirm Import" }).click(),
  ]);
}

function regressionBoundary(offset = 0) {
  const lon = -1.471 + offset;
  const lat = 53.381 + offset;
  return {
    type: "Polygon",
    coordinates: [[[lon, lat], [lon + 0.001, lat], [lon + 0.001, lat + 0.001], [lon, lat + 0.001], [lon, lat]]],
  };
}

function regressionSession(id: string, projectId: string, permissionId: string, fieldId: string | null, now: string) {
  return {
    id,
    projectId,
    permissionId,
    fieldId,
    date: now,
    lat: null,
    lon: null,
    gpsAccuracyM: null,
    landUse: "",
    cropType: "",
    isStubble: false,
    notes: "",
    isFinished: false,
    createdAt: now,
    updatedAt: now,
  };
}

function regressionFind(id: string, projectId: string, permissionId: string, fieldId: string | null, sessionId: string | null, now: string) {
  return {
    id,
    projectId,
    permissionId,
    fieldId,
    sessionId,
    findCode: `FS-REG-${id}`,
    objectType: "Regression Find",
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
    createdAt: now,
    updatedAt: now,
  };
}

test.beforeEach(async ({ page }) => {
  page.on("pageerror", (error) => {
    throw error;
  });
});

test("backup restore replaces current data and preserves linked records, settings and media blobs", async ({ page }) => {
  await createPermission(page, "Regression Data That Should Disappear");

  const now = "2026-05-15T12:00:00.000Z";
  const backup = {
    version: 2,
    exportedAt: now,
    projects: [{ id: "restored-project", name: "Restored Regression Project", region: "UK", createdAt: now, updatedAt: now }],
    permissions: [{
      id: "restored-permission",
      projectId: "restored-project",
      name: "Restored Regression Farm",
      type: "individual",
      lat: 53.3811,
      lon: -1.4701,
      gpsAccuracyM: 5,
      collector: "Regression Detectorist",
      landType: "pasture",
      permissionGranted: true,
      notes: "Restored permission notes",
      boundary: regressionBoundary(),
      createdAt: now,
      updatedAt: now,
    }],
    fields: [{
      id: "restored-field",
      projectId: "restored-project",
      permissionId: "restored-permission",
      name: "Restored North Field",
      boundary: regressionBoundary(0.001),
      notes: "Restored field notes",
      createdAt: now,
      updatedAt: now,
    }],
    sessions: [regressionSession("restored-session", "restored-project", "restored-permission", "restored-field", now)],
    finds: [regressionFind("restored-find", "restored-project", "restored-permission", "restored-field", "restored-session", now)],
    tracks: [{
      id: "restored-track",
      projectId: "restored-project",
      sessionId: "restored-session",
      name: "Restored Track",
      points: [{ lat: 53.3811, lon: -1.4701, timestamp: 1, accuracy: 5 }],
      isActive: false,
      color: "#10b981",
      createdAt: now,
      updatedAt: now,
    }],
    media: [{
      id: "restored-media",
      projectId: "restored-project",
      findId: "restored-find",
      permissionId: "restored-permission",
      type: "photo",
      filename: "restored.txt",
      mime: "text/plain",
      blob: "data:text/plain;base64,cmVzdG9yZWQtcGhvdG8tcHJvb2Y=",
      caption: "Restored proof",
      scalePresent: false,
      createdAt: now,
    }],
    settings: [{ key: "detectorist", value: "Restored Detectorist" }],
    importedPackages: [{
      id: "restored-package",
      packageHash: "restored-hash",
      importedAt: now,
      sharedPermissionId: "restored-shared",
    }],
  };

  await importSettingsBackup(page, "full-restore.json", backup);
  await page.goto("./");
  await dismissNonBlockingPrompts(page);
  await expect(page.getByRole("button", { name: "Restored Regression Farm" })).toBeVisible();

  const [projects, permissions, fields, sessions, finds, tracks, settings, importedPackages] = await Promise.all([
    readIndexedDbStore(page, "projects"),
    readIndexedDbStore(page, "permissions"),
    readIndexedDbStore(page, "fields"),
    readIndexedDbStore(page, "sessions"),
    readIndexedDbStore(page, "finds"),
    readIndexedDbStore(page, "tracks"),
    readIndexedDbStore(page, "settings"),
    readIndexedDbStore(page, "importedPackages"),
  ]);

  expect((projects as any[]).map((row) => row.id)).toEqual(["restored-project"]);
  expect((permissions as any[]).map((row) => row.name)).toEqual(["Restored Regression Farm"]);
  expect((permissions as any[]).some((row) => row.name === "Regression Data That Should Disappear")).toBe(false);
  expect((fields as any[])[0]).toMatchObject({ id: "restored-field", permissionId: "restored-permission" });
  expect((sessions as any[])[0]).toMatchObject({ id: "restored-session", permissionId: "restored-permission", fieldId: "restored-field" });
  expect((finds as any[])[0]).toMatchObject({ id: "restored-find", permissionId: "restored-permission", sessionId: "restored-session", fieldId: "restored-field" });
  expect((tracks as any[])[0]).toMatchObject({ id: "restored-track", sessionId: "restored-session" });
  expect((settings as any[]).find((row) => row.key === "detectorist")?.value).toBe("Restored Detectorist");
  expect((importedPackages as any[])[0]).toMatchObject({ id: "restored-package", sharedPermissionId: "restored-shared" });
  await expect.poll(() => getMediaBlobText(page, "restored-media")).toBe("restored-photo-proof");
});

test("invalid backup import is rejected without wiping existing local data", async ({ page }) => {
  await createPermission(page, "Regression Preserved Farm");

  const now = "2026-05-15T12:00:00.000Z";
  const invalidBackup = {
    version: 2,
    exportedAt: now,
    projects: [],
    permissions: [{
      id: "bad-permission",
      projectId: "missing-project",
      name: "Invalid Permission",
      type: "individual",
      lat: null,
      lon: null,
      gpsAccuracyM: null,
      collector: "",
      landType: "pasture",
      permissionGranted: true,
      createdAt: now,
      updatedAt: now,
    }],
    fields: [],
    sessions: [],
    finds: [],
    tracks: [],
    media: [],
    settings: [],
    importedPackages: [],
  };

  await page.goto("./settings");
  await page.locator('input[type="file"][accept=".json"]').setInputFiles({
    name: "invalid-restore.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(invalidBackup)),
  });
  await page.getByLabel(/Type RESTORE/).fill("RESTORE");
  await page.getByRole("button", { name: "Confirm Import" }).click();
  await expect(page.getByText(/permissions\[0\] references an unknown project/)).toBeVisible();

  const permissions = await readIndexedDbStore(page, "permissions");
  expect((permissions as any[]).some((row) => row.name === "Regression Preserved Farm")).toBe(true);
  expect((permissions as any[]).some((row) => row.name === "Invalid Permission")).toBe(false);
});

test("deleting a pending find removes attached media", async ({ page }) => {
  await bootApp(page);
  const [projects, permissions] = await Promise.all([
    readIndexedDbStore(page, "projects"),
    readIndexedDbStore(page, "permissions"),
  ]);
  const projectId = (projects as any[])[0].id;
  const permissionId = (permissions as any[])[0].id;
  await putPendingFindWithMedia(page, projectId, permissionId);

  await page.goto("./pending");
  await expect(page.getByText("REG-PENDING")).toBeVisible();
  await page.getByRole("button", { name: "Delete" }).click();
  await page.getByRole("button", { name: "Yes" }).click();
  await expect(page.getByText("Queue is empty")).toBeVisible();

  const [finds, media] = await Promise.all([
    readIndexedDbStore(page, "finds"),
    readIndexedDbStore(page, "media"),
  ]);
  expect((finds as any[]).some((row) => row.id === "pending-with-photo")).toBe(false);
  expect((media as any[]).some((row) => row.id === "pending-media")).toBe(false);
});

test("Club Day re-scan updates one local rally without losing referenced old fields", async ({ page }) => {
  const basePack = {
    type: "findspot-club-day-pack",
    version: 1,
    sharedPermissionId: "regression-shared-rally",
    eventName: "Regression Rally",
    eventDate: "2026-05-13",
    significantFindInstructions: "Call the organiser first.",
    fields: [{
      id: "field-a",
      name: "Old Field",
      boundary: regressionBoundary(),
      createdAt: "2026-05-13T00:00:00.000Z",
      updatedAt: "2026-05-13T00:00:00.000Z",
    }],
    createdAt: "2026-05-13T00:00:00.000Z",
  };

  await page.goto(`./join?pack=${encodePack(basePack)}`);
  await page.getByPlaceholder("e.g. John Smith").fill("Regression Detectorist");
  await page.getByRole("button", { name: /Join/i }).click();
  await expect(page.getByText("You're in!")).toBeVisible();

  await page.goto(`./join?pack=${encodePack(basePack)}`);
  await page.getByRole("button", { name: /Join/i }).click();
  await expect(page.getByText("Already joined")).toBeVisible();

  let permissions = await readIndexedDbStore(page, "permissions") as any[];
  const rally = permissions.find((row) => row.sharedPermissionId === "regression-shared-rally");
  expect(rally).toBeTruthy();
  expect(permissions.filter((row) => row.sharedPermissionId === "regression-shared-rally")).toHaveLength(1);

  const now = "2026-05-15T12:00:00.000Z";
  await putIndexedDbRows(page, "sessions", [regressionSession("referencing-session", rally.projectId, rally.id, "field-a", now)]);
  await putIndexedDbRows(page, "finds", [regressionFind("referencing-find", rally.projectId, rally.id, "field-a", "referencing-session", now)]);

  const updatedPack = {
    ...basePack,
    eventName: "Regression Rally Updated",
    significantFindInstructions: "Updated call instructions.",
    createdAt: "2026-05-14T00:00:00.000Z",
    fields: [{
      id: "field-b",
      name: "New Field",
      boundary: regressionBoundary(0.002),
      createdAt: "2026-05-14T00:00:00.000Z",
      updatedAt: "2026-05-14T00:00:00.000Z",
    }],
  };

  await page.goto(`./join?pack=${encodePack(updatedPack)}`);
  await page.getByRole("button", { name: /Join/i }).click();
  await expect(page.getByText("Event updated")).toBeVisible();

  permissions = await readIndexedDbStore(page, "permissions") as any[];
  const updatedRally = permissions.find((row) => row.sharedPermissionId === "regression-shared-rally");
  expect(permissions.filter((row) => row.sharedPermissionId === "regression-shared-rally")).toHaveLength(1);
  expect(updatedRally).toMatchObject({
    id: rally.id,
    name: "Regression Rally Updated",
    significantFindInstructions: "Updated call instructions.",
  });

  const fields = (await readIndexedDbStore(page, "fields") as any[]).filter((row) => row.permissionId === rally.id);
  expect(fields.map((row) => row.id).sort()).toEqual(["field-a", "field-b"]);
  expect(fields.find((row) => row.id === "field-a")?.name).toBe("Old Field");
  expect(fields.find((row) => row.id === "field-b")?.name).toBe("New Field");
});

test("Club Day organiser merge normalises member data and deduplicates a later re-export", async ({ page }) => {
  await bootApp(page);
  const project = (await readIndexedDbStore(page, "projects") as any[])[0];
  const now = "2026-05-15T12:00:00.000Z";

  await putIndexedDbRows(page, "permissions", [{
    id: "organiser-permission",
    projectId: project.id,
    name: "Organiser Regression Rally",
    type: "rally",
    lat: null,
    lon: null,
    gpsAccuracyM: null,
    collector: "",
    landType: "other",
    permissionGranted: true,
    notes: "",
    validFrom: "2026-05-13",
    sharedPermissionId: "merge-shared-rally",
    isSharedPermission: true,
    createdAt: now,
    updatedAt: now,
  }]);

  const memberExport = {
    type: "findspot-club-day-export",
    version: 1,
    sharedPermissionId: "merge-shared-rally",
    recorderId: "member-recorder",
    recorderName: "Member One",
    exportedAt: now,
    sessions: [{
      ...regressionSession("member-session", "member-project", "member-permission", null, now),
      sharedPermissionId: "merge-shared-rally",
      recorderId: "member-recorder",
      recorderName: "Member One",
    }],
    finds: [{
      ...regressionFind("member-find", "member-project", "member-permission", null, "member-session", now),
      sharedPermissionId: "merge-shared-rally",
      recorderId: "member-recorder",
      recorderName: "Member One",
    }],
    media: [{
      id: "member-media",
      projectId: "member-project",
      findId: "member-find",
      type: "photo",
      filename: "member.txt",
      mime: "text/plain",
      blob: "data:text/plain;base64,Y2x1Yi1waG90by1wcm9vZg==",
      caption: "Member proof",
      scalePresent: false,
      createdAt: now,
    }],
  };

  await page.goto("./permission/organiser-permission");
  await page.getByRole("button", { name: "Import Member Data" }).click();
  await page.locator('input[type="file"][accept=".json"]').setInputFiles({
    name: "member-export.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(memberExport)),
  });
  await expect(page.getByText("Import complete")).toBeVisible();
  await expect(page.getByText("From: Member One")).toBeVisible();
  await expect(page.getByText("New sessions").locator("..")).toContainText("1");
  await expect(page.getByText("New finds").locator("..")).toContainText("1");

  const reExport = { ...memberExport, exportedAt: "2026-05-15T13:00:00.000Z" };
  await page.getByText("Import Another").locator("..").locator('input[type="file"]').setInputFiles({
    name: "member-export-again.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(reExport)),
  });
  await expect(page.getByText("Import complete")).toBeVisible();
  await expect(page.getByText("Already present").locator("..")).toContainText("2");

  const [sessions, finds, media, importedPackages] = await Promise.all([
    readIndexedDbStore(page, "sessions"),
    readIndexedDbStore(page, "finds"),
    readIndexedDbStore(page, "media"),
    readIndexedDbStore(page, "importedPackages"),
  ]);

  const mergedSessions = (sessions as any[]).filter((row) => row.id === "member-session");
  const mergedFinds = (finds as any[]).filter((row) => row.id === "member-find");
  expect(mergedSessions).toHaveLength(1);
  expect(mergedFinds).toHaveLength(1);
  expect(mergedSessions[0]).toMatchObject({ projectId: project.id, permissionId: "organiser-permission", recorderName: "Member One" });
  expect(mergedFinds[0]).toMatchObject({ projectId: project.id, permissionId: "organiser-permission", sessionId: "member-session", recorderName: "Member One" });
  expect((media as any[]).filter((row) => row.id === "member-media")).toHaveLength(1);
  expect((importedPackages as any[]).filter((row) => row.sharedPermissionId === "merge-shared-rally" && row.recorderId === "member-recorder")).toHaveLength(1);
  await expect.poll(() => getMediaBlobText(page, "member-media")).toBe("club-photo-proof");
});
