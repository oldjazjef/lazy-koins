/**
 * The conversion boundary between Prisma's scalar representations and the domain's. Timestamps
 * cross the port as ISO 8601 UTC strings. (Decimal quantities will cross as decimal strings —
 * TEXT columns — and become `Decimal` only inside libs/engine; see CLAUDE.md, Numbers.)
 */

export function toIsoString(value: Date): string {
  return value.toISOString();
}

/**
 * A timestamp for raw SQL, in the exact text form Prisma's SQLite adapter stores (`…+00:00`):
 * CHECKs and range comparisons compare these strings, so every writer must use one format.
 */
export function toSqliteTimestamp(value: Date): string {
  return value.toISOString().replace('Z', '+00:00');
}
