import { readdir, readFile } from "node:fs/promises";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const SOURCE_DIRECTORY = new URL("../../src/", import.meta.url);
const ENGINES_DIRECTORY = new URL("../../src/engines/", import.meta.url);
const PAGES_DIRECTORY = new URL("../../src/pages/", import.meta.url);

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

function importsDatabaseValue(source: string, fileName: string): boolean {
  const syntax = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  let found = false;

  function visit(node: ts.Node): void {
    if (found) return;
    if (
      ts.isImportDeclaration(node)
      && ts.isStringLiteral(node.moduleSpecifier)
      && /(?:^|\/)db(?:\.ts)?$/.test(node.moduleSpecifier.text)
      && node.importClause
      && !node.importClause.isTypeOnly
    ) {
      if (node.importClause.name) {
        found = true;
        return;
      }
      const bindings = node.importClause.namedBindings;
      if (bindings && (
        ts.isNamespaceImport(bindings)
        || bindings.elements.some(element => (
          !element.isTypeOnly
          && (element.propertyName?.text ?? element.name.text) === "db"
        ))
      )) {
        found = true;
        return;
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(syntax);
  return found;
}

function explicitAnyCount(source: string, fileName: string): number {
  const syntax = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  let count = 0;
  function visit(node: ts.Node): void {
    if (node.kind === ts.SyntaxKind.AnyKeyword) count += 1;
    ts.forEachChild(node, visit);
  }
  visit(syntax);
  return count;
}

function expressionRoot(expression: ts.Expression): ts.Expression {
  if (ts.isPropertyAccessExpression(expression) || ts.isElementAccessExpression(expression)) {
    return expressionRoot(expression.expression);
  }
  if (ts.isCallExpression(expression)) return expressionRoot(expression.expression);
  return expression;
}

function hasDirectPersistenceMutation(
  source: string,
  fileName: string,
  roots: ReadonlySet<string> = new Set(["db"]),
): boolean {
  const syntax = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  let found = false;

  function visit(node: ts.Node): void {
    if (found) return;
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const root = expressionRoot(node.expression);
      if (
        ts.isIdentifier(root)
        && roots.has(root.text)
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

  it("keeps every engine locked at zero explicit any keywords", async () => {
    const violations: string[] = [];

    for (const file of await sourceFiles(ENGINES_DIRECTORY)) {
      const source = await readFile(file, "utf8");
      const count = explicitAnyCount(source, file.pathname);
      if (count > 0) {
        const relative = file.pathname.split("/src/").at(-1) ?? file.pathname;
        violations.push(`${relative}: ${count}`);
      }
    }

    expect(violations.sort()).toEqual([]);
  });

  it("keeps database value imports out of every page", async () => {
    const violations: string[] = [];

    for (const file of await sourceFiles(PAGES_DIRECTORY)) {
      const source = await readFile(file, "utf8");
      if (importsDatabaseValue(source, file.pathname)) {
        violations.push(`pages/${file.pathname.split("/pages/").at(-1)}`);
      }
    }

    expect(violations.sort()).toEqual([]);
  });

  it("keeps FieldGuideController below its composition-only size ceiling", async () => {
    const controller = new URL("../../src/pages/FieldGuideController.tsx", import.meta.url);
    const source = await readFile(controller, "utf8");
    expect(source.split("\n").length).toBeLessThan(500);
  });

  it("keeps post-scan writes behind the dedicated orchestrator", async () => {
    const [workspace, orchestrator] = await Promise.all([
      readFile(
        new URL("../../src/components/fieldGuide/FieldGuideWorkspace.tsx", import.meta.url),
        "utf8",
      ),
      readFile(
        new URL("../../src/services/fieldguide/postScanOrchestrator.ts", import.meta.url),
        "utf8",
      ),
    ]);

    expect(workspace).toContain("persistPostScanOutcomes({");
    expect(workspace).not.toContain("updateQuestionsAfterScan(");
    expect(workspace).not.toContain("recordFindHotspotSignals(");
    expect(workspace).not.toContain("recordHotspotPredictions(");
    expect(orchestrator).toContain("updateQuestionsAfterScan({");
    expect(orchestrator).toContain("recordFindHotspotSignals(");
    expect(orchestrator).toContain("recordHotspotPredictions(");
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
      if (hasDirectPersistenceMutation(source, file.pathname)) {
        violations.push(file.pathname.split("/src/").at(-1) ?? file.pathname);
      }
    }

    expect(violations.sort()).toEqual([]);
  });

  it("keeps the page persistence facade query-only at page call sites", async () => {
    const violations: string[] = [];

    for (const file of await sourceFiles(PAGES_DIRECTORY)) {
      const source = await readFile(file, "utf8");
      if (hasDirectPersistenceMutation(
        source,
        file.pathname,
        new Set(["pagePersistence"]),
      )) {
        violations.push(file.pathname.split("/src/").at(-1) ?? file.pathname);
      }
    }

    expect(violations.sort()).toEqual([]);
  });
});
