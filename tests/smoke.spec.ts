import { readFile } from "node:fs/promises";
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

test.beforeEach(async ({ page }) => {
  page.on("pageerror", (error) => {
    throw error;
  });
});

test("home, settings and discover routes render without crashing", async ({ page }) => {
  await page.goto("./");
  await dismissNonBlockingPrompts(page);
  await expect(page).toHaveTitle(/FindSpot UK/);
  await expect(page.getByText("Local-first storage")).toBeVisible();

  await page.getByRole("button", { name: /Local-first storage/ }).click();
  await expect(page.getByText("Your saved finds")).toBeVisible();

  await page.getByRole("link", { name: "Settings" }).click();
  await expect(page.getByText("Privacy Guarantee")).toBeVisible();
  await expect(page.getByText("Saved finds, permissions")).toBeVisible();

  await page.getByRole("link", { name: "Discover" }).click();
  await expect(page).toHaveURL(/\/discover$/);
});

test("can create a permission, start a session and save a find", async ({ page }) => {
  await createPermission(page, "Smoke Test Farm");

  await page.getByRole("button", { name: /\+ Start New Session/ }).click();
  await expect(page).toHaveURL(/\/session\/new/);
  await page.getByRole("button", { name: "Start Session" }).click();
  await expect(page).toHaveURL(/\/session\/[^/?#]+$/);
  await expect(page.getByText("Session Details")).toBeVisible();

  await page.getByRole("button", { name: "Add Find to Session" }).click();
  await expect(page).toHaveURL(/\/find\?/);
  await page.getByLabel("Title / Description").fill("Smoke Test Buckle");
  await page.getByRole("button", { name: "Save Find" }).click();
  await expect(page.getByRole("button", { name: "Saved" })).toBeVisible();

  await page.getByRole("button", { name: "Back to Session" }).click();
  await expect(page.getByRole("button").filter({ hasText: "Smoke Test Buckle" })).toBeVisible();
});

test("organiser rally setup continues to share link generation", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("./");
  await dismissNonBlockingPrompts(page);

  await page.getByRole("button", { name: "Club/Rally tools" }).click();
  await page.getByRole("button", { name: "Set Up Club Day" }).click();
  await page.getByRole("button", { name: "Create New Rally" }).click();

  await expect(page.getByText("Setting up a club/rally?")).toBeVisible();
  await page.getByLabel("Rally / Event Name").fill("Smoke Organiser Rally");
  await page.getByRole("button", { name: "Save & Generate Link" }).click();

  await expect(page).toHaveURL(/\/permission\/[^/?#]+\?openClubDay=true$/);
  await expect(page.getByRole("heading", { name: "Set Up Club/Rally" })).toBeVisible();

  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Landowner details, agreements and private notes will not be shared with members.").check();
  await dialog.getByRole("button", { name: "Generate Share Link" }).click();

  await expect(page.getByText("Share Join Link")).toBeVisible();
  await expect(page.getByText(/\/findspot\/join\?pack=/)).toBeVisible();
});

test("saved organiser rally opens to the organiser hub before link generation", async ({ page }) => {
  await page.goto("./permission?type=rally");
  await page.getByLabel("Rally / Event Name").fill("Smoke Hub Rally");
  await page.getByLabel("Organiser / Contact Name").fill("Smoke Rally Club");
  await page.getByRole("button", { name: "Save Rally" }).click();
  await expect(page).toHaveURL(/\/permission\/[^/?#]+$/);

  const hub = page.getByRole("region", { name: "Organiser Hub" });
  await expect(hub).toBeVisible();
  await expect(hub).toContainText("Setup needed");
  await expect(hub).toContainText("Day Summary");
  await expect(hub).toContainText("Once members send exports back, the finds summary appears here in the hub.");
  await expect(hub.getByRole("button", { name: "Generate Join Link" })).toBeVisible();
  await expect(hub.getByRole("button", { name: "Generate Link First" })).toBeVisible();

  await hub.getByRole("button", { name: "Club/Rally Agreement" }).click();
  const agreement = page.getByRole("dialog", { name: "Club/Rally Agreement" });
  await agreement.getByRole("button", { name: "Edit Template" }).click();
  await expect(agreement.getByRole("textbox", { name: "Landowner / occupier" })).toHaveValue("");
  await expect(agreement.getByRole("textbox", { name: "Organiser", exact: true })).toHaveValue("Smoke Rally Club");
});

test("existing individual permission becomes a club/rally permission when shared", async ({ page }) => {
  await createPermission(page, "Existing Rally Field");
  const permissionId = page.url().match(/\/permission\/([^/?#]+)$/)?.[1];
  if (!permissionId) throw new Error("Could not read created permission id from URL");

  await page.goto(`./permission/${permissionId}?openClubDay=true`);
  await expect(page.getByRole("heading", { name: "Set Up Club/Rally" })).toBeVisible();

  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Landowner details, agreements and private notes will not be shared with members.").check();
  await dialog.getByRole("button", { name: "Generate Share Link" }).click();
  await expect(page.getByText("Share Join Link")).toBeVisible();

  const permissions = await readIndexedDbStore(page, "permissions") as any[];
  const converted = permissions.find((row) => row.id === permissionId);
  expect(converted).toMatchObject({
    type: "rally",
    isSharedPermission: true,
  });
  expect(converted.sharedPermissionId).toEqual(expect.any(String));

  await page.getByRole("dialog").locator("button").first().click();
  await expect(page.getByRole("heading", { name: "Rally Details" })).toBeVisible();
  const hub = page.getByRole("region", { name: "Organiser Hub" });
  await expect(hub).toBeVisible();
  await expect(hub).toContainText("Join link ready");
  await expect(hub.getByRole("button", { name: "Share Join Link" })).toBeVisible();
  await expect(hub.getByRole("button", { name: "Import Member Data" })).toBeVisible();
});

test("active session mobile uses in-page actions without a redundant bottom bar", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await createPermission(page, "Mobile Session Farm");

  await page.getByRole("button", { name: /\+ Start New Session/ }).click();
  await page.getByRole("button", { name: "Start Session" }).click();
  await expect(page).toHaveURL(/\/session\/[^/?#]+$/);

  await expect(page.getByRole("toolbar", { name: "Active session actions" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Finish Session" })).toBeVisible();
  await page.getByRole("button", { name: "Add Find to Session" }).click();
  await expect(page).toHaveURL(/\/find\?/);
  await expect(page.getByRole("button", { name: "Significant Find" }).first()).toBeVisible();
});

test("significant find workflow saves a located notable record", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("fs_fab_used", "1");
  });
  await createPermission(page, "Significant Smoke Farm");

  const permissions = await readIndexedDbStore(page, "permissions") as any[];
  const realPermission = permissions.find((row) => row.name === "Significant Smoke Farm");
  expect(realPermission).toBeTruthy();

  await page.getByRole("button", { name: /\+ Start New Session/ }).click();
  await page.getByRole("button", { name: "Start Session" }).click();
  await expect(page).toHaveURL(/\/session\/[^/?#]+$/);
  await page.getByRole("button", { name: /Significant find/i }).click();
  await page.getByRole("button", { name: /Notable Find/i }).click();
  await page.getByRole("button", { name: /Skip photos/i }).click();
  await page.getByRole("button", { name: "Lock My Position" }).click();
  await expect(page.getByText(/Locked/)).toBeVisible();
  await page.getByRole("button", { name: /Location recorded/i }).click();
  await page.getByRole("button", { name: /Saved — describe the find/i }).click();
  await page.getByRole("button", { name: /Skip for now/i }).click();
  await expect(page.getByText("Record complete.")).toBeVisible();
  await page.getByRole("button", { name: /Done — view record/i }).click();

  await expect(page).toHaveURL(/\/finds-box\?tab=significant$/);
  await expect(page.getByText("Notable Find").first()).toBeVisible();

  const significantFinds = await readIndexedDbStore(page, "significantFinds") as any[];
  expect(significantFinds).toHaveLength(1);
  expect(significantFinds[0]).toMatchObject({
    path: "notable_find",
    status: "in_progress",
    permissionId: realPermission.id,
  });
  expect(significantFinds[0].lat).toEqual(expect.any(Number));
  expect(significantFinds[0].osGridRef).toEqual(expect.any(String));
});

test("deleting a permission removes its sessions and finds", async ({ page }) => {
  await createPermission(page, "Smoke Delete Farm");
  const permissionId = page.url().match(/\/permission\/([^/?#]+)$/)?.[1];
  expect(permissionId).toBeTruthy();

  await page.getByRole("button", { name: /\+ Start New Session/ }).click();
  await page.getByRole("button", { name: "Start Session" }).click();
  await page.getByRole("button", { name: "Add Find to Session" }).click();
  await page.getByLabel("Title / Description").fill("Smoke Delete Find");
  await page.getByRole("button", { name: "Save Find" }).click();
  await expect(page.getByRole("button", { name: "Saved" })).toBeVisible();

  const [projectsBeforeDelete, sessionsBeforeDelete] = await Promise.all([
    readIndexedDbStore(page, "projects"),
    readIndexedDbStore(page, "sessions"),
  ]);
  const projectId = (projectsBeforeDelete as any[])[0]?.id;
  const sessionId = (sessionsBeforeDelete as any[]).find((row) => row.permissionId === permissionId)?.id;
  if (!projectId || !sessionId) throw new Error("Could not prepare significant find delete fixture");

  await page.evaluate(({ projectId, permissionId, sessionId }) => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open("findspot_uk");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction(["significantFinds", "media"], "readwrite");
      tx.onerror = () => reject(tx.error);
      tx.oncomplete = () => resolve();
      const now = new Date().toISOString();
      tx.objectStore("significantFinds").put({
        id: "sig-delete-fixture",
        projectId,
        permissionId,
        sessionId,
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
        createdAt: now,
        updatedAt: now,
      });
      tx.objectStore("media").put({
        id: "sig-delete-media-fixture",
        projectId,
        findId: "sig-delete-fixture",
        type: "photo",
        photoType: "other",
        filename: "sig-delete-fixture.txt",
        mime: "text/plain",
        blob: new Blob(["fixture"], { type: "text/plain" }),
        caption: "Delete fixture",
        scalePresent: false,
        createdAt: now,
      });
    };
  }), { projectId, permissionId, sessionId });

  await page.goto(`./permission/${permissionId}`);
  await page.getByRole("button", { name: "Delete" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
  await expect(page).toHaveURL(/\/$/);

  const [permissions, sessions, finds, significantFinds, media] = await Promise.all([
    readIndexedDbStore(page, "permissions"),
    readIndexedDbStore(page, "sessions"),
    readIndexedDbStore(page, "finds"),
    readIndexedDbStore(page, "significantFinds"),
    readIndexedDbStore(page, "media"),
  ]);
  expect((permissions as any[]).some((row) => row.id === permissionId)).toBe(false);
  expect((sessions as any[]).some((row) => row.permissionId === permissionId)).toBe(false);
  expect((finds as any[]).some((row) => row.permissionId === permissionId)).toBe(false);
  expect((significantFinds as any[]).some((row) => row.permissionId === permissionId)).toBe(false);
  expect((media as any[]).some((row) => row.findId === "sig-delete-fixture")).toBe(false);
});

test("settings can export and restore a backup", async ({ page }) => {
  await createPermission(page, "Smoke Backup Permission");

  await page.goto("./settings");
  await dismissNonBlockingPrompts(page);
  const backupDownloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Backup JSON" }).click();
  const backupDownload = await backupDownloadPromise;
  expect(backupDownload.suggestedFilename()).toMatch(/^findspot-backup-\d{4}-\d{2}-\d{2}\.json$/);
  const backupPath = await backupDownload.path();
  expect(backupPath).toBeTruthy();
  const backup = JSON.parse(await readFile(backupPath!, "utf8"));
  expect((backup.permissions as any[]).some((row) => row.name === "Smoke Backup Permission")).toBe(true);
  await expect(page.getByText("Backup saved").first()).toBeVisible();

  const csvDownloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export CSV" }).click();
  const csvDownload = await csvDownloadPromise;
  const csvPath = await csvDownload.path();
  expect(csvPath).toBeTruthy();
  const csv = await readFile(csvPath!, "utf8");
  expect(csv).toContain("Find Code");
  expect(csv).toContain("Permission Name");

  const now = new Date().toISOString();
  const restore = {
    version: 2,
    exportedAt: now,
    projects: [{ id: "restored-project", name: "Restored Project", createdAt: now, updatedAt: now }],
    permissions: [{
      id: "restored-permission",
      projectId: "restored-project",
      name: "Restored Meadow",
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

  await page.locator('input[type="file"][accept=".json"]').setInputFiles({
    name: "restore.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(restore)),
  });
  await expect(page.getByText(/Restore "restore\.json"\?/)).toBeVisible();
  await page.getByLabel(/Type RESTORE/).fill("RESTORE");
  await Promise.all([
    page.waitForURL(/\/$/),
    page.getByRole("button", { name: "Confirm Import" }).click(),
  ]);
  await dismissNonBlockingPrompts(page);
  await expect(page.getByRole("button", { name: "Restored Meadow" })).toBeVisible();
});

test("Club Day join links can import an embedded pack with a mapped field", async ({ page }) => {
  const pack = {
    type: "findspot-club-day-pack",
    version: 1,
    sharedPermissionId: "smoke-shared-permission",
    eventName: "Smoke Club Rally",
    eventDate: "2026-05-13",
    organiserContactNumber: "07000000000",
    organiserEmail: "organiser@example.com",
    significantFindInstructions: "Stop and call the organiser.",
    publicNotes: "Meet by the gate.",
    boundary: {
      type: "Polygon",
      coordinates: [[[-1.471, 53.381], [-1.469, 53.381], [-1.469, 53.382], [-1.471, 53.382], [-1.471, 53.381]]],
    },
    fields: [
      {
        id: "field-a",
        projectId: "organiser-project",
        permissionId: "organiser-permission",
        name: "North Field",
        boundary: {
          type: "Polygon",
          coordinates: [[[-1.471, 53.381], [-1.47, 53.381], [-1.47, 53.382], [-1.471, 53.382], [-1.471, 53.381]]],
        },
        notes: "Smoke field",
        createdAt: "2026-05-13T00:00:00.000Z",
        updatedAt: "2026-05-13T00:00:00.000Z",
      },
    ],
    createdAt: "2026-05-13T00:00:00.000Z",
  };

  await page.goto(`./join?pack=${encodePack(pack)}`);
  await expect(page.getByRole("heading", { name: "Smoke Club Rally" })).toBeVisible();
  await page.getByPlaceholder("e.g. John Smith").fill("Smoke Detectorist");
  await page.getByRole("button", { name: /Join/i }).click();
  await expect(page.getByText("You're in!")).toBeVisible();

  await page.getByRole("button", { name: "Open FindSpot" }).click();
  await expect(page).toHaveURL(/\/permission\/[^/?#]+$/);
  await expect(page.getByRole("heading", { name: "Smoke Club Rally" })).toBeVisible();
  await expect(page.getByText("Stop and call the organiser.")).toBeVisible();

  const fields = await readIndexedDbStore(page, "fields");
  const importedField = (fields as any[]).find((row) => row.id === "field-a");
  expect(importedField?.name).toBe("North Field");
  expect(importedField?.boundary?.type).toBe("Polygon");
});
