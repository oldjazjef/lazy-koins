import { HttpClient, httpResource } from '@angular/common/http';
import { computed, inject, Injectable, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { defineAction } from '../../../../core/actions/action';
import { ActionRunner } from '../../../../core/actions/action-runner';
import type {
  AdminPage,
  AdminUser,
  AdminUserFilter,
} from '../../../../core/api/admin.types';
import { apiUrl } from '../../../../core/api/api-url';
import { DataChanges, reloadOn } from '../../../../core/data/data-changes';

/** The API's page maximum: the table pages them on screen. */
export const USERS_LIMIT = 200;

/**
 * `/app/admin/users`: every account (metadata and counts only) with block / unblock, the admin
 * role and deletion. Every change needs what the API needs (a reason; the e-mail typed again to
 * delete) and is audited there.
 */
@Injectable({ providedIn: 'root' })
export class AdminUsersPageService {
  private readonly http = inject(HttpClient);
  private readonly actions = inject(ActionRunner);
  private readonly changes = inject(DataChanges);

  readonly query = signal('');
  readonly filter = signal<AdminUserFilter>('all');

  readonly users = httpResource<AdminPage<AdminUser>>(() => ({
    url: apiUrl('/admin/users'),
    params: {
      limit: USERS_LIMIT,
      filter: this.filter(),
      ...(this.query().trim() ? { q: this.query().trim() } : {}),
    },
  }));

  readonly rows = computed(() =>
    this.users.hasValue() ? this.users.value().items : [],
  );
  readonly total = computed(() =>
    this.users.hasValue() ? this.users.value().total : 0,
  );

  follow(): void {
    this.users.reload();
    reloadOn(() => this.changes.globalVersion('admin'), [this.users]);
  }

  private readonly blockAction = defineAction<
    { id: string; blocked: boolean; reason: string },
    AdminUser
  >({
    run: ({ id, blocked, reason }) =>
      firstValueFrom(
        this.http.post<AdminUser>(
          apiUrl(`/admin/users/${id}/${blocked ? 'block' : 'unblock'}`),
          reason ? { reason } : {},
        ),
      ),
    messages: { error: 'admin.users.failed' },
  });

  block(user: AdminUser, reason: string): Promise<AdminUser> {
    return this.actions.run(this.blockAction, {
      id: user.id,
      blocked: true,
      reason,
    });
  }

  unblock(user: AdminUser): Promise<AdminUser> {
    return this.actions.run(this.blockAction, {
      id: user.id,
      blocked: false,
      reason: '',
    });
  }

  private readonly roleAction = defineAction<
    { id: string; admin: boolean },
    AdminUser
  >({
    run: ({ id, admin }) =>
      firstValueFrom(
        this.http.put<AdminUser>(apiUrl(`/admin/users/${id}/admin`), {
          admin,
        }),
      ),
    messages: { error: 'admin.users.failed' },
  });

  setAdmin(user: AdminUser, admin: boolean): Promise<AdminUser> {
    return this.actions.run(this.roleAction, { id: user.id, admin });
  }

  private readonly deleteAction = defineAction<
    { id: string; reason: string; confirmEmail: string },
    unknown
  >({
    run: ({ id, reason, confirmEmail }) =>
      firstValueFrom(
        this.http.delete(apiUrl(`/admin/users/${id}`), {
          body: { reason, confirmEmail },
        }),
      ),
    messages: { success: 'admin.users.deleted', error: 'admin.users.failed' },
  });

  delete(
    user: AdminUser,
    reason: string,
    confirmEmail: string,
  ): Promise<unknown> {
    return this.actions.run(
      this.deleteAction,
      { id: user.id, reason, confirmEmail },
      { activity: { label: 'activity.adminDeleteUser' } },
    );
  }
}
