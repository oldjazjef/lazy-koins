import { Injectable } from '@nestjs/common';
import { missingFileHints } from '@lazykoins/engine';
import {
  CalculationSnapshotRepositoryPort,
  OpenItemStateRepositoryPort,
} from '../../calculation/ports/calculation.repository.port';
import { isActive, readsRecords } from '../../files/domain/project-file';
import { HintStateRepositoryPort } from '../../files/ports/hint-state.repository.port';
import { ProjectFileRepositoryPort } from '../../files/ports/project-file.repository.port';
import {
  changesSinceSent,
  NO_CHANGES,
} from '../../projects/domain/project-sent';
import type { Project } from '../../projects/domain/project';
import { ProjectRepositoryPort } from '../../projects/ports/project.repository.port';
import { ProjectSentRepositoryPort } from '../../projects/ports/project-sent.repository.port';
import { projectRoute, Topics } from '../domain/notification';
import { NotificationService } from './notification.service';

const NEEDS_MAPPING = 'file.needsMapping:';
const ROW_ERRORS = 'file.rowErrors:';

/**
 * The "Handlungsbedarf" conditions of a project (F11.12), derived from stored state and checked
 * again after every change that can affect them — so each one is raised while true and resolved
 * by itself once the cause is gone (F11.11): files without mapping / with row errors (a hint the
 * user marked done or ignored counts as settled), open F5.8 hints, open items and positions
 * without a price after a calculation, and "seit dem Versand geändert" (F4.7).
 *
 * Every method is a side effect of an operation that already succeeded: errors are swallowed by
 * `NotificationService`, and a failing read is caught here.
 */
@Injectable()
export class ProjectNotifications {
  constructor(
    private readonly notifications: NotificationService,
    private readonly projects: ProjectRepositoryPort,
    private readonly files: ProjectFileRepositoryPort,
    private readonly hintStates: HintStateRepositoryPort,
    private readonly snapshots: CalculationSnapshotRepositoryPort,
    private readonly itemStates: OpenItemStateRepositoryPort,
    private readonly sent: ProjectSentRepositoryPort,
  ) {}

  /** After files were added, re-read, assigned or removed: file topics, hints, sent state. */
  async filesChanged(userId: string, projectId: string): Promise<void> {
    await this.guard(userId, projectId, async (project) => {
      await this.fileTopics(userId, project);
      await this.openHints(userId, project);
      await this.sentState(userId, project);
    });
  }

  /** After a hint was marked done/ignored or opened again. */
  async hintsChanged(userId: string, projectId: string): Promise<void> {
    await this.guard(userId, projectId, async (project) => {
      await this.fileTopics(userId, project);
      await this.openHints(userId, project);
    });
  }

  /** After a calculation: open items, missing prices, hints, sent state. */
  async calculated(userId: string, projectId: string): Promise<void> {
    await this.guard(userId, projectId, async (project) => {
      await this.calculationTopics(userId, project);
      await this.openHints(userId, project);
      await this.sentState(userId, project);
    });
  }

  /** After an open item was ticked or opened again. */
  async openItemsChanged(userId: string, projectId: string): Promise<void> {
    await this.guard(userId, projectId, (project) =>
      this.calculationTopics(userId, project),
    );
  }

  /** After a send, a mark, an undo, an export or a correction (F4.7). */
  async sentChanged(userId: string, projectId: string): Promise<void> {
    await this.guard(userId, projectId, (project) =>
      this.sentState(userId, project),
    );
  }

  private async guard(
    userId: string,
    projectId: string,
    work: (project: Project) => Promise<void>,
  ): Promise<void> {
    try {
      const project = await this.projects.findById(projectId);
      if (!project || project.ownerId !== userId) return;
      await work(project);
    } catch {
      // A notification never breaks the operation that triggered it.
    }
  }

