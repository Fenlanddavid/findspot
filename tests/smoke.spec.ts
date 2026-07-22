import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "./fixtures";
import { strToU8, zipSync } from "fflate";

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

async function putIndexedDbRow(page: Page, storeName: string, row: object) {
  await page.evaluate(({ name, value }) => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open("findspot_uk");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const tx = request.result.transaction(name, "readwrite");
      tx.onerror = () => reject(tx.error);
      tx.oncomplete = () => resolve();
      tx.objectStore(name).put(value);
    };
  }), { name: storeName, value: row });
}

async function putIndexedDbRows(page: Page, storeName: string, rows: object[]) {
  await page.evaluate(({ name, values }) => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open("findspot_uk");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const tx = request.result.transaction(name, "readwrite");
      tx.onerror = () => reject(tx.error);
      tx.oncomplete = () => resolve();
      const store = tx.objectStore(name);
      for (const value of values) store.put(value);
    };
  }), { name: storeName, values: rows });
}

test.beforeEach(async ({ page }) => {
  await page.route('https://findspot-geocode.trials-uk.workers.dev/**', route => {
    const url = new URL(route.request().url());
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(url.pathname === '/search'
        ? []
        : { address: { parish: 'Smoke Parish', county: 'Smokeshire' } }),
    });
  });
  await page.addInitScript(() => {
    localStorage.setItem("fs_onboarding_v2_done", "1");
    localStorage.setItem("fs_onboarding_done", "1");
  });
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
  await page.getByRole("button", { name: "App" }).click();
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

