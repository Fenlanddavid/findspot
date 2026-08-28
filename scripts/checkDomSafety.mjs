import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const ROOT = process.cwd();
const SRC = path.join(ROOT, 'src');
const APPROVED = [
  // Stable identity: path + sink + SHA-256 of the approved static literal.
  { file: 'src/components/PermissionFieldsColumn.tsx', sink: 'innerHTML', hash: 'fde2cd8c371c43e168e03356b812b09d5b0389e80e2941b772cfde6e014ebb0c' },
  { file: 'src/components/UndugSignalMapSheet.tsx', sink: 'innerHTML', hash: '2beb0c6b9ab53d3c76c8af2c8a915e868f69cc347eec11cecd4ae210545e4c17' },
  { file: 'src/components/fieldGuide/FieldGuideWorkspace.tsx', sink: 'innerHTML', hash: 'dcfae5f411f5cb1825be43e4dee930b451d22eb166bf990245ea0f0a214b147b' },
  { file: 'src/hooks/useSavedPointMarkers.ts', sink: 'innerHTML', hash: '737b361061b79d9b4b048274c1e52ed441307c94d24d339f677047744a23985e' },
  { file: 'src/hooks/useSavedPointMarkers.ts', sink: 'innerHTML', hash: 'b91c070363a10e0de5bcae18b9196176bc397f506baa57afb22c0adc2e296818' },
];

function sourceFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(target);
    return /\.(ts|tsx)$/.test(entry.name) ? [target] : [];
  });
}

function staticContent(expression, declarations) {
  if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) return expression.text;
  if (ts.isIdentifier(expression)) {
    const initializer = declarations.get(expression.text);
    if (initializer) return staticContent(initializer, declarations);
  }
  return null;
}

function digest(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function accessedProperty(expression) {
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  if (ts.isElementAccessExpression(expression) && expression.argumentExpression) {
    const argument = expression.argumentExpression;
    if (ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument)) return argument.text;
  }
  return null;
}

const findings = [];
for (const filename of sourceFiles(SRC)) {
  const source = fs.readFileSync(filename, 'utf8');
  const file = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, filename.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const declarations = new Map();
  const collect = node => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) declarations.set(node.name.text, node.initializer);
    ts.forEachChild(node, collect);
  };
  collect(file);

  const visit = node => {
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      const sink = accessedProperty(node.left);
      if (sink === 'innerHTML' || sink === 'outerHTML') {
        const content = staticContent(node.right, declarations);
        findings.push({
          file: path.relative(ROOT, filename),
          sink,
          hash: content === null ? 'DYNAMIC' : digest(content),
        });
      }
    }
    if (ts.isCallExpression(node)) {
      const expression = node.expression;
      const sink = ts.isIdentifier(expression)
        ? expression.text
        : accessedProperty(expression) ?? '';
      if (['eval', 'Function', 'write', 'insertAdjacentHTML', 'setHTML'].includes(sink)) {
        findings.push({ file: path.relative(ROOT, filename), sink, hash: 'DYNAMIC' });
      }
    }
    if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'Function') {
      findings.push({ file: path.relative(ROOT, filename), sink: 'new Function', hash: 'DYNAMIC' });
    }
    if (ts.isJsxAttribute(node) && node.name.getText(file) === 'dangerouslySetInnerHTML') {
      findings.push({ file: path.relative(ROOT, filename), sink: 'dangerouslySetInnerHTML', hash: 'DYNAMIC' });
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
}

const identity = item => `${item.file}|${item.sink}|${item.hash}`;
const approved = new Set(APPROVED.map(identity));
const actual = new Set(findings.map(identity));
const unapproved = findings.filter(item => !approved.has(identity(item)));
const missing = APPROVED.filter(item => !actual.has(identity(item)));

if (unapproved.length || missing.length) {
  if (unapproved.length) console.error(`Unapproved unsafe DOM sinks:\n${JSON.stringify(unapproved, null, 2)}`);
  if (missing.length) console.error(`Approved DOM sinks no longer match:\n${JSON.stringify(missing, null, 2)}`);
  process.exit(1);
}

console.log(`DOM safety ratchet passed (${findings.length} approved static sinks).`);
