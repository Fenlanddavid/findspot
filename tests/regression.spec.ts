import { expect, test, type Page } from "@playwright/test";
import type { Cluster, Hotspot, ModernWay } from "../src/pages/fieldGuideTypes";
import { applyNHLEProtection, applyRouteAssessments } from "../src/utils/fieldGuideAnalysis";
import { applyGeologyModifiers } from "../src/engines/hotspot/hotspotEngine";
import { classifyGeology } from "../src/engines/geologyContext/geologyClassifier";
import { buildGeologyDisplay } from "../src/engines/geologyContext/geologyExplain";
import { fetchBgsGeology } from "../src/engines/geologyContext/geologyContextClient";
import type { GeologyContext } from "../src/engines/geologyContext/geologyContextTypes";
import { toOSGridRef } from "../src/services/gps";

function routeRegressionCluster(id: string, center: [number, number]): Cluster {
  return {
    id,
    points: [],
    minX: 0,
    maxX: 50,
    minY: 0,
    maxY: 5,
    type: "Linear Signal",
    score: 80,
    number: 1,
    isProtected: false,
    confidence: "High",
    findPotential: 70,
    center,
    source: "terrain",
    sources: ["terrain"],
    bearing: 0,
    metrics: { circularity: 0.1, density: 0.7, ratio: 7, area: 120 },
  };
}

function regressionHotspot(
  id: string,
  score: number,
  metrics: Hotspot["metrics"],
  confidence: Hotspot["confidence"] = "Developing Signal",
): Hotspot {
  return {
    id,
    number: 0,
    score,
    confidence,
    type: "General Activity Zone",
    classification: "General Activity Zone",
    classificationReason: "Regression hotspot",
    explanation: ["Regression signal"],
    center: [0, 0],
    bounds: [[0, 0], [0, 0]],
    memberIds: [id],
    metrics,
  };
}

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

async function mockFieldGuideHistoricScan(page: Page) {
  const overpassResponse = {
    elements: [
      {
        id: 9001,
        type: "node",
        lat: 53.3812,
        lon: -1.4702,
        tags: {
          historic: "archaeological_site",
          name: "Regression Barrow",
          period: "Bronze Age",
        },
      },
      {
        id: 9002,
        type: "way",
        tags: {
          historic: "roman_road",
          name: "Regression Roman Road",
        },
        geometry: [
          { lat: 53.3798, lon: -1.472 },
          { lat: 53.3824, lon: -1.468 },
        ],
      },
    ],
  };

  await page.route("https://a.tile.openstreetmap.org/**", route => route.abort());
  await page.route("https://services.arcgisonline.com/**", route => route.abort());
  await page.route("https://environment.data.gov.uk/**", route => route.abort());
  await page.route("https://mapseries-tilesets.s3.amazonaws.com/**", route => route.abort());
  await page.route("https://findspot-counter.trials-uk.workers.dev/**", route => route.fulfill({ status: 204 }));
  await page.route("**/roman-roads-gb.geojson", route => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ type: "FeatureCollection", features: [] }),
  }));
  await page.route("https://findspot-geocode.trials-uk.workers.dev/reverse**", route => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      address: {
        parish: "Regression Parish",
        county: "Regressionshire",
      },
    }),
  }));
  for (const host of [
    "https://overpass-api.de/**",
    "https://overpass.kumi.systems/**",
    "https://overpass.osm.ch/**",
  ]) {
    await page.route(host, route => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(overpassResponse),
    }));
  }
  await page.route("https://services-eu1.arcgis.com/**/National_Heritage_List_for_England_NHLE_v02_VIEW/**", route => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      type: "FeatureCollection",
      features: [{
        type: "Feature",
        geometry: {
          type: "Point",
          coordinates: [-1.4703, 53.3813],
        },
        properties: {
          Name: "Regression Scheduled Barrow",
          ListEntry: "1000001",
        },
      }],
    }),
  }));
  await page.route("https://services-eu1.arcgis.com/**/HE_AIM_data/**", route => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ type: "FeatureCollection", features: [] }),
  }));
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
  await page.locator('input[type="file"][accept*=".json"]').setInputFiles({
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
  await page.addInitScript(() => {
    localStorage.setItem("fs_onboarding_v2_done", "1");
    localStorage.setItem("fs_onboarding_done", "1");
  });
  page.on("pageerror", (error) => {
    throw error;
  });
});

