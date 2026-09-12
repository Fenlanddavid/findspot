import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

function propertyName(expression) {
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  if (ts.isElementAccessExpression(expression) && ts.isStringLiteral(expression.argumentExpression)) return expression.argumentExpression.text;
  return null;
}

// File-wide intentionally: splitting URL creation and anchor activation between
// callbacks in one module must not bypass the shared download lifetime policy.
export function hasUnmanagedDownload(source, filename = 'example.tsx') {
  const file = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, filename.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  let createsUrl = false;
  let clicks = false;
  const visit = node => {
    if (ts.isCallExpression(node)) {
      const name = propertyName(node.expression);
      if (name === 'createObjectURL') createsUrl = true;
      if (name === 'click') clicks = true;
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return createsUrl && clicks;
}

function sourceFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const filename = path.join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(filename) : /\.[cm]?[jt]sx?$/.test(entry.name) ? [filename] : [];
  });
}

export function checkDownloads(root = process.cwd()) {
  return sourceFiles(path.join(root, 'src')).filter(filename => (
    path.relative(root, filename) !== 'src/utils/download.ts'
    && hasUnmanagedDownload(fs.readFileSync(filename, 'utf8'), filename)
  )).map(filename => path.relative(root, filename));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const failures = checkDownloads();
  if (failures.length) {
    console.error(`Use src/utils/download.ts for Blob downloads:\n${failures.join('\n')}`);
    process.exitCode = 1;
  } else {
    console.log('Download safety ratchet passed.');
  }
}
