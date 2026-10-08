import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  lucideBan,
  lucideCircleCheck,
  lucideShieldCheck,
  lucideShieldOff,
  lucideTrash2,
} from '@ng-icons/lucide';
import { TranslatePipe } from '@ngx-translate/core';
import { HlmBadgeImports } from '@lazykoins/ui/badge';
import { HlmButtonImports } from '@lazykoins/ui/button';
import { HlmDialogImports } from '@lazykoins/ui/dialog';
import { HlmInputImports } from '@lazykoins/ui/input';
import { HlmLabelImports } from '@lazykoins/ui/label';
import { HlmSkeletonImports } from '@lazykoins/ui/skeleton';
import { HlmTableImports } from '@lazykoins/ui/table';
import { HlmTextareaImports } from '@lazykoins/ui/textarea';
import { AdminAccess } from '../../../../core/admin/admin-access.service';
import {
  ADMIN_USER_FILTERS,
  type AdminUser,
  type AdminUserFilter,
} from '../../../../core/api/admin.types';
import { EmptyState } from '../../../../shared/components/empty-state';
import { PageHeader } from '../../../../shared/components/page-header';
import { paginate, Paginator } from '../../../../shared/components/paginator';
import {
  type RowAction,
  RowActions,
} from '../../../../shared/components/row-actions';
import { Truncate } from '../../../../shared/components/truncate';
import { LkDatePipe } from '../../../../shared/format/date.pipe';
import { formatBytes } from '../../../../shared/mail/mail-error';
import { AdminUsersPageService } from './admin-users-page.service';

type ActionId = 'block' | 'unblock' | 'grant' | 'revoke' | 'delete';
type Dialog = { readonly kind: ActionId; readonly user: AdminUser };

const SEARCH_DEBOUNCE_MS = 300;
const REASON_MAX = 500;

/** Row actions: never on my own account, and another admin only after revoking the role. */
export function userActions(
  user: AdminUser,
  myId: string | null,
): RowAction<ActionId>[] {
  const self = user.id === myId;
  return [
    {
      id: 'unblock',
      labelKey: 'admin.users.actions.unblock',
      icon: lucideCircleCheck,
      hidden: self || !user.blockedAt,
    },
    {
      id: 'grant',
      labelKey: 'admin.users.actions.grant',
      icon: lucideShieldCheck,
      hidden: self || user.isPlatformAdmin || user.blockedAt !== null,
    },
    {
      id: 'revoke',
      labelKey: 'admin.users.actions.revoke',
      icon: lucideShieldOff,
      hidden: self || !user.isPlatformAdmin,
    },
    {
      id: 'block',
      labelKey: 'admin.users.actions.block',
      icon: lucideBan,
      danger: true,
      hidden: self || user.isPlatformAdmin || user.blockedAt !== null,
    },
    {
      id: 'delete',
      labelKey: 'admin.users.actions.delete',
      icon: lucideTrash2,
      danger: true,
      hidden: self || user.isPlatformAdmin,
    },
  ];
}

/**
 * `/app/admin/users`: every account — e-mail, name, sign-in, created, last request, counts,
 * storage, status — with block / unblock, the admin role and deletion (dialogs with what the API
 * requires). No project or file of anyone is shown.
 */
@Component({
  selector: 'lk-admin-users-page',
  imports: [
    FormsModule,
    TranslatePipe,
    LkDatePipe,
    PageHeader,
    EmptyState,
    Paginator,
    RowActions,
    Truncate,
    ...HlmBadgeImports,
    ...HlmButtonImports,
    ...HlmDialogImports,
    ...HlmInputImports,
    ...HlmLabelImports,
    ...HlmSkeletonImports,
    ...HlmTableImports,
    ...HlmTextareaImports,
  ],
  templateUrl: './admin-users-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminUsersPage {
  protected readonly service = inject(AdminUsersPageService);
  private readonly access = inject(AdminAccess);
  protected readonly filters = ADMIN_USER_FILTERS;
  protected readonly skeletonRows = [1, 2, 3, 4];
  protected readonly bytes = formatBytes;
  protected readonly reasonMax = REASON_MAX;

  protected readonly search = signal(this.service.query());
  private searchTimer: ReturnType<typeof setTimeout> | undefined;

  protected readonly pager = paginate(this.service.rows, {
    storageKey: 'admin-users',
    resetOn: () => [this.service.query(), this.service.filter()],
  });

  protected readonly actions = computed(
    () =>
      new Map(
        this.service
          .rows()
          .map((u) => [u.id, userActions(u, this.access.myId())] as const),
      ),
  );

  protected readonly dialog = signal<Dialog | null>(null);
  protected readonly reason = signal('');
  protected readonly confirmEmail = signal('');
  protected readonly busy = signal(false);

  /** Block and delete need a reason; delete also the e-mail typed again. */
  protected readonly canConfirm = computed(() => {
    const current = this.dialog();
    if (!current) return false;
    const reason = this.reason().trim();
    if (current.kind === 'block') return reason.length > 0;
    if (current.kind === 'delete') {
      return (
        reason.length > 0 &&
        this.confirmEmail().trim().toLowerCase() ===
          current.user.email.trim().toLowerCase()
      );
    }
    return true;
  });

  constructor() {
    this.service.follow();
    void this.access.load();
    inject(DestroyRef).onDestroy(() => clearTimeout(this.searchTimer));
  }

  protected typed(value: string): void {
    this.search.set(value);
    clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(
      () => this.service.query.set(value),
      SEARCH_DEBOUNCE_MS,
    );
  }

  protected setFilter(value: AdminUserFilter): void {
    this.service.filter.set(value);
  }

  protected act(action: string, user: AdminUser): void {
    this.reason.set('');
    this.confirmEmail.set('');
    this.dialog.set({ kind: action as ActionId, user });
  }

  protected dialogState(kind: ActionId): 'open' | 'closed' {
    return this.dialog()?.kind === kind ? 'open' : 'closed';
  }

  protected dialogChanged(state: 'open' | 'closed'): void {
    if (state === 'closed' && !this.busy()) this.dialog.set(null);
  }

  protected async confirm(): Promise<void> {
    const current = this.dialog();
    if (!current || !this.canConfirm()) return;
    this.busy.set(true);
    try {
      const { user } = current;
      switch (current.kind) {
        case 'block':
          await this.service.block(user, this.reason().trim());
          break;
        case 'unblock':
          await this.service.unblock(user);
          break;
        case 'grant':
          await this.service.setAdmin(user, true);
          break;
        case 'revoke':
          await this.service.setAdmin(user, false);
          break;
        case 'delete':
          await this.service.delete(
            user,
            this.reason().trim(),
            this.confirmEmail().trim(),
          );
          break;
      }
      this.dialog.set(null);
    } catch {
      // The ActionRunner showed the error; the dialog stays open.
    } finally {
      this.busy.set(false);
    }
  }
}
