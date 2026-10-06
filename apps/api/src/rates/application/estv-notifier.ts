import { Injectable } from '@nestjs/common';
import { NotificationService } from '../../notifications/application/notification.service';
import { projectRoute, Topics } from '../../notifications/domain/notification';
import { ProjectRepositoryPort } from '../../projects/ports/project.repository.port';

/** One year's outcome of a Kursliste check, as the notifier needs it. */
export interface EstvCheckEvent {
  readonly year: number;
  readonly outcome: 'updated' | 'current' | 'failed';
  /** `EstvSourceError.code`, or `processing` for anything else; null on success. */
  readonly code: string | null;
  /** The label of the stored version after an update (`ESTV-Kursliste 2025, Stand …`). */
  readonly label: string | null;
}

/**
 * F7.4a → F11.12: makes the deployment-wide ESTV checks visible — the daily scheduler's as much
 * as a manual "aktualisieren". Concerned are the owners of the year's open projects and whoever
 * started the run: a failure → "ESTV-Kursliste konnte nicht bezogen werden" (Erneut versuchen),
 * success resolves it; a new version → per open project "neue Fassung verfügbar" (resolved when
 * the project takes it over, `EstvProjectRatesService.apply`).
 */
@Injectable()
export class EstvNotifier {
  constructor(
    private readonly notifications: NotificationService,
    private readonly projects: ProjectRepositoryPort,
  ) {}

  async checked(
    event: EstvCheckEvent,
    requestedBy: ReadonlySet<string>,
  ): Promise<void> {
    try {
      const open = (await this.projects.findByTaxYear(event.year)).filter(
        (project) => project.status !== 'closed',
      );
      const users = new Set([
        ...open.map((project) => project.ownerId),
        ...requestedBy,
      ]);
      const topic = Topics.estvFetchFailed(event.year);
      for (const userId of users) {
        if (event.outcome === 'failed') {
          await this.notifications.raise(userId, topic, {
            kind: 'error',
            params: { year: event.year, reason: event.code ?? 'processing' },
            action: {
              labelKey: 'notifications.action.retry',
              route: '/app/settings/rates',
              named: 'retry:estv',
            },
          });
        } else {
          await this.notifications.resolve(userId, topic);
        }
      }
      if (event.outcome !== 'updated') return;
      for (const project of open) {
        await this.notifications.raise(
          project.ownerId,
          Topics.estvNewVersion(project.id),
          {
            kind: 'info',
            projectId: project.id,
            params: { year: event.year, label: event.label ?? '' },
            action: projectRoute(
              project.id,
              'notifications.action.toRates',
              'rates',
            ),
          },
        );
      }
    } catch {
      // A notification never breaks the check.
    }
  }

  /** The project took the stored version over: its "neue Fassung" is done. */
  async applied(ownerId: string, projectId: string): Promise<void> {
    await this.notifications.resolve(ownerId, Topics.estvNewVersion(projectId));
  }
}
