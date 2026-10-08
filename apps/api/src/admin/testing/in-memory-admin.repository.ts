import type {
  AdminAuditEntry,
  AdminLibraryCriteria,
  AdminLibraryEntry,
  AdminOverview,
  AdminUser,
  AdminUserCriteria,
  Page,
} from '../domain/admin';
import { AdminRepositoryPort } from '../ports/admin.repository.port';

/** Port double over Maps (users and library entries as the adapter returns them). */
export class InMemoryAdminRepository extends AdminRepositoryPort {
  readonly users = new Map<string, AdminUser>();
  readonly library = new Map<string, AdminLibraryEntry>();
  readonly audit: AdminAuditEntry[] = [];
  readonly deleted: string[] = [];

  addUser(user: Partial<AdminUser> & { id: string; email: string }): AdminUser {
    const row: AdminUser = {
      displayName: user.email.split('@')[0] ?? '',
      signInProvider: 'dev',
      createdAt: '2026-10-01T00:00:00.000Z',
      lastSeenAt: null,
      isPlatformAdmin: false,
      blockedAt: null,
      blockedReason: null,
      projects: 0,
      storedFiles: 0,
      storageBytes: 0,
      libraryEntries: 0,
      ...user,
    };
    this.users.set(row.id, row);
    return row;
  }

  async overview(sinceActiveIso: string): Promise<AdminOverview> {
    const users = [...this.users.values()];
    const entries = [...this.library.values()];
    return {
      users: users.length,
      activeUsers: users.filter(
        (u) => u.lastSeenAt !== null && u.lastSeenAt >= sinceActiveIso,
      ).length,
      blockedUsers: users.filter((u) => u.blockedAt).length,
      admins: users.filter((u) => u.isPlatformAdmin).length,
      projects: users.reduce((n, u) => n + u.projects, 0),
      storedFiles: users.reduce((n, u) => n + u.storedFiles, 0),
      storageBytes: users.reduce((n, u) => n + u.storageBytes, 0),
      libraryEntries: entries.filter((e) => !e.hiddenAt).length,
      hiddenLibraryEntries: entries.filter((e) => e.hiddenAt).length,
      databaseBytes: 0,
    };
  }

  async listUsers(criteria: AdminUserCriteria): Promise<Page<AdminUser>> {
    const q = (criteria.query ?? '').toLowerCase();
    const all = [...this.users.values()].filter(
      (u) =>
        (!q ||
          u.email.toLowerCase().includes(q) ||
          u.displayName.toLowerCase().includes(q)) &&
        (criteria.filter !== 'blocked' || u.blockedAt !== null) &&
        (criteria.filter !== 'admins' || u.isPlatformAdmin),
    );
    return {
      items: all.slice(criteria.offset, criteria.offset + criteria.limit),
      total: all.length,
    };
  }

  async findUser(id: string): Promise<AdminUser | undefined> {
    return this.users.get(id);
  }

  async countAdmins(): Promise<number> {
    return [...this.users.values()].filter((u) => u.isPlatformAdmin).length;
  }

  async setBlocked(
    id: string,
    block: { readonly atIso: string; readonly reason: string } | null,
  ): Promise<void> {
    const user = this.users.get(id);
    if (user) {
      this.users.set(id, {
        ...user,
        blockedAt: block?.atIso ?? null,
        blockedReason: block?.reason ?? null,
      });
    }
  }

  async setAdmin(id: string, admin: boolean): Promise<void> {
    const user = this.users.get(id);
    if (user) this.users.set(id, { ...user, isPlatformAdmin: admin });
  }

  async deleteUser(id: string): Promise<void> {
    this.users.delete(id);
    this.deleted.push(id);
  }

  async listLibrary(
    criteria: AdminLibraryCriteria,
  ): Promise<Page<AdminLibraryEntry>> {
    const all = [...this.library.values()].filter(
      (e) =>
        (criteria.filter !== 'hidden' || e.hiddenAt !== null) &&
        (criteria.filter !== 'visible' || e.hiddenAt === null),
    );
    return {
      items: all.slice(criteria.offset, criteria.offset + criteria.limit),
      total: all.length,
    };
  }

  async findLibraryEntry(id: string): Promise<AdminLibraryEntry | undefined> {
    return this.library.get(id);
  }

  async setLibraryHidden(
    id: string,
    hide: { readonly atIso: string; readonly reason: string } | null,
  ): Promise<void> {
    const entry = this.library.get(id);
    if (entry) {
      this.library.set(id, {
        ...entry,
        hiddenAt: hide?.atIso ?? null,
        hiddenReason: hide?.reason ?? null,
      });
    }
  }

  async addAudit(
    entry: Omit<AdminAuditEntry, 'id' | 'createdAt'>,
  ): Promise<AdminAuditEntry> {
    const row = {
      ...entry,
      id: `audit-${this.audit.length + 1}`,
      createdAt: '2026-10-10T12:00:00.000Z',
    };
    this.audit.push(row);
    return row;
  }

  async listAudit(
    offset: number,
    limit: number,
  ): Promise<Page<AdminAuditEntry>> {
    const all = [...this.audit].reverse();
    return { items: all.slice(offset, offset + limit), total: all.length };
  }
}
