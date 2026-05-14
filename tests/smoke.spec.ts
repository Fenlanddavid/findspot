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
  await expect(page.getByText("Smoke Test Buckle")).toBeVisible();
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

  page.on("dialog", (dialog) => dialog.accept());
  await page.goto(`./permission/${permissionId}`);
  await page.getByRole("button", { name: "Delete" }).click();
  await expect(page).toHaveURL(/\/$/);

  const [permissions, sessions, finds] = await Promise.all([
    readIndexedDbStore(page, "permissions"),
    readIndexedDbStore(page, "sessions"),
    readIndexedDbStore(page, "finds"),
  ]);
  expect((permissions as any[]).some((row) => row.id === permissionId)).toBe(false);
  expect((sessions as any[]).some((row) => row.permissionId === permissionId)).toBe(false);
  expect((finds as any[]).some((row) => row.permissionId === permissionId)).toBe(false);
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
  await expect(page.getByText("Protected").first()).toBeVisible();

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
  await page.getByRole("button", { name: "Confirm Import" }).click();

  await page.waitForLoadState("networkidle");
  await page.goto("./");
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
  await expect(page.getByRole("button", { name: "Smoke Club Rally" })).toBeVisible();
});