test("monument buffer targets still run through modern route suppression", () => {
  const nhleData = {
    features: [{
      geometry: {
        type: "Polygon",
        coordinates: [[
          [0, 0],
          [0.001, 0],
          [0.001, 0.001],
          [0, 0.001],
          [0, 0],
        ]],
      },
      properties: { Name: "Regression Scheduled Monument" },
    }],
  };
  const modernWays: ModernWay[] = [{
    highwayTag: "track",
    geometry: [[0.00105, 0], [0.00105, 0.001]],
    bbox: [[0.00105, 0], [0.00105, 0.001]],
  }];

  const bufferOnly = routeRegressionCluster("buffer-track", [0.00105, 0.0005]);
  applyNHLEProtection([bufferOnly], nhleData);
  applyRouteAssessments([bufferOnly], modernWays);

  expect(bufferOnly.isProtected).toBe(true);
  expect(bufferOnly.monumentBufferM).toBe(20);
  expect(bufferOnly.isRouteArtefactRisk).toBe(true);
  expect(bufferOnly.routeAssessment?.relationship).toBe("modern_route_artefact");

  const monumentInterior = routeRegressionCluster("inside-monument", [0.0005, 0.0005]);
  applyNHLEProtection([monumentInterior], nhleData);
  applyRouteAssessments([monumentInterior], modernWays);

  expect(monumentInterior.isProtected).toBe(true);
  expect(monumentInterior.monumentBufferM).toBeUndefined();
  expect(monumentInterior.isRouteArtefactRisk).toBeUndefined();
  expect(monumentInterior.routeAssessment?.relationship).toBe("not_route_related");
});

test("toOSGridRef returns 10-figure National Grid References by default", () => {
  expect(toOSGridRef(52.6575703055556, 1.7179215833333)).toBe("TG 51538 13138");
  expect(toOSGridRef(55.9486, -3.1999)).toBe("NT 25163 73490");
  expect(toOSGridRef(56.79685, -5.003508)).toBe("NN 16677 71281");
  expect(toOSGridRef(51.4778, -0.0016)).toBe("TQ 38876 77320");
});

