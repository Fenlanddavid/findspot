import { readdir, readFile } from "node:fs/promises";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const SOURCE_DIRECTORY = new URL("../../src/", import.meta.url);

interface SilentHandler {
  file: string;
  line: number;
}

async function sourceFiles(directory: URL): Promise<URL[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async entry => {
    const url = new URL(entry.name + (entry.isDirectory() ? "/" : ""), directory);
    if (entry.isDirectory()) return sourceFiles(url);
    return entry.name.endsWith(".ts") || entry.name.endsWith(".tsx") ? [url] : [];
  }));
  return nested.flat();
}

function isEmptyFunction(expression: ts.Expression): boolean {
  return (
    (ts.isArrowFunction(expression) || ts.isFunctionExpression(expression))
    && ts.isBlock(expression.body)
    && expression.body.statements.length === 0
  );
}

async function silentHandlers(): Promise<{
  catchClauses: SilentHandler[];
  promiseCatches: SilentHandler[];
}> {
  const catchClauses: SilentHandler[] = [];
  const promiseCatches: SilentHandler[] = [];

  for (const file of await sourceFiles(SOURCE_DIRECTORY)) {
    const source = await readFile(file, "utf8");
    const syntax = ts.createSourceFile(file.pathname, source, ts.ScriptTarget.Latest, true);
    const relative = file.pathname.split("/src/").at(-1) ?? file.pathname;

    function location(node: ts.Node): SilentHandler {
      return {
        file: relative,
        line: syntax.getLineAndCharacterOfPosition(node.getStart(syntax)).line + 1,
      };
    }

    function visit(node: ts.Node): void {
      if (ts.isCatchClause(node) && node.block.statements.length === 0) {
        catchClauses.push(location(node));
      }
      if (
        ts.isCallExpression(node)
        && ts.isPropertyAccessExpression(node.expression)
        && node.expression.name.text === "catch"
        && node.arguments.some(isEmptyFunction)
      ) {
        promiseCatches.push(location(node));
      }
      ts.forEachChild(node, visit);
    }

    visit(syntax);
  }

  return { catchClauses, promiseCatches };
}

describe("silent diagnostic handler inventory", () => {
  it("characterizes the pre-v4.8.4 silent-handler baseline", async () => {
    const inventory = await silentHandlers();

    expect(inventory.catchClauses).toHaveLength(44);
    expect(inventory.promiseCatches).toHaveLength(28);
    expect(inventory.catchClauses).toContainEqual({
      file: "services/diagLog.ts",
      line: 38,
    });
  });
});
