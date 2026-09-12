import { execFileSync } from 'node:child_process';

const result = execFileSync('grep', ['-rn', '--include=*.ts', '--include=*.tsx', 'toLocaleDateString\\|toLocaleTimeString', 'src/'], { encoding: 'utf8' }).trim();
// Filter out the formatDate.ts module itself and number formatting
const violations = result.split('\n').filter(line => line && !line.includes('src/utils/formatDate.ts'));

if (violations.length > 0) {
  console.error(`Date locale ratchet failed: ${violations.length} raw toLocaleDateString/toLocaleTimeString call(s) outside src/utils/formatDate.ts:`);
  for (const v of violations) console.error('  ' + v);
  process.exit(1);
}
console.log('Date locale ratchet passed.');
