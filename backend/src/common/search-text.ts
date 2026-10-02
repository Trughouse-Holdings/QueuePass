/**
 * Normalizes a search box value for a Prisma `contains` filter (spec 004 FR-009): trimmed,
 * `undefined` when blank so the filter is skipped, and with LIKE's wildcards escaped.
 *
 * Prisma passes `contains` straight into `LIKE '%…%'` without escaping, so a search for `%`
 * would match everything and `_` any single character. PostgreSQL's default LIKE escape
 * character is the backslash.
 */
export function searchText(q: string | undefined): string | undefined {
  const t = q?.trim();
  return t ? t.replace(/[\\%_]/g, (c) => `\\${c}`) : undefined;
}
