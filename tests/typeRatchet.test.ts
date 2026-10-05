import { describe, expect, it } from 'vitest';
// @ts-expect-error - plain ES module script with no type declarations
import { compareToBaseline, parseTscOutput, serializeBaseline, total } from '../scripts/typeRatchet.mjs';

const sample = [
  "src/a.ts(10,5): error TS2322: Type 'string' is not assignable to type 'number'.",
  "src/a.ts(22,1): error TS7006: Parameter 'x' implicitly has an 'any' type.",
  "src/components/Foo Bar/b.tsx(3,9): error TS2339: Property 'y' does not exist on type 'never'.",
  'src\\win\\c.ts(1,1): error TS6133: unused.',
  '  continuation line of the previous message that mentions (1,2): error TS0000: ignored',
  'Found 4 errors in 3 files.',
].join('\r\n');

describe('parseTscOutput', () => {
  it('counts errors per file, including paths with spaces and Windows separators', () => {
    expect(parseTscOutput(sample)).toEqual({
      'src/a.ts': 2,
      'src/components/Foo Bar/b.tsx': 1,
      'src/win/c.ts': 1,
    });
  });

  it('ignores anything that is not an error line', () => {
    expect(parseTscOutput('Found 0 errors.\nsome noise\n')).toEqual({});
    expect(total(parseTscOutput(sample))).toBe(4);
  });
});

describe('compareToBaseline', () => {
  const baseline = { 'src/a.ts': 2, 'src/b.ts': 1 };

  it('passes when nothing got worse', () => {
    expect(compareToBaseline(baseline, { 'src/a.ts': 2, 'src/b.ts': 1 })).toEqual({ regressions: [], improvements: [] });
  });

  it('flags a file with more errors than recorded', () => {
    const r = compareToBaseline(baseline, { 'src/a.ts': 3, 'src/b.ts': 1 });
    expect(r.regressions).toEqual([{ file: 'src/a.ts', before: 2, now: 3 }]);
  });

  it('flags the first error in a file that was clean', () => {
    const r = compareToBaseline(baseline, { 'src/a.ts': 2, 'src/b.ts': 1, 'src/new.ts': 1 });
    expect(r.regressions).toEqual([{ file: 'src/new.ts', before: 0, now: 1 }]);
  });

  it('reports improvements, including a file that is now clean, without failing', () => {
    const r = compareToBaseline(baseline, { 'src/a.ts': 1 });
    expect(r.regressions).toEqual([]);
    expect(r.improvements).toEqual([
      { file: 'src/a.ts', before: 2, now: 1 },
      { file: 'src/b.ts', before: 1, now: 0 },
    ]);
  });

  it('does not let a fix in one file hide a new error in another', () => {
    const r = compareToBaseline(baseline, { 'src/a.ts': 0, 'src/b.ts': 2 });
    expect(r.regressions).toEqual([{ file: 'src/b.ts', before: 1, now: 2 }]);
  });
});

describe('serializeBaseline', () => {
  it('is sorted and ends with a newline so the diff stays readable', () => {
    expect(serializeBaseline({ 'src/z.ts': 1, 'src/a.ts': 2 })).toBe('{\n  "src/a.ts": 2,\n  "src/z.ts": 1\n}\n');
  });
});
