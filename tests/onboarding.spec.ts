import { expect, test, type Page } from "@playwright/test";

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

async function deleteDurableSettings(page: Page, keys: string[]): Promise<void> {
  await page.evaluate((settingKeys) => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open("findspot_uk");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const tx = request.result.transaction("settings", "readwrite");
      const store = tx.objectStore("settings");
      settingKeys.forEach(key => store.delete(key));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    };
  }), keys);
}

test.beforeEach(async ({ page }) => {
  page.on("pageerror", (error) => {
    throw error;
  });
});

test("fresh installs see onboarding despite the generated default permission", async ({ page }) => {
  await page.goto("./");

  const dialog = page.getByRole("dialog", { name: "Understand where people used the landscape" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Get Started" })).toBeFocused();

  const permissions = await page.evaluate(() => new Promise<Array<{ isDefault?: boolean }>>((resolve, reject) => {
    const request = indexedDB.open("findspot_uk");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const tx = request.result.transaction("permissions", "readonly");
      const rows = tx.objectStore("permissions").getAll();
      rows.onerror = () => reject(rows.error);
      rows.onsuccess = () => resolve(rows.result);
    };
  }));

  expect(permissions).toHaveLength(1);
  expect(permissions[0].isDefault).toBe(true);
  expect(await durableSetting(page, "fs_onboarding_v2_done")).not.toBe(true);
});

test("legacy false-completion flags are recovered and completion persists", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("fs_onboarding_done", "1");
  });
  await page.goto("./");

  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "Get Started" }).click();
  await page.getByRole("button", { name: "Set up your profile" }).click();
  await page.getByRole("button", { name: "Open Settings" }).click();
  await page.getByRole("button", { name: "Let's go" }).click();

  await expect(page).toHaveURL(/\/settings$/);
  await expect.poll(() => durableSetting(page, "fs_onboarding_v2_done")).toBe(true);
  await page.reload();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("onboarding behaves as a keyboard modal", async ({ page }) => {
  await page.goto("./");

  const dialog = page.getByRole("dialog", { name: "Understand where people used the landscape" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Get Started" })).toBeFocused();
  await expect(page.locator("body")).toHaveCSS("overflow", "hidden");

  await page.keyboard.press("Shift+Tab");
  await expect(dialog.getByRole("button", { name: "Skip Quick Start" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(dialog.getByRole("button", { name: "Get Started" })).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect.poll(() => durableSetting(page, "fs_onboarding_v2_done")).toBe(true);
});

test("users with a real permission do not see onboarding again", async ({ page }) => {
  await page.goto("./");
  await page.getByRole("button", { name: "Skip Quick Start" }).click();
  await expect.poll(() => durableSetting(page, "fs_onboarding_v2_done")).toBe(true);

  await page.goto("./permission");
  await page.getByLabel("Permission Name / Location").fill("Existing User Farm");
  await page.getByRole("button", { name: "Create Record" }).click();
  await expect(page).toHaveURL(/\/permission\/[^/?#]+$/);

  await deleteDurableSettings(page, ["fs_onboarding_v2_done", "fs_onboarding_done"]);
  await page.goto("./");

  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect.poll(() => durableSetting(page, "fs_onboarding_v2_done")).toBe(true);
});

test("Settings replays the guide and shows current install instructions", async ({ page }) => {
  await page.goto("./");
  await page.getByRole("button", { name: "Skip Quick Start" }).click();
  await expect.poll(() => durableSetting(page, "fs_onboarding_v2_done")).toBe(true);
  await page.goto("./settings");

  await page.getByRole("button", { name: "App" }).click();
  const showAgain = page.getByRole("button", { name: /Show again/ });
  await showAgain.scrollIntoViewIfNeeded();
  await showAgain.click();

  await expect(page).toHaveURL(/\/findspot\/$/);
  await page.getByRole("button", { name: "Get Started" }).click();
  await page.getByRole("button", { name: "Install the app" }).click();
  const dialog = page.getByRole("dialog", { name: "Install FindSpot" });
  await expect(dialog).toContainText("Safari or Chrome");
  await expect(dialog).toContainText("Open as Web App");
  await expect(dialog).not.toContainText("Chrome on iOS won't work");
});
