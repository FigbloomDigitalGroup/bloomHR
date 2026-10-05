// npm run typecheck          fail if any file has more TypeScript errors than scripts/types-baseline.json
// npm run typecheck:update   rewrite the baseline to today's counts (do this after fixing errors, in the same PR)
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compareToBaseline, parseTscOutput, serializeBaseline, total } from './typeRatchet.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const baselinePath = join(root, 'scripts', 'types-baseline.json');
const update = process.argv.includes('--update');

// Run the compiler directly with node, so this behaves the same on Windows, macOS and Linux
const tsc = join(root, 'node_modules', 'typescript', 'bin', 'tsc');
const run = spawnSync(process.execPath, [tsc, '-p', 'tsconfig.app.json', '--noEmit', '--pretty', 'false'], {
  cwd: root,
  encoding: 'utf8',
  maxBuffer: 256 * 1024 * 1024,
});
if (run.error) {
  console.error('Could not run the TypeScript compiler:', run.error.message);
  process.exit(2);
}

const current = parseTscOutput(`${run.stdout}\n${run.stderr}`);
const count = total(current);

// tsc exited non-zero but we found no error lines: something other than type errors went wrong (bad config...)
if (run.status !== 0 && count === 0) {
  console.error('The TypeScript compiler failed without reporting type errors:\n');
  console.error(`${run.stdout}${run.stderr}`.slice(0, 4000));
  process.exit(2);
}

if (update) {
  writeFileSync(baselinePath, serializeBaseline(current));
  console.log(`Baseline written: ${count} type errors across ${Object.keys(current).length} files.`);
  process.exit(0);
}

if (!existsSync(baselinePath)) {
  console.error('scripts/types-baseline.json is missing. Create it with: npm run typecheck:update');
  process.exit(2);
}

const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
const { regressions, improvements } = compareToBaseline(baseline, current);

console.log(`Type errors: ${count} now, ${total(baseline)} in the baseline.`);

if (improvements.length > 0) {
  const fewer = improvements.reduce((n, i) => n + (i.before - i.now), 0);
  console.log(`\n${fewer} fewer in ${improvements.length} file(s) - nice. Lock that in with: npm run typecheck:update`);
  for (const i of improvements.slice(0, 15)) console.log(`  ${i.file}: ${i.before} -> ${i.now}`);
  if (improvements.length > 15) console.log(`  ...and ${improvements.length - 15} more`);
}

if (regressions.length > 0) {
  console.error('\nThis change adds TypeScript errors:');
  for (const r of regressions) console.error(`  ${r.file}: ${r.before} -> ${r.now}`);
  console.error('\nFix them (run `npx tsc -p tsconfig.app.json --noEmit` to see the messages). Existing errors are allowed; new ones are not.');
  process.exit(1);
}

console.log('\nNo new type errors.');