test("saved solo rally becomes an organiser hub after link generation", async ({ page }) => {
  await page.goto("./permission?type=rally");
  await page.getByLabel("Rally / Event Name").fill("Smoke Hub Rally");
  await page.getByLabel("Organiser / Contact Name").fill("Smoke Rally Club");
  await page.getByRole("button", { name: "Save Rally" }).click();
  await expect(page).toHaveURL(/\/permission\/[^/?#]+$/);

  await expect(page.getByRole("region", { name: "Organiser Hub" })).toHaveCount(0);
  await page.getByRole("button", { name: /Create a join pack/ }).click();
  const shareDialog = page.getByRole("dialog");
  await shareDialog.getByLabel("Landowner details, agreements and private notes will not be shared with members.").check();
  await shareDialog.getByRole("button", { name: "Generate Share Link" }).click();
  await expect(page.getByText("Share Join Link")).toBeVisible();
  await shareDialog.locator("button").first().click();

  const hub = page.getByRole("region", { name: "Organiser Hub" });
  await expect(hub).toBeVisible();
  await expect(hub).toContainText("Join link ready");
  await expect(hub).toContainText("Day Summary");
  await expect(hub).toContainText("Import member data to build the finds summary");
  await expect(hub.getByRole("button", { name: "Share join link" })).toBeVisible();
  await expect(hub.getByRole("button", { name: "Import member data" })).toBeVisible();

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

test("deleting a significant record removes only its linked finds and media", async ({ page }) => {
  await createPermission(page, "Significant Cascade Farm");
  const permissionId = page.url().match(/\/permission\/([^/?#]+)$/)?.[1];
  const [project] = await readIndexedDbStore(page, "projects") as any[];
  if (!permissionId || !project?.id) throw new Error("Could not prepare significant cascade fixture");

  const now = new Date().toISOString();
  const find = (id: string, objectType: string) => ({
    id,
    projectId: project.id,
    permissionId,
    fieldId: null,
    sessionId: null,
    findCode: id,
    objectType,
    lat: null,
    lon: null,
    gpsAccuracyM: null,
    osGridRef: "",
    w3w: "",
    period: "Unknown",
    material: "Other",
    notes: "",
    createdAt: now,
    updatedAt: now,
  });

  await putIndexedDbRows(page, "finds", [
    find("cascade-linked", "Linked notable find"),
    { ...find("cascade-scatter", "Scatter find"), scatterId: "cascade-group" },
    find("keep-unrelated-find", "Unrelated find"),
  ]);
  await putIndexedDbRow(page, "significantFinds", {
    id: "cascade-significant",
    projectId: project.id,
    permissionId,
    sessionId: null,
    path: "map_scatter",
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
    scatterId: "cascade-group",
    scatterFindIds: ["cascade-scatter"],
    linkedFindId: "cascade-linked",
    treasureActDraft: "",
    landownerSummary: "",
    findDescription: "Cascade scatter",
    createdAt: now,
    updatedAt: now,
  });
  await page.evaluate(({ projectId, createdAt }) => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open("findspot_uk");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const tx = request.result.transaction("media", "readwrite");
      tx.onerror = () => reject(tx.error);
      tx.oncomplete = () => resolve();
      const store = tx.objectStore("media");
      for (const [id, findId] of [
        ["cascade-significant-media", "cascade-significant"],
        ["cascade-linked-media", "cascade-linked"],
        ["cascade-scatter-media", "cascade-scatter"],
        ["keep-unrelated-media", "keep-unrelated-find"],
      ]) {
        store.put({
          id,
          projectId,
          findId,
          type: "photo",
          photoType: "other",
          filename: `${id}.txt`,
          mime: "text/plain",
          blob: new Blob([id], { type: "text/plain" }),
          caption: "Significant cascade fixture",
          scalePresent: false,
          createdAt,
        });
      }
    };
  }), { projectId: project.id, createdAt: now });

  await page.goto("./finds-box?tab=significant");
  await page.getByRole("button", { name: /Cascade scatter/ }).click();
  await page.getByRole("button", { name: "Delete record" }).click();
  const dialog = page.getByRole("dialog", { name: "Delete Record?" });
  await dialog.getByRole("button", { name: "Delete", exact: true }).click();

  const [significantFinds, finds, media] = await Promise.all([
    readIndexedDbStore(page, "significantFinds"),
    readIndexedDbStore(page, "finds"),
    readIndexedDbStore(page, "media"),
  ]) as any[][];
  expect(significantFinds.map(row => row.id)).not.toContain("cascade-significant");
  expect(finds.map(row => row.id)).toEqual(["keep-unrelated-find"]);
  expect(media.map(row => row.id)).toEqual(["keep-unrelated-media"]);
});

test("field guide saves and deletes a named map point", async ({ page }) => {
  await page.route("https://a.tile.openstreetmap.org/**", route => route.abort());
  await page.route("https://services.arcgisonline.com/**", route => route.abort());
  await page.goto("./fieldguide?lat=53.3811&lng=-1.4701");
  await page.locator(".maplibregl-canvas").waitFor({ state: "visible" });

  await page.getByRole("button", { name: "Map layers" }).click();
  await page.getByRole("button", { name: "Save This Point" }).click();
  await page.getByPlaceholder("Name this point...").fill("Boundary point");
  await page.getByRole("button", { name: "Save", exact: true }).click();

  const saved = await readIndexedDbStore(page, "savedPoints") as any[];
  expect(saved).toHaveLength(1);
  expect(saved[0]).toMatchObject({ label: "Boundary point", projectId: expect.any(String) });
  expect(saved[0].lat).toEqual(expect.any(Number));
  expect(saved[0].lon).toEqual(expect.any(Number));
  expect(saved[0].zoom).toEqual(expect.any(Number));

  await page.getByRole("button", { name: "Map layers" }).click();
  await page.getByRole("button", { name: /Saved Points \(1\)/ }).click();
  await expect(page.getByText("Boundary point", { exact: true })).toBeVisible();
  await page.getByTitle("Delete").click();
  await page.getByTitle("Tap again to confirm delete").click();
  await expect(page.getByText("No saved points yet.")).toBeVisible();
  expect(await readIndexedDbStore(page, "savedPoints")).toEqual([]);
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

test("deleting a session removes only its linked finds, significant finds, media and tracks", async ({ page }) => {
  await createPermission(page, "Session Cascade Farm");
  const permissionId = page.url().match(/\/permission\/([^/?#]+)$/)?.[1];
  const [project] = await readIndexedDbStore(page, "projects") as any[];
  if (!permissionId || !project?.id) throw new Error("Could not prepare session cascade fixture");

  const now = new Date().toISOString();
  const session = (id: string) => ({
    id,
    projectId: project.id,
    permissionId,
    fieldId: null,
    date: now,
    lat: null,
    lon: null,
    gpsAccuracyM: null,
    landUse: "",
    cropType: "",
    isStubble: false,
    notes: "",
    isFinished: true,
    createdAt: now,
    updatedAt: now,
  });
  const find = (id: string, sessionId: string) => ({
    id,
    projectId: project.id,
    permissionId,
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
    notes: "",
    createdAt: now,
    updatedAt: now,
  });
  const track = (id: string, sessionId: string) => ({
    id,
    projectId: project.id,
    sessionId,
    name: "Test track",
    points: [],
    isActive: false,
    color: "#ffffff",
    createdAt: now,
    updatedAt: now,
  });

  await putIndexedDbRows(page, "sessions", [session("delete-session"), session("keep-session")]);
  await putIndexedDbRows(page, "finds", [
    find("delete-find", "delete-session"),
    find("keep-find", "keep-session"),
  ]);
  await putIndexedDbRow(page, "significantFinds", {
    id: "delete-significant",
    projectId: project.id,
    permissionId,
    sessionId: "delete-session",
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
    createdAt: now,
    updatedAt: now,
  });
  await page.evaluate(({ projectId, createdAt }) => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open("findspot_uk");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const tx = request.result.transaction("media", "readwrite");
      tx.onerror = () => reject(tx.error);
      tx.oncomplete = () => resolve();
      const store = tx.objectStore("media");
      for (const [id, findId] of [
        ["delete-find-media", "delete-find"],
        ["delete-significant-media", "delete-significant"],
        ["keep-media", "keep-find"],
      ]) {
        store.put({
          id,
          projectId,
          findId,
          type: "photo",
          photoType: "other",
          filename: `${id}.txt`,
          mime: "text/plain",
          blob: new Blob([id], { type: "text/plain" }),
          caption: "Session cascade fixture",
          scalePresent: false,
          createdAt,
        });
      }
    };
  }), { projectId: project.id, createdAt: now });
  await putIndexedDbRows(page, "tracks", [
    track("delete-track", "delete-session"),
    track("keep-track", "keep-session"),
  ]);

  await page.goto("./session/delete-session");
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Delete Session?" });
  await expect(dialog).toContainText("1 find");
  await expect(dialog).toContainText("1 significant find");
  await expect(dialog).toContainText("2 photos/documents");
  await expect(dialog).toContainText("1 GPS track");
  await dialog.getByRole("button", { name: "Delete" }).click();
  await expect(page).toHaveURL(new RegExp(`/permission/${permissionId}$`));

  const [sessions, finds, significantFinds, storedMedia, tracks] = await Promise.all([
    readIndexedDbStore(page, "sessions"),
    readIndexedDbStore(page, "finds"),
    readIndexedDbStore(page, "significantFinds"),
    readIndexedDbStore(page, "media"),
    readIndexedDbStore(page, "tracks"),
  ]) as any[][];
  expect(sessions.map(row => row.id)).toContain("keep-session");
  expect(sessions.map(row => row.id)).not.toContain("delete-session");
  expect(finds.map(row => row.id)).toContain("keep-find");
  expect(finds.map(row => row.id)).not.toContain("delete-find");
  expect(significantFinds.map(row => row.id)).not.toContain("delete-significant");
  expect(storedMedia.map(row => row.id)).toEqual(["keep-media"]);
  expect(tracks.map(row => row.id)).toContain("keep-track");
  expect(tracks.map(row => row.id)).not.toContain("delete-track");
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
  await page.getByRole("button", { name: "CSV", exact: true }).click();
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

  await page.locator('input[type="file"][accept*=".json"]').setInputFiles({
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
  await page.goto("./settings");
  await expect(page.getByText("Last Restore Report")).toBeVisible();
  await expect(page.getByText(/Recovery report: 2 imported, 0 skipped, 0 repaired, 0 damaged/)).toBeVisible();
});

test("backup reminder respects user data, a recent backup and snooze state", async ({ page }) => {
  await page.goto("./");
  await dismissNonBlockingPrompts(page);
  await expect(page.getByText("Backup Recommended")).toHaveCount(0);

  await createPermission(page, "Reminder Characterization Farm");
  await page.goto("./");
  await expect(page.getByText("Backup Recommended")).toBeVisible();

  await putIndexedDbRow(page, "settings", {
    key: "lastBackupDate",
    value: new Date().toISOString(),
  });
  await page.reload();
  await expect(page.getByText("Backup Recommended")).toHaveCount(0);

  const changedAt = new Date().toISOString();
  await putIndexedDbRows(page, "finds", Array.from({ length: 20 }, (_, index) => ({
    id: `urgent-find-${index}`,
    createdAt: changedAt,
    updatedAt: changedAt,
  })));
  await page.reload();
  await expect(page.getByText("Backup Urgent").first()).toBeVisible();
  await expect(page.getByText("20 finds have changed since your last backup.").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Later" })).toHaveCount(0);

  await putIndexedDbRow(page, "settings", {
    key: "lastBackupDate",
    value: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString(),
  });
  await putIndexedDbRow(page, "settings", {
    key: "backupSnoozedUntil",
    value: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  });
  await page.reload();
  await expect(page.getByText("Backup Recommended")).toHaveCount(0);
});

test("restore preview does not replace current data before confirmation", async ({ page }) => {
  await createPermission(page, "Preview Must Not Replace");
  const now = new Date().toISOString();
  const restore = {
    version: 6,
    exportedAt: now,
    projects: [{ id: "preview-project", name: "Preview Project", region: "England", createdAt: now }],
    permissions: [{
      id: "preview-permission", projectId: "preview-project", name: "Preview Backup Permission",
      type: "individual", createdAt: now, updatedAt: now,
    }],
  };

  await page.goto("./settings");
  await page.locator('input[type="file"][accept*=".json"]').setInputFiles({
    name: "preview-only.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(restore)),
  });

  await expect(page.getByText(/Restore "preview-only\.json"\?/)).toBeVisible();
  await expect(page.getByText("Backup to restore")).toBeVisible();
  await page.getByRole("button", { name: "Run Restore Drill" }).click();
  await expect(page.getByText("Ready to restore. Live data unchanged.")).toBeVisible();
  await expect(page.getByText(/Drill report: 2 imported, 0 skipped, 0 repaired, 0 damaged/)).toBeVisible();
  const permissions = await readIndexedDbStore(page, "permissions") as Array<{ name?: string }>;
  expect(permissions.some(row => row.name === "Preview Must Not Replace")).toBe(true);
  expect(permissions.some(row => row.name === "Preview Backup Permission")).toBe(false);
});

test("settings streams a full zip restore and preserves live data when staging fails", async ({ page }) => {
  await createPermission(page, "Data That Must Survive");
  const now = new Date().toISOString();
  const manifest = {
    version: 5,
    exportedAt: now,
    projects: [{ id: "zip-project", name: "Zip Project", region: "England", createdAt: now }],
    permissions: [{
      id: "zip-permission", projectId: "zip-project", name: "Restored Full Archive",
      type: "individual", collector: "", landType: "pasture", permissionGranted: true,
      lat: null, lon: null, gpsAccuracyM: null, notes: "", createdAt: now, updatedAt: now,
    }],
    fields: [],
    sessions: [],
    finds: [{
      id: "zip-find", projectId: "zip-project", permissionId: "zip-permission",
      sessionId: null, fieldId: null, findCode: "ZIP-1", objectType: "Coin", createdAt: now,
    }],
    significantFinds: [],
    tracks: [],
    media: [{
      id: "zip-media", projectId: "zip-project", findId: "zip-find", type: "photo",
      filename: "proof.bin", mime: "application/octet-stream", caption: "", scalePresent: false,
      createdAt: now, _zipEntry: "media/zip-media.bin",
    }],
    settings: [],
    importedPackages: [],
    savedPoints: [],
    undugSignals: [],
    findHotspotSignals: [],
    outstandingQuestions: [],
    questionNotes: [],
  };
  // Cross the 4 MB staging-chunk boundary so this exercises incremental media
  // persistence rather than a single in-memory Blob.
  const mediaBytes = new Uint8Array(5 * 1024 * 1024 + 17);
  for (let index = 0; index < mediaBytes.length; index += 1) mediaBytes[index] = index % 251;
  const expectedChecksum = mediaBytes.reduce((sum, value) => (sum + value) % 65_521, 0);
  // Media-first matches the older full-backup layout; new exports are
  // manifest-first, but existing user archives must remain restorable.
  const validZip = zipSync({
    "media/zip-media.bin": mediaBytes,
    "manifest.json": strToU8(JSON.stringify(manifest)),
  });

  await page.goto("./settings");
  await page.locator('input[type="file"][accept*=".zip"]').setInputFiles({
    name: "full-restore.zip",
    mimeType: "application/zip",
    buffer: Buffer.from(validZip),
  });
  await expect(page.getByText(/Restore "full-restore\.zip"\?/)).toBeVisible();
  await page.getByLabel(/Type RESTORE/).fill("RESTORE");
  await Promise.all([
    page.waitForURL(/\/$/),
    page.getByRole("button", { name: "Confirm Import" }).click(),
  ]);
  await dismissNonBlockingPrompts(page);
  await expect(page.getByRole("button", { name: "Restored Full Archive" })).toBeVisible();
  const restoredMedia = await page.evaluate(() => new Promise<{ size: number; checksum: number }>((resolve, reject) => {
    const request = indexedDB.open("findspot_uk");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const mediaRequest = request.result.transaction("media", "readonly").objectStore("media").get("zip-media");
      mediaRequest.onerror = () => reject(mediaRequest.error);
      mediaRequest.onsuccess = async () => {
        const bytes = new Uint8Array(await mediaRequest.result.blob.arrayBuffer());
        let checksum = 0;
        for (const value of bytes) checksum = (checksum + value) % 65_521;
        resolve({ size: bytes.byteLength, checksum });
      };
    };
  }));
  expect(restoredMedia).toEqual({ size: mediaBytes.byteLength, checksum: expectedChecksum });

  // The manifest is valid but its media payload is absent. Staging must fail
  // before the live replacement transaction, leaving the restored archive intact.
  const missingMediaZip = zipSync({ "manifest.json": strToU8(JSON.stringify(manifest)) });
  await page.goto("./settings");
  await page.locator('input[type="file"][accept*=".zip"]').setInputFiles({
    name: "missing-media.zip",
    mimeType: "application/zip",
    buffer: Buffer.from(missingMediaZip),
  });
  await page.getByLabel(/Type RESTORE/).fill("RESTORE");
  await page.getByRole("button", { name: "Confirm Import" }).click();
  await expect(page.getByText(/missing media entry media\/zip-media\.bin/)).toBeVisible();
  const permissions = await readIndexedDbStore(page, "permissions") as any[];
  expect(permissions.some(row => row.name === "Restored Full Archive")).toBe(true);
  const stagingDatabases = await page.evaluate(async () => {
    if (!indexedDB.databases) return [];
    return (await indexedDB.databases())
      .map(database => database.name ?? "")
      .filter(name => name.startsWith("findspot_restore_staging_"));
  });
  expect(stagingDatabases).toEqual([]);
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
