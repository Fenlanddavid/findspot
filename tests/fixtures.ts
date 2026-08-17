import { expect, test as base } from "@playwright/test";

export type { Page } from "@playwright/test";
export { expect };

export const test = base.extend<{ productionIsolation: void }>({
  productionIsolation: [async ({}, use) => {
    await use();
  }, { auto: true }],
});
