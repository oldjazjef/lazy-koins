import { HttpClient } from '@angular/common/http';
import {
  computed,
  effect,
  inject,
  Injectable,
  signal,
  untracked,
} from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { apiUrl } from '../api/api-url';
import type { LibraryStatus } from '../api/api.types';
import { AuthService } from '../auth/auth.service';
import { DataChanges } from '../data/data-changes';

/** The web app: this deployment's own library — always there, never asked for. */
const WEB: LibraryStatus = {
  mode: 'web',
  available: true,
  readOnly: false,
  server: null,
  suggestions: true,
  reason: null,
};

/**
 * Where the mapping library comes from, and whether it can be used now (F5.15–F5.18). The ONE
 * place the app asks — the nav sub-item (Mappings › Bibliothek), the route guard, the files-tab
 * suggestions, the mapping page's origin line and the library pages' write actions read it.
 *
 * - **Web**: this deployment's library, always available, with publish / rate / delete.
 * - **Desktop** (no account, `authMode: 'local'`): `GET /api/library/status` — linked to a web
 *   deployment in Einstellungen › Bibliothek, switched on and online (F11.3) = available,
 *   read-only. Asked again after every settings change (link, online switch).
 */
@Injectable({ providedIn: 'root' })
export class LibraryAvailability {
  private readonly http = inject(HttpClient);
  private readonly changes = inject(DataChanges);
  readonly webApp = inject(AuthService).hasAccount;

  private readonly remote = signal<LibraryStatus | null>(null);
  private pending: Promise<LibraryStatus | null> | null = null;

  /** `null` on the desktop until the API answered (or when it could not). */
  readonly status = computed<LibraryStatus | null>(() =>
    this.webApp ? WEB : this.remote(),
  );
  readonly available = computed(() => this.status()?.available ?? false);
  /** No publish / rate / delete (the desktop). */
  readonly readOnly = computed(() => this.status()?.readOnly ?? true);
  /** "In der Bibliothek gefunden" in the files tab. */
  readonly suggestions = computed(
    () => this.available() && (this.status()?.suggestions ?? false),
  );
  /** The linked server (desktop), `null` on the web. */
  readonly server = computed(() => this.status()?.server ?? null);

  constructor() {
    if (this.webApp) return;
    // First run = the initial load (joins a request the route guard started); then again
    // after every settings change.
    let first = true;
    effect(() => {
      this.changes.globalVersion('settings');
      const force = !first;
      first = false;
      untracked(() => void this.refresh(force));
    });
  }

  /**
   * Asks the API (desktop; the web never asks). Joins a request in flight unless `force` (a
   * settings change: the answer in flight may be stale).
   */
  refresh(force = false): Promise<LibraryStatus | null> {
    if (this.webApp) return Promise.resolve(WEB);
    if (this.pending && !force) return this.pending;
    const request = firstValueFrom(
      this.http.get<LibraryStatus>(apiUrl('/library/status')),
    )
      .then((status) => {
        this.remote.set(status);
        return status;
      })
      .catch(() => this.remote())
      .finally(() => {
        if (this.pending === request) this.pending = null;
      });
    this.pending = request;
    return request;
  }

  /** For the route guard: whether the library can be opened, once that is known. */
  async canOpen(): Promise<boolean> {
    if (this.webApp) return true;
    const status = this.remote() ?? (await this.refresh());
    return status?.available ?? false;
  }
}
