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
  }
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

  await expect(page.getByText("Performance Characterization Farm")).toBeVisible();
  await expect(page.getByPlaceholder("Search permissions...")).toBeVisible();
  await expect(page.getByText("Build your first field record")).toHaveCount(0);

  const metrics = await readStartupLayoutMetrics(page);
  expect(metrics.total, JSON.stringify(metrics.entries, null, 2)).toBeLessThanOrEqual(0.02);
  expect(metrics.largest, JSON.stringify(metrics.entries, null, 2)).toBeLessThanOrEqual(0.01);
});
