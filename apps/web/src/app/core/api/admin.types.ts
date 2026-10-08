/** Hand-mirrored from `apps/api/src/admin/domain/admin.ts` (the management pages). */

export interface AdminOverview {
  users: number;
  activeUsers: number;
  blockedUsers: number;
  admins: number;
  projects: number;
  storedFiles: number;
  storageBytes: number;
  libraryEntries: number;
  hiddenLibraryEntries: number;
  databaseBytes: number;
}

export interface AdminUser {
  id: string;
  email: string;
  displayName: string;
  signInProvider: string;
  createdAt: string;
  lastSeenAt: string | null;
  isPlatformAdmin: boolean;
  blockedAt: string | null;
  blockedReason: string | null;
  projects: number;
  storedFiles: number;
  storageBytes: number;
  libraryEntries: number;
}

export const ADMIN_USER_FILTERS = ['all', 'blocked', 'admins'] as const;
export type AdminUserFilter = (typeof ADMIN_USER_FILTERS)[number];

export interface AdminLibraryEntry {
  id: string;
  name: string;
  platform: string;
  description: string | null;
  authorName: string | null;
  authorId: string;
  authorEmail: string;
  version: number;
  usageCount: number;
  ratingCount: number;
  publishedAt: string;
  updatedAt: string;
  hiddenAt: string | null;
  hiddenReason: string | null;
}

export const ADMIN_LIBRARY_FILTERS = ['all', 'visible', 'hidden'] as const;
export type AdminLibraryFilter = (typeof ADMIN_LIBRARY_FILTERS)[number];

export const ADMIN_ACTIONS = [
  `user.block`,
  `user.unblock`,
  `user.grantAdmin`,
  `user.revokeAdmin`,
  `user.delete`,
  `library.hide`,
  `library.unhide`,
] as const;
export type AdminAction = (typeof ADMIN_ACTIONS)[number];

export interface AdminAuditEntry {
  id: string;
  actorId: string;
  actorEmail: string;
  action: AdminAction;
  targetType: 'user' | 'library';
  targetId: string;
  targetLabel: string;
  reason: string | null;
  createdAt: string;
}

export interface AdminPage<T> {
  items: T[];
  total: number;
}

/** Rows per server page in the admin tables. */
export const ADMIN_PAGE_SIZE = 50;
