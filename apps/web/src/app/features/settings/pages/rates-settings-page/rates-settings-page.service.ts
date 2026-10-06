import { HttpClient, httpResource } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { defineAction } from '../../../../core/actions/action';
import { ActionRunner } from '../../../../core/actions/action-runner';
import { apiUrl } from '../../../../core/api/api-url';
import type { Project } from '../../../../core/api/api.types';
import { NotificationService } from '../../../../core/notifications/notification.service';

/**
 * Einstellungen › Kurse: the projects an ESTV Kursliste can go into (rates are stored per
 * project, F7.4) and the import itself. Rate lookups on/off and the CoinGecko key live in the
 * shared `UserSettingsService`.
 */
@Injectable({ providedIn: 'root' })
export class RatesSettingsPageService {
  private readonly http = inject(HttpClient);
  private readonly actions = inject(ActionRunner);
  private readonly notifications = inject(NotificationService);

  readonly projects = httpResource<Project[]>(() => apiUrl('/projects'));

  private readonly importAction = defineAction<
    { projectId: string; file: File },
    { imported: number; skipped: number }
  >({
    run: ({ projectId, file }) =>
      firstValueFrom(
        this.http.post<{ imported: number; skipped: number }>(
          apiUrl(`/projects/${projectId}/rates/estv`),
          file,
          { headers: { 'Content-Type': 'application/octet-stream' } },
        ),
      ),
    messages: { error: 'rates.estvFailed' },
  });

  async importKursliste(projectId: string, file: File): Promise<void> {
    const result = await this.actions.run(
      this.importAction,
      { projectId, file },
      { key: 'kursliste' },
    );
    this.notifications.info('rates.estvImported', { count: result.imported });
  }
}
