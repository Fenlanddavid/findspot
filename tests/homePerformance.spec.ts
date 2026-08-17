import { expect, test, type Page } from "./fixtures";

type StartupLayoutMetrics = {
  total: number;
  largest: number;
  entries: Array<{
    value: number;
    sources: string[];
  }>;
};

declare global {
  interface Window {
    __findspotStartupLayoutShifts?: StartupLayoutMetrics["entries"];
    __findspotTrackReads?: string[];
  }
}

async function installTrackReadObserver(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.__findspotTrackReads = [];
    const indexPrototype = IDBIndex.prototype as IDBIndex & Record<string, unknown>;
    for (const method of ['get', 'getAll', 'getAllKeys', 'openCursor', 'openKeyCursor', 'count']) {
      const original = indexPrototype[method];
      if (typeof original !== 'function') continue;
      indexPrototype[method] = function (this: IDBIndex, ...args: unknown[]) {
        if (this.objectStore.name === 'tracks') window.__findspotTrackReads!.push(`index:${method}`);
        return (original as (...callArgs: unknown[]) => unknown).apply(this, args);
      };
    }
    const storePrototype = IDBObjectStore.prototype as IDBObjectStore & Record<string, unknown>;
    for (const method of ['get', 'getAll', 'getAllKeys', 'openCursor', 'openKeyCursor', 'count']) {
      const original = storePrototype[method];
      if (typeof original !== 'function') continue;
      storePrototype[method] = function (this: IDBObjectStore, ...args: unknown[]) {
        if (this.name === 'tracks') window.__findspotTrackReads!.push(`store:${method}`);
        return (original as (...callArgs: unknown[]) => unknown).apply(this, args);
      };
    }
  });
}

async function installLayoutShiftObserver(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.__findspotStartupLayoutShifts = [];
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as Array<PerformanceEntry & {
        value: number;
        hadRecentInput: boolean;
        sources?: Array<{ node?: Node | null }>;
      }>) {
        if (entry.hadRecentInput) continue;
        window.__findspotStartupLayoutShifts?.push({
          value: entry.value,
          sources: (entry.sources ?? []).map((source) => {
            const element = source.node instanceof Element ? source.node : null;
            return [
              element?.tagName ?? "unknown",
              element?.getAttribute("class") ?? "",
              element?.textContent?.trim().slice(0, 80) ?? "",
            ].join(" ");
          }),
        });
      }
    }).observe({ type: "layout-shift", buffered: true });
  });
}

async function readStartupLayoutMetrics(page: Page): Promise<StartupLayoutMetrics> {
  await page.waitForTimeout(750);
  return page.evaluate(() => {
    const entries = window.__findspotStartupLayoutShifts ?? [];
    return {
      total: entries.reduce((sum, entry) => sum + entry.value, 0),
      largest: entries.reduce((largest, entry) => Math.max(largest, entry.value), 0),
      entries,
    };
  });
}

