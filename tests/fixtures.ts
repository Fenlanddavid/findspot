import { expect, test as base } from "@playwright/test";

export type { Page } from "@playwright/test";
export { expect };

export const test = base.extend<{ productionIsolation: void }>({
  productionIsolation: [async ({ page }, use) => {
    await page.route("https://findspot-counter.trials-uk.workers.dev/**", route => {
      const { pathname } = new URL(route.request().url());
      if (pathname === "/count") {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          headers: { "access-control-allow-origin": "*" },
          body: JSON.stringify({ count: 0 }),
        });
      }
      if (pathname === "/up") {
        return route.fulfill({
          status: 204,
          headers: { "access-control-allow-origin": "*" },
        });
      }
      return route.abort("blockedbyclient");
    });

    await use();
  }, { auto: true }],
});
