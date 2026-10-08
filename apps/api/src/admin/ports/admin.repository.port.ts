import type {
  AdminAuditEntry,
  AdminLibraryCriteria,
  AdminLibraryEntry,
  AdminOverview,
  AdminUser,
  AdminUserCriteria,
  Page,
} from '../domain/admin';

/**
 * What the management pages read and change. Counts and metadata only — the adapter never
 * selects a file's bytes, a project's content or a setting. The Prisma binding lives in
 * `PersistenceModule`; who may do what is decided by the handlers.
 */
export abstract class AdminRepositoryPort {
  abstract overview(sinceActiveIso: string): Promise<AdminOverview>;

  abstract listUsers(criteria: AdminUserCriteria): Promise<Page<AdminUser>>;

  abstract findUser(id: string): Promise<AdminUser | undefined>;

  abstract countAdmins(): Promise<number>;

  /** `null` unblocks. */
  abstract setBlocked(
    id: string,
    block: { readonly atIso: string; readonly reason: string } | null,
  ): Promise<void>;

  abstract setAdmin(id: string, admin: boolean): Promise<void>;

  /** Deletes the account and, by cascade, everything it owns (F2.2). */
  abstract deleteUser(id: string): Promise<void>;

  abstract listLibrary(
    criteria: AdminLibraryCriteria,
  ): Promise<Page<AdminLibraryEntry>>;

  /** Entries not deleted by their author. */
  abstract findLibraryEntry(id: string): Promise<AdminLibraryEntry | undefined>;

  /** `null` shows the entry again. */
  abstract setLibraryHidden(
    id: string,
    hide: { readonly atIso: string; readonly reason: string } | null,
  ): Promise<void>;

  abstract addAudit(
    entry: Omit<AdminAuditEntry, 'id' | 'createdAt'>,
  ): Promise<AdminAuditEntry>;

  /** Newest first. */
  abstract listAudit(
    offset: number,
    limit: number,
  ): Promise<Page<AdminAuditEntry>>;
}