  private async fileTopics(userId: string, project: Project): Promise<void> {
    const files = await this.files.listByProject(project.id);
    const settled = new Set(
      (await this.hintStates.listByProject(project.id)).map((s) => s.hintKey),
    );
    const mapping: string[] = [];
    const errors: string[] = [];
    for (const file of files) {
      // F5.7a: a deactivated file is ignored on purpose — its topics are resolved below.
      if (!isActive(file)) continue;
      if (
        file.status === 'needs_mapping' &&
        !settled.has(`unrecognisedFile:${file.id}`)
      ) {
        const topic = Topics.fileNeedsMapping(file.id);
        mapping.push(topic);
        await this.notifications.raise(userId, topic, {
          kind: 'action',
          projectId: project.id,
          params: { name: file.displayName },
          action: projectRoute(
            project.id,
            'notifications.action.toFile',
            'files',
            { fragment: `file-${file.id}` },
          ),
        });
      } else if (
        (file.status === 'standard' || file.status === 'mapped') &&
        file.errorCount > 0 &&
        !settled.has(`rowErrors:${file.id}`)
      ) {
        const topic = Topics.fileRowErrors(file.id);
        errors.push(topic);
        await this.notifications.raise(userId, topic, {
          kind: 'action',
          projectId: project.id,
          params: { name: file.displayName, count: file.errorCount },
          action: projectRoute(
            project.id,
            'notifications.action.toHint',
            'hints',
          ),
        });
      }
    }
    await this.notifications.resolveWhere(userId, {
      projectId: project.id,
      topicPrefix: NEEDS_MAPPING,
      exceptTopics: mapping,
    });
    await this.notifications.resolveWhere(userId, {
      projectId: project.id,
      topicPrefix: ROW_ERRORS,
      exceptTopics: errors,
    });
  }

  /** Open F5.8 coverage hints (warnings and errors; file hints have their own topics). */
  private async openHints(userId: string, project: Project): Promise<void> {
    const coverage = (await this.files.listByProject(project.id))
      .filter(readsRecords)
      .flatMap((file) => file.coverage);
    const settled = new Set(
      (await this.hintStates.listByProject(project.id)).map((s) => s.hintKey),
    );
    const open = missingFileHints(project.taxYear, coverage).filter(
      (hint) => hint.severity !== 'info' && !settled.has(hint.key),
    ).length;
    await this.notifications.toggle(
      userId,
      Topics.openHints(project.id),
      open > 0,
      {
        kind: 'action',
        projectId: project.id,
        params: { count: open },
        action: projectRoute(
          project.id,
          'notifications.action.toHint',
          'hints',
        ),
      },
    );
  }

  private async calculationTopics(
    userId: string,
    project: Project,
  ): Promise<void> {
    const snapshot = await this.snapshots.latest(project.id);
    if (!snapshot) return;
    const done = new Set(
      (await this.itemStates.listByProject(project.id))
        .filter((state) => state.done)
        .map((state) => state.itemKey),
    );
    const open = snapshot.result.openItems.filter(
      (item) => !done.has(item.key),
    ).length;
    await this.notifications.toggle(
      userId,
      Topics.openItems(project.id),
      open > 0,
      {
        kind: 'action',
        projectId: project.id,
        params: { count: open },
        action: projectRoute(
          project.id,
          'notifications.action.toChecks',
          'checks',
        ),
      },
    );
    const missing = snapshot.result.totals.missingPrices;
    await this.notifications.toggle(
      userId,
      Topics.missingPrices(project.id),
      missing > 0,
      {
        kind: 'action',
        projectId: project.id,
        params: { count: missing },
        action: projectRoute(
          project.id,
          'notifications.action.toRates',
          'rates',
        ),
      },
    );
  }

  private async sentState(userId: string, project: Project): Promise<void> {
    const state = await this.sent.find(project.id);
    const changes = state
      ? changesSinceSent(
          state,
          (await this.sent.changeFacts([project.id])).get(project.id) ??
            NO_CHANGES,
        )
      : [];
    await this.notifications.toggle(
      userId,
      Topics.changedSinceSent(project.id),
      changes.length > 0,
      {
        kind: 'action',
        projectId: project.id,
        params: { reasons: changes.join(',') },
        action: projectRoute(
          project.id,
          'notifications.action.toExports',
          'exports',
        ),
      },
    );
  }
}
