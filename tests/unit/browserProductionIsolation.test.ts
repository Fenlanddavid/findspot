import { readdir, readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const TEST_DIRECTORY = new URL("../", import.meta.url);

describe("browser production isolation", () => {
  it("requires every Playwright spec to use the shared fixture", async () => {
    const specNames = (await readdir(TEST_DIRECTORY))
      .filter(name => name.endsWith(".spec.ts"));
    const violations: string[] = [];

    for (const specName of specNames) {
      const source = await readFile(new URL(specName, TEST_DIRECTORY), "utf8");
      if (source.includes('from "@playwright/test"') || source.includes("from '@playwright/test'")) {
        violations.push(specName);
      }
    }

    expect(violations).toEqual([]);
  });

  it("intercepts both production install-counter endpoints", async () => {
    const source = await readFile(new URL("fixtures.ts", TEST_DIRECTORY), "utf8");

    expect(source).toContain('https://findspot-counter.trials-uk.workers.dev/**');
    expect(source).toContain("pathname === '/count'");
    expect(source).toContain("pathname === '/up'");
  });
});
