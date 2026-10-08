import { HttpClient } from '@angular/common/http';
import {
  computed,
  effect,
  inject,
  Injectable,
  signal,
  untracked,
} from '@angular/core';
import { type CanActivateChildFn, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { apiUrl } from '../api/api-url';
import type { SetupView } from '../api/setup.types';
import { AuthService } from '../auth/auth.service';

/**
 * The setup wizard's state for the whole app (F11.0s): whether it is finished — until then the
 * guard sends every page of /app to /app/setup and the shell hides the main navigation.
 */
@Injectable({ providedIn: 'root' })
export class SetupStateService {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  private readonly current = signal<SetupView | null>(null);
  private loading: Promise<SetupView | null> | null = null;

  readonly view = this.current.asReadonly();
  /** Known and not finished yet. */
  readonly incomplete = computed(() => this.current()?.complete === false);

  constructor() {
    // Another sign-in = another account: its own wizard state.
    effect(() => {
      if (this.auth.session() !== 'signedIn') {
        untracked(() => this.current.set(null));
      }
    });
  }

  /** The wizard's state (cached; `force` reloads). `null` when the API cannot be reached. */
  load(force = false): Promise<SetupView | null> {
    const known = this.current();
    if (known && !force) return Promise.resolve(known);
    this.loading ??= firstValueFrom(this.http.get<SetupView>(apiUrl('/setup')))
      .then((view) => {
        this.current.set(view);
        return view;
      })
      .catch(() => null)
      .finally(() => {
        this.loading = null;
      });
    return this.loading;
  }

  set(view: SetupView): void {
    this.current.set(view);
  }
}

/** Pages open while the wizard is not finished: the wizard itself and the guide (F11.21). */
const OPEN_DURING_SETUP = ['/app/setup', '/app/help'];

/**
 * F11.0s: while the wizard is not finished, every page of /app opens the wizard instead (skipped
 * optional steps count as finished) — except the help. If the API cannot be reached the app opens
 * normally.
 */
export const setupGuard: CanActivateChildFn = async (_route, state) => {
  const path = state.url.split(/[?#]/)[0] ?? '';
  if (
    OPEN_DURING_SETUP.some(
      (open) => path === open || path.startsWith(`${open}/`),
    )
  ) {
    return true;
  }
  const setup = inject(SetupStateService);
  const router = inject(Router);
  const view = await setup.load();
  return !view || view.complete ? true : router.createUrlTree(['/app/setup']);
};
