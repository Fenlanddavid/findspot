import { readdir, readFile } from "node:fs/promises";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const SOURCE_DIRECTORY = new URL("../../src/", import.meta.url);
const ENGINES_DIRECTORY = new URL("../../src/engines/", import.meta.url);

const DATABASE_MUTATION_METHODS = new Set([
  "add",
  "bulkAdd",
  "bulkDelete",
  "bulkPut",
  "clear",
  "delete",
  "put",
  "transaction",
  "update",
]);

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

function expressionRoot(expression: ts.Expression): ts.Expression {
  if (ts.isPropertyAccessExpression(expression) || ts.isElementAccessExpression(expression)) {
    return expressionRoot(expression.expression);
  }
  if (ts.isCallExpression(expression)) return expressionRoot(expression.expression);
  return expression;
}

function hasDirectDatabaseMutation(source: string, fileName: string): boolean {
  const syntax = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  let found = false;

  function visit(node: ts.Node): void {
    if (found) return;
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const root = expressionRoot(node.expression);
      if (
        ts.isIdentifier(root)
        && root.text === "db"
        && DATABASE_MUTATION_METHODS.has(node.expression.name.text)
      ) {
        found = true;
        return;
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(syntax);
  return found;
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

  it("keeps direct database writes out of all UI modules", async () => {
    const violations: string[] = [];
    const uiFiles = (await sourceFiles(SOURCE_DIRECTORY)).filter(file => {
      const relative = file.pathname.split("/src/").at(-1) ?? "";
      return relative === "App.tsx"
        || relative.startsWith("components/")
        || relative.startsWith("hooks/")
        || relative.startsWith("pages/");
    });

    for (const file of uiFiles) {
      const source = await readFile(file, "utf8");
      if (hasDirectDatabaseMutation(source, file.pathname)) {
        violations.push(file.pathname.split("/src/").at(-1) ?? file.pathname);
      }
    }

    expect(violations.sort()).toEqual([]);
  });
});
