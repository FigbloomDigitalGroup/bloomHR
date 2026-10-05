// The logic behind `npm run typecheck`: a "ratchet" for TypeScript errors.
//
// The project has hundreds of type errors that predate this check, and the build (`vite build`) does not type-check.
// Fixing them all at once is not realistic, so instead each file's current error count is recorded in
// scripts/types-baseline.json and the check fails only when a file gets WORSE (or a clean file gets an error).
// Fixing errors lowers the numbers; `npm run typecheck:update` writes the lower numbers back so they cannot creep up again.

/** tsc prints `path(line,col): error TSxxxx: message`. Returns { 'path': errorCount }. */
export function parseTscOutput(output) {
  const counts = {};
  for (const line of String(output).split(/\r?\n/)) {
    // real error lines start at column 0; the indented lines under them continue a long message
    const m = line.match(/^(?!\s)(.+?)\(\d+,\d+\): error TS\d+:/);
    if (!m) continue;
    const file = m[1].trim().replace(/\\/g, '/');
    counts[file] = (counts[file] || 0) + 1;
  }
  return counts;
}

/**
 * Compares today's counts with the recorded baseline.
 * regressions: files with more errors than recorded (or errors in a file with none recorded)
 * improvements: files with fewer errors than recorded (including files that are now clean)
 */
export function compareToBaseline(baseline, current) {
  const regressions = [];
  const improvements = [];
  for (const file of new Set([...Object.keys(baseline), ...Object.keys(current)])) {
    const before = baseline[file] || 0;
    const now = current[file] || 0;
    if (now > before) regressions.push({ file, before, now });
    else if (now < before) improvements.push({ file, before, now });
  }
  const byFile = (a, b) => a.file.localeCompare(b.file);
  return { regressions: regressions.sort(byFile), improvements: improvements.sort(byFile) };
}

export const total = (counts) => Object.values(counts).reduce((n, c) => n + c, 0);

/** A stable file so the baseline diff in a pull request is easy to read. */
export function serializeBaseline(counts) {
  const sorted = Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
  return `${JSON.stringify(sorted, null, 2)}\n`;
}
