// A Code 128 barcode (code set B: the printable ASCII characters), small enough to keep here rather than add a
// package for one barcode on the staff ID card. encodeCode128() gives the widths of the bars and spaces, which the
// card draws as SVG rectangles; any barcode scanner reads it back as the employee number.

// Each symbol's six widths (bar, space, bar, space, bar, space), by symbol value 0-106. 106 is the stop pattern,
// which has a seventh width (a final bar of 2).
const PATTERNS = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
];
const START_B = 104;
const STOP = 106;

/** The text a Code 128 B barcode can carry: printable ASCII only (anything else becomes '?'). */
export const code128Text = (text: string) => text.replace(/[^\x20-\x7e]/g, '?');

/**
 * The barcode's module widths, alternating bar and space and starting with a bar: start B, the characters, the
 * checksum and the stop pattern. The quiet zones either side are left to the caller.
 */
export function encodeCode128(text: string): number[] {
  const values = Array.from(code128Text(text), (ch) => ch.charCodeAt(0) - 32);
  const checksum = values.reduce((sum, v, i) => sum + v * (i + 1), START_B) % 103;
  const symbols = [START_B, ...values, checksum, STOP];
  return symbols.flatMap((s) => Array.from(PATTERNS[s], Number));
}

/** The bars to draw: x (in modules from the left) and width, plus the whole width in modules. */
export function code128Bars(text: string): { bars: { x: number; w: number }[]; width: number } {
  const widths = encodeCode128(text);
  const bars: { x: number; w: number }[] = [];
  let x = 0;
  widths.forEach((w, i) => {
    if (i % 2 === 0) bars.push({ x, w });
    x += w;
  });
  return { bars, width: x };
}
