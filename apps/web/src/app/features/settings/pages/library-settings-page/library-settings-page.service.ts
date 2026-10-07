import {
  HttpClient,
  HttpErrorResponse,
  httpResource,
} from '@angular/common/http';
import { computed, inject, Injectable, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { defineAction } from '../../../../core/actions/action';
import { ActionRunner } from '../../../../core/actions/action-runner';
import { apiErrorText } from '../../../../core/api/api-error';
import { apiUrl } from '../../../../core/api/api-url';
import {
  REMOTE_URL_PROBLEMS,
  type RemoteLibrarySettings,
  type RemoteLibraryTest,
  type RemoteUrlProblem,
  type SaveRemoteLibrarySettings,
} from '../../../../core/api/api.types';
import { NotificationService } from '../../../../core/notifications/notification.service';

const KEY = 'library-settings';

/** The `problem` of a `422 libraryUrlInvalid`, else `undefined`. */
export function urlProblemOf(error: unknown): RemoteUrlProblem | undefined {
  if (!(error instanceof HttpErrorResponse)) return undefined;
  const body = error.error as { code?: unknown; problem?: unknown } | null;
  return body?.code === 'libraryUrlInvalid' &&
    (REMOTE_URL_PROBLEMS as readonly unknown[]).includes(body.problem)
    ? (body.problem as RemoteUrlProblem)
    : undefined;
}

/**
 * Einstellungen › Bibliothek (desktop only, F5.18): the link to a web deployment's public
 * mapping library — address, on/off, suggestions on/off — and "Verbindung testen" on the form's
 * unsaved address. Saving goes through the ActionRunner (the data-refresh interceptor reports it
 * as a `settings` change, so the nav entry and the files tab follow).
 */
@Injectable({ providedIn: 'root' })
export class LibrarySettingsPageService {
  private readonly http = inject(HttpClient);
  private readonly actions = inject(ActionRunner);
  private readonly notifications = inject(NotificationService);

  readonly settings = httpResource<RemoteLibrarySettings>(() =>
    apiUrl('/settings/library'),
  );

  /** The address the server refused (shown under the field). */
  readonly urlProblem = signal<RemoteUrlProblem | null>(null);

  readonly testing = signal(false);
  readonly testResult = signal<RemoteLibraryTest | null>(null);
  /** The test's failure as an i18n key (`errors.api.libraryTimeout`, …). */
  readonly testError = signal<string | null>(null);

  private readonly saveAction = defineAction<
    SaveRemoteLibrarySettings,
    RemoteLibrarySettings
  >({
    run: (request) =>
      firstValueFrom(
        this.http.put<RemoteLibrarySettings>(
          apiUrl('/settings/library'),
          request,
        ),
      ),
  });

  private readonly status = this.actions.status<unknown>(KEY);
  readonly isSaving = computed(() => this.status()?.state === 'pending');

  async save(request: SaveRemoteLibrarySettings): Promise<boolean> {
    this.urlProblem.set(null);
    try {
      const saved = await this.actions.run(this.saveAction, request, {
        key: KEY,
        silent: true,
      });
      this.settings.set(saved);
      this.notifications.success('library.remote.saved');
      return true;
    } catch (error) {
      const problem = urlProblemOf(error);
      if (problem) this.urlProblem.set(problem);
      else this.notifications.error('settings.saveFailed', apiErrorText(error));
      return false;
    }
  }

  /** "Verbindung testen" with the typed address (nothing is stored, no user data is sent). */
  async test(url: string): Promise<void> {
    this.testing.set(true);
    this.testResult.set(null);
    this.testError.set(null);
    this.urlProblem.set(null);
    try {
      this.testResult.set(
        await firstValueFrom(
          this.http.post<RemoteLibraryTest>(apiUrl('/settings/library/test'), {
            url,
          }),
        ),
      );
    } catch (error) {
      const problem = urlProblemOf(error);
      if (problem) this.urlProblem.set(problem);
      else
        this.testError.set(apiErrorText(error)?.key ?? 'errors.status.server');
    } finally {
      this.testing.set(false);
    }
  }
}
