// The database API returns at most 1000 rows per request (max_rows in supabase/config.toml), and a request's
// address has a length limit, so a list of thousands of employee numbers cannot go in one filter. These helpers read
// and write large sets of rows a piece at a time, so a company with thousands of employees is handled whole.

/** Rows per read: the API's max_rows. */
export const PAGE_SIZE = 1000;

/** Values per `in (...)` filter: keeps the request address well under the limit. */
export const IN_LIST_SIZE = 200;

/** Rows per insert or upsert. */
export const WRITE_BATCH_SIZE = 500;

type PageResult<T> = PromiseLike<{ data: T[] | null; error: unknown }>;

/**
 * Every row a query returns, read a page at a time. `page(from, to)` must build the query with `.range(from, to)`
 * and a stable `.order(...)` on a unique column, so rows are neither skipped nor repeated between pages.
 */
export async function fetchAll<T>(page: (from: number, to: number) => PageResult<T>, pageSize = PAGE_SIZE): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await page(from, from + pageSize - 1);
    if (error) throw error;
    const batch = data ?? [];
    rows.push(...batch);
    if (batch.length < pageSize) return rows;
  }
}

/** `items` split into consecutive pieces of at most `size`. */
export function chunks<T>(items: readonly T[], size: number): T[][] {
  if (size < 1) throw new Error('chunk size must be at least 1');
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