test("toOSGridRef supports lower precision formatting when requested", () => {
  expect(toOSGridRef(51.4778, -0.0016, 8)).toBe("TQ 3887 7732");
  expect(toOSGridRef(51.4778, -0.0016, 6)).toBe("TQ 388 773");
  expect(toOSGridRef(48.8566, 2.3522)).toBe("");
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
  await page.locator('input[type="file"][accept*=".json"]').setInputFiles({
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

test("field report summary stays inside the card on narrow Android viewports", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.route("https://services.arcgisonline.com/**", route => route.abort());
  await bootApp(page);

  const project = (await readIndexedDbStore(page, "projects") as any[])[0];
  const now = "2026-04-18T10:00:00.000Z";
  const permissionId = "mobile-report-permission";
  const sessionId = "mobile-report-session";

  await putIndexedDbRows(page, "permissions", [{
    id: permissionId,
    projectId: project.id,
    name: "Frolsworth Manor",
    type: "individual",
    lat: null,
    lon: null,
    gpsAccuracyM: null,
    collector: "Regression Detectorist",
    landType: "pasture",
    permissionGranted: true,
    notes: "",
    createdAt: now,
    updatedAt: now,
  }]);
  await putIndexedDbRows(page, "sessions", [{
    ...regressionSession(sessionId, project.id, permissionId, null, now),
    isFinished: true,
    startTime: "2026-04-18T10:00:00.000Z",
    endTime: "2026-04-18T13:20:00.000Z",
    keyNotes: ["All gates left as found"],
  }]);
  await putIndexedDbRows(page, "finds", [
    {
      ...regressionFind("mobile-find-1", project.id, permissionId, null, sessionId, now),
      objectType: "Coin",
      period: "Medieval",
      material: "Silver",
      coinDenomination: "Penny",
    },
    {
      ...regressionFind("mobile-find-2", project.id, permissionId, null, sessionId, now),
      objectType: "Coin",
      period: "Roman",
      material: "Copper alloy",
      coinDenomination: "Nummus",
    },
    {
      ...regressionFind("mobile-find-3", project.id, permissionId, null, sessionId, now),
      objectType: "Harness pendant",
      period: "Medieval",
      material: "Copper alloy",
    },
  ]);

  await page.goto(`./session/${sessionId}`);
  await page.getByRole("button", { name: "Field Report" }).click();
  await expect(page.getByRole("dialog")).toContainText("Preview");
  await expect(page.getByText("Key highlights")).toBeVisible();

  const layout = await page.evaluate(() => {
    const summary = Array.from(document.querySelectorAll<HTMLElement>("[data-pdf-block]"))
      .find(el => el.textContent?.includes("At a glance") && el.textContent?.includes("Key highlights"));
    if (!summary) throw new Error("Report summary block not found");

    const summaryRect = summary.getBoundingClientRect();
    const offenders = Array.from(summary.querySelectorAll<HTMLElement>("div"))
      .filter(el => {
        const text = (el.textContent || "").trim();
        if (!text || text === (summary.textContent || "").trim()) return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && (rect.left < summaryRect.left - 0.5 || rect.right > summaryRect.right + 0.5);
      })
      .map(el => {
        const rect = el.getBoundingClientRect();
        return {
          text: (el.textContent || "").trim().slice(0, 80),
          left: rect.left,
          right: rect.right,
        };
      });
    const keyLabel = Array.from(summary.querySelectorAll<HTMLElement>("div"))
      .find(el => (el.textContent || "").trim() === "Key highlights");
    const keyValue = keyLabel?.nextElementSibling as HTMLElement | null;
    const keyValueRect = keyValue?.getBoundingClientRect();

    return {
      offenders,
      summaryWidth: summaryRect.width,
      summaryRight: summaryRect.right,
      keyValueWidth: keyValueRect?.width ?? 0,
      keyValueRight: keyValueRect?.right ?? 0,
    };
  });

  expect(layout.summaryWidth).toBeGreaterThan(200);
  expect(layout.keyValueWidth).toBeGreaterThan(70);
  expect(layout.keyValueRight).toBeLessThanOrEqual(layout.summaryRight + 0.5);
  expect(layout.offenders).toEqual([]);
});

test("completed historic mobile sheet keeps context details and layer controls", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockFieldGuideHistoricScan(page);
  await page.addInitScript(() => {
    localStorage.setItem("fs_onboarding_v2_done", "1");
    localStorage.setItem("fs_onboarding_done", "1");
    localStorage.setItem("fs_fg_helpers_seen", "1");
    localStorage.setItem("fs_fg_sheet", "1");
  });

  await page.goto("./fieldguide?lat=53.3811&lng=-1.4701");
  await page.locator(".maplibregl-canvas").waitFor({ state: "visible" });
  await expect(page.getByText("Ready to Scan")).toBeVisible();

  await page.getByRole("button", { name: "Scan Area", exact: true }).click();

  await expect(page.getByText("Landscape Review", { exact: true })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText("Supporting Context", { exact: true })).toBeVisible();

  const layersButton = page.getByRole("button", { name: "Layers", exact: true });
  await expect(layersButton).toBeVisible();

  const detailsButton = page.getByRole("button", { name: "Details", exact: true });
  await detailsButton.scrollIntoViewIfNeeded();
  await expect(detailsButton).toBeVisible();
  await detailsButton.click();
  await expect(page.getByText("Movement Corridors & Roads")).toBeVisible();
  await expect(page.getByText("Regression Roman Road", { exact: true })).toBeVisible();
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
  await expect(page.getByLabel("Organiser Hub").getByText("What did today reveal?")).toBeVisible();
  await expect(page.getByLabel("Organiser Hub").getByText("More mapped finds are needed before a spatial pattern is useful.")).toBeVisible();

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

// ── Geology engine unit tests ─────────────────────────────────────────────────
// Pure function tests — no browser page required.

test("classifyGeology: chalk bedrock → chalk_downland", () => {
  const result = classifyGeology({ bedrockName: "CHALK FORMATION", bedrockLithology: "CHALK" });
  expect(result.landscapeClass).toBe("chalk_downland");
  expect(result.confidence).toBe("high");
});

test("classifyGeology: peat superficial → peat_fen", () => {
  const result = classifyGeology({ superficialLithology: "PEAT", superficialName: "FENLAND PEAT" });
  expect(result.landscapeClass).toBe("peat_fen");
  expect(result.confidence).toBe("high");
});

test("classifyGeology: alluvium superficial → alluvial_floodplain", () => {
  const result = classifyGeology({ superficialLithology: "ALLUVIUM", superficialName: "ALLUVIAL DEPOSIT" });
  expect(result.landscapeClass).toBe("alluvial_floodplain");
  expect(result.confidence).toBe("high");
});

test("classifyGeology: river terrace gravel → river_gravel_terrace", () => {
  const result = classifyGeology({ superficialLithology: "SAND AND GRAVEL", superficialName: "RIVER TERRACE DEPOSITS (UNDIFFERENTIATED)" });
  expect(result.landscapeClass).toBe("river_gravel_terrace");
  expect(result.confidence).toBe("high");
});

test("classifyGeology: clay bedrock → heavy_clay", () => {
  const result = classifyGeology({ bedrockLithology: "MUDSTONE", bedrockName: "OXFORD CLAY FORMATION" });
  expect(result.landscapeClass).toBe("heavy_clay");
  expect(result.confidence).toBe("high");
});

test("classifyGeology: loose sand superficial → sand_gravel", () => {
  const result = classifyGeology({ superficialLithology: "BLOWN SAND", superficialName: "SAND DUNES" });
  expect(result.landscapeClass).toBe("sand_gravel");
  expect(result.confidence).toBe("medium");
});

test("classifyGeology: SANDSTONE bedrock alone does NOT map to sand_gravel", () => {
  // Regression: consolidated sandstone bedrock should not get loose-deposit migration advice.
  const result = classifyGeology({ bedrockLithology: "SANDSTONE", bedrockName: "OLD RED SANDSTONE" });
  expect(result.landscapeClass).toBe("mixed_uncertain");
});

test("classifyGeology: no data → unknown", () => {
  const result = classifyGeology({});
  expect(result.landscapeClass).toBe("unknown");
  expect(result.confidence).toBe("low");
});

test("classifyGeology: artificial ground appends caution regardless of class", () => {
  const result = classifyGeology({
    bedrockLithology: "CHALK",
    artificialGround: { present: true, type: "made_ground" },
  });
  expect(result.landscapeClass).toBe("chalk_downland");
  expect(result.explanation.some(e => e.includes("artificial ground"))).toBe(true);
});

test("buildGeologyDisplay: chalk_downland produces correct labels and no cautions", () => {
  const ctx: GeologyContext = {
    tileKey: "geology:gcpvj2:classifier:v2:source:bgs625k-v2",
    centroid: { lat: 51.0, lon: -1.5 },
    source: { bedrock: "BGS_625K" },
    raw: { bedrockName: "CHALK FORMATION", bedrockLithology: "CHALK" },
    landscapeClass: "chalk_downland",
    confidence: "high",
    modifiers: { hydrology: 0, terrain: 0, spectral: 0, route: 0, soilMechanics: 0, preservation: 0, movementRisk: 0 },
    explanation: ["Chalk bedrock mapped."],
    fetchedAt: Date.now(),
    classifierVersion: 2,
    sourceVersion: "bgs625k-v2",
  };
  const display = buildGeologyDisplay(ctx);
  expect(display.landscapeLabel).toBe("Chalk Downland");
  expect(display.confidenceLabel).toBe("High confidence");
  expect(display.cautions).toHaveLength(0);
  expect(display.phaseNote).toContain("Scoring adjustments are active");
});

test("buildGeologyDisplay: artificial ground adds caution string", () => {
  const ctx: GeologyContext = {
    tileKey: "geology:gcpvj2:classifier:v2:source:bgs625k-v2",
    centroid: { lat: 51.5, lon: -0.1 },
    source: {},
    raw: { artificialGround: { present: true, type: "made_ground" } },
    landscapeClass: "mixed_uncertain",
    confidence: "low",
    modifiers: { hydrology: 0, terrain: 0, spectral: 0, route: 0, soilMechanics: 0, preservation: 0, movementRisk: 0 },
    explanation: [],
    fetchedAt: Date.now(),
    classifierVersion: 2,
    sourceVersion: "bgs625k-v2",
  };
  const display = buildGeologyDisplay(ctx);
  expect(display.cautions).toHaveLength(1);
  expect(display.cautions[0]).toContain("made ground");
});

test("fetchBgsGeology: returns timedOut=true when request exceeds timeout", async () => {
  // Override global fetch with a never-resolving stub and a short timeout override.
  const origFetch = globalThis.fetch;
  const origSetTimeout = globalThis.setTimeout;
  const origClearTimeout = globalThis.clearTimeout;
  // Immediately fire the abort timeout (timeout = 0ms effectively)
  globalThis.fetch = (_url: unknown, init?: RequestInit) => {
    return new Promise<Response>((_resolve, reject) => {
      const abort = () => reject(new DOMException("Aborted", "AbortError"));
      if (init?.signal?.aborted) abort();
      else init?.signal?.addEventListener("abort", abort);
    });
  };
  // Replace setTimeout to fire immediately (simulates instant timeout)
  (globalThis as any).setTimeout = (fn: () => void, _delay: number) => {
    fn();
    return 0;
  };
  (globalThis as any).clearTimeout = () => {};

  try {
    const result = await fetchBgsGeology({ lat: 51.5, lon: -1.5 });
    expect(result.timedOut).toBe(true);
    expect(result.data).toBeNull();
  } finally {
    globalThis.fetch = origFetch;
    globalThis.setTimeout = origSetTimeout;
    globalThis.clearTimeout = origClearTimeout;
  }
});

test("classifyGeology: tidal flat → foreshore (not peat_fen)", () => {
  const result = classifyGeology({
    superficialLithology: "TIDAL FLAT",
    superficialName: "ESTUARINE DEPOSITS",
  });
  expect(result.landscapeClass).toBe("foreshore");
  expect(result.confidence).toBe("high");
});

test("applyGeologyModifiers: gates on primary signals and refreshes score ordering", () => {
  const boosted = regressionHotspot("boosted", 54, {
    anomaly: 12,
    context: 7,
    convergence: 0,
    behaviour: 6,
    penalty: 0,
    signalCount: 2,
    signalClassCount: 2,
  });
  const suppressed = regressionHotspot("suppressed", 58, {
    anomaly: 0,
    context: 0,
    convergence: 8,
    behaviour: 8,
    penalty: 0,
    signalCount: 1,
    signalClassCount: 1,
  });
  const ctx: GeologyContext = {
    tileKey: "geology:gcpvj2:classifier:v2:source:bgs625k-v2",
    centroid: { lat: 51.0, lon: -1.5 },
    source: { bedrock: "BGS_625K" },
    raw: { bedrockName: "CHALK FORMATION", bedrockLithology: "CHALK" },
    landscapeClass: "chalk_downland",
    confidence: "high",
    modifiers: { hydrology: 3, terrain: 2, route: 2, preservation: 0, soilMechanics: 0, spectral: 0, movementRisk: 0 },
    explanation: ["Chalk bedrock mapped."],
    fetchedAt: Date.now(),
    classifierVersion: 2,
    sourceVersion: "bgs625k-v2",
  };

  const result = applyGeologyModifiers([suppressed, boosted], ctx);

  expect(result.appliedCount).toBe(1);
  expect(result.suppressedCount).toBe(1);
  expect(result.hotspots[0].id).toBe("boosted");
  expect(result.hotspots[0].number).toBe(1);
  expect(result.hotspots[0].score).toBe(61);
  expect(result.hotspots[0].confidence).toBe("Strong Signal");
  expect(result.hotspots[1].id).toBe("suppressed");
  expect(result.hotspots[1].score).toBe(58);
});

test("fetchBgsGeology: empty GML feature collection returns data=null", async () => {
  const origFetch = globalThis.fetch;
  const EMPTY_GML = '<?xml version="1.0" encoding="UTF-8"?><FeatureCollection xmlns:gml="http://www.opengis.net/gml"/>';
  globalThis.fetch = async () => new Response(EMPTY_GML, {
    status: 200,
    headers: { "Content-Type": "application/vnd.ogc.gml" },
  });
  try {
    const result = await fetchBgsGeology({ lat: 51.5, lon: -1.5 });
    expect(result.data).toBeNull();
    expect(result.timedOut).toBe(false);
    expect(result.corsError).toBe(false);
  } finally {
    globalThis.fetch = origFetch;
  }
});
