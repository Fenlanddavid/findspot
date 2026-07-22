import { readdir, readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const ENGINES_DIRECTORY = new URL("../../src/engines/", import.meta.url);

async function sourceFiles(directory: URL): Promise<URL[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async entry => {
    const url = new URL(entry.name + (entry.isDirectory() ? "/" : ""), directory);
    if (entry.isDirectory()) return sourceFiles(url);
    return entry.name.endsWith(".ts") || entry.name.endsWith(".tsx") ? [url] : [];
  }));
  return nested.flat();
}

function importsDatabase(source: string): boolean {
  const importSpecifiers = source.matchAll(/(?:from\s+|import\s*\()\s*["']([^"']+)["']/g);
  return [...importSpecifiers].some(([, specifier]) => (
    specifier === "db" || /\/db(?:\.ts)?$/.test(specifier)
  ));
}

describe("persistence boundaries", () => {
  it("keeps database imports out of every engine", async () => {
    const violations: string[] = [];

    for (const file of await sourceFiles(ENGINES_DIRECTORY)) {
      const source = await readFile(file, "utf8");
      if (importsDatabase(source)) {
        violations.push(file.pathname.split("/src/").at(-1) ?? file.pathname);
      }
    }

    expect(violations.sort()).toEqual([]);
  });
});
