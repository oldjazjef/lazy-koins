import { HttpClient } from '@angular/common/http';
import { computed, inject, Injectable, signal } from '@angular/core';
import type { CanMatchFn } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { apiUrl } from '../api/api-url';
import type { Me } from '../api/api.types';
import { AuthService } from '../auth/auth.service';

/**
 * Whether the signed-in person is a platform admin (`GET /api/me` → `isPlatformAdmin`). The ONE
 * place the app asks — the nav entry "Administration" and the route guard read it. The desktop
 * (no account) has no admins and never asks. The API decides on every request anyway
 * (`PlatformAdminGuard`); this only hides what would answer 403.
 */
@Injectable({ providedIn: 'root' })
export class AdminAccess {
  private readonly http = inject(HttpClient);
  private readonly hasAccount = inject(AuthService).hasAccount;
  private readonly me = signal<Me | null>(null);
  private pending: Promise<boolean> | null = null;

  readonly isAdmin = computed(() => this.me()?.isPlatformAdmin ?? false);
  /** My own account (the admin pages hide changes to it — the API refuses them). */
  readonly myId = computed(() => this.me()?.id ?? null);

  /** Asks once (joins a request in flight); `force` asks again. */
  load(force = false): Promise<boolean> {
    if (!this.hasAccount) return Promise.resolve(false);
    if (this.pending && !force) return this.pending;
    this.pending = firstValueFrom(this.http.get<Me>(apiUrl('/me')))
      .then((me) => {
        this.me.set(me);
        return me.isPlatformAdmin;
      })
      .catch(() => {
        this.pending = null;
        return false;
      });
    return this.pending;
  }
}

/** `/app/admin` only for platform admins (others never see the route). */
export const adminGuard: CanMatchFn = () => inject(AdminAccess).load();
