import { expect, test } from "@playwright/test";

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
  expect(await page.evaluate(() => localStorage.getItem("fs_onboarding_v2_done"))).toBeNull();
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
  expect(await page.evaluate(() => localStorage.getItem("fs_onboarding_v2_done"))).toBe("1");
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
  expect(await page.evaluate(() => localStorage.getItem("fs_onboarding_v2_done"))).toBe("1");
});

test("users with a real permission do not see onboarding again", async ({ page }) => {
  await page.goto("./");
  await page.getByRole("button", { name: "Skip Quick Start" }).click();

  await page.goto("./permission");
  await page.getByLabel("Permission Name / Location").fill("Existing User Farm");
  await page.getByRole("button", { name: "Create Record" }).click();
  await expect(page).toHaveURL(/\/permission\/[^/?#]+$/);

  await page.evaluate(() => {
    localStorage.removeItem("fs_onboarding_v2_done");
    localStorage.removeItem("fs_onboarding_done");
  });
  await page.goto("./");

  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => localStorage.getItem("fs_onboarding_v2_done"))).toBe("1");
});

test("Settings replays the guide and shows current install instructions", async ({ page }) => {
  await page.goto("./");
  await page.getByRole("button", { name: "Skip Quick Start" }).click();
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
