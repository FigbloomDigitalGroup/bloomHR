import * as XLSX from 'xlsx';

// The payroll upload files as Excel: the same header and rows as the CSV, every cell written as text (and formatted
// as text) so Excel keeps leading zeros and never turns account, phone or ID numbers into numbers or 2.5E+11.

/** A sheet name Excel accepts: no []:*?/\ and at most 31 characters. */
export const sheetName = (name: string) => name.replace(/[[\]:*?/\\]/g, ' ').trim().slice(0, 31) || 'Sheet1';

/** One sheet, header row first, every value a text cell. Returns the .xlsx file's bytes. */
export function toXlsx(headers: readonly string[], rows: string[][], name = 'Sheet1'): ArrayBuffer {
  const sheet: XLSX.WorkSheet = {};
  const all = [headers, ...rows];
  let width = headers.length;
  all.forEach((row, r) => {
    width = Math.max(width, row.length);
    row.forEach((value, c) => {
      sheet[XLSX.utils.encode_cell({ r, c })] = { t: 's', v: String(value ?? ''), z: '@' };
    });
  });
  sheet['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(0, all.length - 1), c: Math.max(0, width - 1) } });
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, sheetName(name));
  return XLSX.write(book, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
}

export const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
