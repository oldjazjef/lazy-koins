/**
 * Platform admin (the management pages, `/api/admin/*`). Hand-written domain types.
 *
 * What an admin may see is **metadata only** — accounts (e-mail, name, dates, counts, storage)
 * and the public library. Never a project, file, transaction, result or setting of another user:
 * the tax data stays the user's (no endpoint reads it, no "sign in as").
 */

export const ADMIN_LIMITS = {
  maxReason: 500,
  pageSize: 50,
  maxPageSize: 200,
} as const;

export const ADMIN_ACTIONS = [
  'user.block',
  'user.unblock',
  'user.grantAdmin',
  'user.revokeAdmin',
  'user.delete',
  'library.hide',
  'library.unhide',
] as const;
export type AdminAction = (typeof ADMIN_ACTIONS)[number];

export interface AdminOverview {
  readonly users: number;
  /** A request in the last 30 days. */
  readonly activeUsers: number;
  readonly blockedUsers: number;
  readonly admins: number;
  readonly projects: number;
  readonly storedFiles: number;
  /** Σ stored file bytes. */
  readonly storageBytes: number;
  readonly libraryEntries: number;
  readonly hiddenLibraryEntries: number;
  /** The SQLite file (page count × page size). */
  readonly databaseBytes: number;
}

export interface AdminUser {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly signInProvider: string;
  readonly createdAt: string;
  readonly lastSeenAt: string | null;
  readonly isPlatformAdmin: boolean;
  readonly blockedAt: string | null;
  readonly blockedReason: string | null;
  readonly projects: number;
  readonly storedFiles: number;
  readonly storageBytes: number;
  readonly libraryEntries: number;
}

export const ADMIN_USER_FILTERS = ['all', 'blocked', 'admins'] as const;
export type AdminUserFilter = (typeof ADMIN_USER_FILTERS)[number];

export interface AdminUserCriteria {
  readonly query?: string;
  readonly filter?: AdminUserFilter;
  readonly offset: number;
  readonly limit: number;
}

export interface AdminLibraryEntry {
  readonly id: string;
  readonly name: string;
  readonly platform: string;
  readonly description: string | null;
  readonly authorName: string | null;
  /** Internal, admins only: to look the author up among the users. */
  readonly authorId: string;
  readonly authorEmail: string;
  readonly version: number;
  readonly usageCount: number;
  readonly ratingCount: number;
  readonly publishedAt: string;
  readonly updatedAt: string;
  readonly hiddenAt: string | null;
  readonly hiddenReason: string | null;
}

export const ADMIN_LIBRARY_FILTERS = ['all', 'visible', 'hidden'] as const;
export type AdminLibraryFilter = (typeof ADMIN_LIBRARY_FILTERS)[number];

export interface AdminLibraryCriteria {
  readonly query?: string;
  readonly filter?: AdminLibraryFilter;
  readonly offset: number;
  readonly limit: number;
}

export interface AdminAuditEntry {
  readonly id: string;
  readonly actorId: string;
  readonly actorEmail: string;
  readonly action: AdminAction;
  readonly targetType: 'user' | 'library';
  readonly targetId: string;
  readonly targetLabel: string;
  readonly reason: string | null;
  readonly createdAt: string;
}

export interface Page<T> {
  readonly items: readonly T[];
  readonly total: number;
}

/** A reason: trimmed, 1–500 characters, else `null` (the handlers answer 400). */
export function cleanReason(reason: string | undefined | null): string | null {
  const trimmed = (reason ?? '').trim();
  return trimmed.length >= 1 && trimmed.length <= ADMIN_LIMITS.maxReason
    ? trimmed
    : null;
}
