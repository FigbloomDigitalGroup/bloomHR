import * as XLSX from 'xlsx';

/** A date as the plain text the employees table stores: 2026-10-06. */
function isoDate(date: Date): string {
  // spreadsheet dates come back a few minutes either side of midnight, depending on the time zone: round to the day
  const noon = new Date(date.getTime() + 12 * 60 * 60 * 1000);
  return `${noon.getUTCFullYear()}-${String(noon.getUTCMonth() + 1).padStart(2, '0')}-${String(noon.getUTCDate()).padStart(2, '0')}`;
}

/**
 * Reads the first sheet of an .xlsx, .xls or .csv file into one object per row, keyed by the header row.
 *
 * Values are read as they were typed ("raw"): left to itself the reader turns the text 1984-03-14 in a CSV into
 * a spreadsheet serial number (30755.1...) and drops the leading zero of 0722000001. Real date cells in an Excel
 * file arrive as dates and are converted to plain YYYY-MM-DD text.
 */
export function readEmployeeRows(data: ArrayBuffer | Uint8Array): Record<string, unknown>[] {
  const workbook = XLSX.read(data instanceof Uint8Array ? data : new Uint8Array(data), { type: 'array', raw: true, cellDates: true });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) return [];
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet).map((row) => {
    const clean: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) {
      clean[key.trim()] = value instanceof Date ? isoDate(value) : typeof value === 'string' ? value.trim() : value;
    }
    return clean;
  });
}