async function createPermission(page: Page, name: string): Promise<void> {
  await page.goto("./permission");
  await page.getByLabel("Permission Name / Location").fill(name);
  await page.getByRole("button", { name: "Create Record" }).click();
  await expect(page).toHaveURL(/\/permission\/[^/?#]+$/);
}

async function durableSetting(page: Page, key: string): Promise<unknown> {
  return page.evaluate((settingKey) => new Promise((resolve, reject) => {
    const request = indexedDB.open("findspot_uk");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const tx = request.result.transaction("settings", "readonly");
      const row = tx.objectStore("settings").get(settingKey);
      row.onerror = () => reject(row.error);
      row.onsuccess = () => resolve(row.result?.value);
    };
  }), key);
}

async function seedDenseCompanionTrack(page: Page, permissionName: string): Promise<void> {
  await page.evaluate(({ name }) => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('findspot_uk');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const read = database.transaction('permissions', 'readonly');
      const permissions = read.objectStore('permissions').getAll();
      permissions.onerror = () => reject(permissions.error);
      permissions.onsuccess = () => {
        const permission = permissions.result.find((row: { name?: string }) => row.name === name);
        if (!permission) {
          reject(new Error('Performance permission was not found.'));
          return;
        }
        const sessionId = 'dense-companion-session';
        const now = new Date().toISOString();
        const write = database.transaction(['sessions', 'tracks'], 'readwrite');
        write.onerror = () => reject(write.error);
        write.oncomplete = () => resolve();
        write.objectStore('sessions').put({
          id: sessionId,
          projectId: permission.projectId,
          permissionId: permission.id,
          fieldId: null,
          date: now,
          isFinished: true,
          createdAt: now,
          updatedAt: now,
        });
        write.objectStore('tracks').put({
          id: 'dense-companion-track',
          projectId: permission.projectId,
          sessionId,
          name: 'Dense Companion track',
          points: Array.from({ length: 25_000 }, (_, index) => ({
            lat: 52 + index / 10_000_000,
            lon: index / 10_000_000,
            timestamp: index * 5_000,
            accuracy: 4,
          })),
          isActive: false,
          color: '#10b981',
          createdAt: now,
          updatedAt: now,
          sourceRecordingUuid: 'performance-recording',
          sourceSegmentIndex: 0,
        });
      };
    };
  }), { name: permissionName });
}

test.use({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  hasTouch: true,
  isMobile: true,
});

test.beforeEach(async ({ page }) => {
  page.on("pageerror", (error) => {
    throw error;
  });
});

test("fresh-install Home resolves first-run data without a layout jump", async ({ page }) => {
  await installLayoutShiftObserver(page);
  await page.goto("./");

  await expect(page.getByText("Build your first field record")).toBeVisible();
  await expect(page.getByText("Add one when you are ready to keep landowner, field and session records together.")).toBeVisible();
  await expect(page.getByPlaceholder("Search permissions...")).toHaveCount(0);

  const metrics = await readStartupLayoutMetrics(page);
  expect(metrics.total, JSON.stringify(metrics.entries, null, 2)).toBeLessThanOrEqual(0.02);
  expect(metrics.largest, JSON.stringify(metrics.entries, null, 2)).toBeLessThanOrEqual(0.01);
});

test("returning-user Home waits for persisted records before presenting its layout", async ({ page }) => {
  await page.goto("./");
  await page.getByRole("button", { name: "Skip Quick Start" }).click();
  await expect.poll(() => durableSetting(page, "fs_onboarding_v2_done")).toBe(true);
  await createPermission(page, "Performance Characterization Farm");

  await installLayoutShiftObserver(page);
  await page.goto("./");

  await expect(page.getByRole("button", { name: "Performance Characterization Farm", exact: true })).toBeVisible();
  await expect(page.getByPlaceholder("Search permissions...")).toBeVisible();
  await expect(page.getByText("Build your first field record")).toHaveCount(0);

  const metrics = await readStartupLayoutMetrics(page);
  expect(metrics.total, JSON.stringify(metrics.entries, null, 2)).toBeLessThanOrEqual(0.02);
  expect(metrics.largest, JSON.stringify(metrics.entries, null, 2)).toBeLessThanOrEqual(0.01);
});

test('returning-user Home does not read a dense Companion trail on launch', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('button', { name: 'Skip Quick Start' }).click();
  await expect.poll(() => durableSetting(page, 'integrityAuditSchemaVersion'))
    .toEqual(expect.any(Number));
  await createPermission(page, 'Dense Companion Farm');
  await seedDenseCompanionTrack(page, 'Dense Companion Farm');
  await installTrackReadObserver(page);

  await page.goto('./');
  await expect(page.getByRole('button', { name: 'Dense Companion Farm', exact: true })).toBeVisible();
  await page.waitForTimeout(1_000);
  expect(await page.evaluate(() => window.__findspotTrackReads)).toEqual([]);
});
