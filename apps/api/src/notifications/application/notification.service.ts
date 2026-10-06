import { Injectable, Logger } from '@nestjs/common';
import {
  type AppNotification,
  defaultTitleKey,
  type NotificationWrite,
  type RaiseInput,
  type ResolveCriteria,
  RETENTION_DAYS,
  sameContent,
  sanitizeAction,
  sanitizeParams,
  TOPIC_MAX,
} from '../domain/notification';
import { NotificationRepositoryPort } from '../ports/notification.repository.port';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Raises and resolves notifications (F11.11–F11.13) — the one entry point every trigger uses.
 *
 * - `raise(userId, topic, input)` upserts by topic: no duplicates. An `event` (errors, info,
 *   success) is news every time: content updated, unread, back from resolved/dismissed. A
 *   `condition` (`action` kind: open items, missing prices) only becomes news again when its
 *   content changed or it had been resolved — a recalculation with the same 3 open items does not
 *   ring the bell again.
 * - `resolve(userId, topic)` / `resolveWhere` when the cause is gone.
 *
 * Params pass `sanitizeParams` (no keys, passwords, seed phrases — F11.13) and actions
 * `sanitizeAction`. A notification is a side effect: a storage failure is logged, never thrown
 * into the operation that triggered it.
 */
@Injectable()
export class NotificationService {
  private readonly logger = new Logger('Notifications');
  /** The clock (replaced in specs). */
  now: () => Date = () => new Date();

  constructor(private readonly repository: NotificationRepositoryPort) {}

  async raise(
    userId: string,
    topic: string,
    input: RaiseInput,
  ): Promise<AppNotification | undefined> {
    try {
      return await this.upsert(userId, topic, input);
    } catch (error) {
      this.logger.warn(
        `Could not raise ${topic.slice(0, 80)}: ${(error as Error).message}`,
      );
      return undefined;
    }
  }

  async resolve(userId: string, topic: string | readonly string[]) {
    return this.resolveWhere(userId, {
      topics: typeof topic === 'string' ? [topic] : topic,
    });
  }

  async resolveWhere(userId: string, criteria: ResolveCriteria) {
    try {
      return await this.repository.resolve(
        userId,
        criteria,
        this.now().toISOString(),
      );
    } catch (error) {
      this.logger.warn(`Could not resolve: ${(error as Error).message}`);
      return 0;
    }
  }

  /** Raises when `active`, otherwise resolves the topic — for conditions checked again and again. */
  async toggle(
    userId: string,
    topic: string,
    active: boolean,
    input: RaiseInput,
  ): Promise<void> {
    if (active) await this.raise(userId, topic, input);
    else await this.resolve(userId, topic);
  }

  private async upsert(
    userId: string,
    topic: string,
    input: RaiseInput,
  ): Promise<AppNotification | undefined> {
    if (topic.length === 0 || topic.length > TOPIC_MAX) {
      throw new Error('topic length');
    }
    const now = this.now().toISOString();
    const write: NotificationWrite = {
      projectId: input.projectId ?? null,
      kind: input.kind,
      titleKey: input.titleKey ?? defaultTitleKey(topic),
      params: sanitizeParams(input.params),
      action: sanitizeAction(input.action),
    };
    const mode =
      input.mode ?? (input.kind === 'action' ? 'condition' : 'event');
    const existing = await this.repository.findByTopic(userId, topic);
    if (!existing) {
      await this.repository.prune(
        userId,
        new Date(this.now().getTime() - RETENTION_DAYS * DAY_MS).toISOString(),
      );
      try {
        return await this.repository.create(userId, topic, write, now);
      } catch (error) {
        // Two raises of the same topic at once: the other one created it — update that row.
        const raced = await this.repository.findByTopic(userId, topic);
        if (!raced) throw error;
        return this.repository.update(userId, topic, write, now, true);
      }
    }
    const unchanged = sameContent(existing, write);
    const renew =
      mode === 'event' || !unchanged || existing.resolvedAt !== null;
    if (!renew && unchanged) return existing;
    return this.repository.update(userId, topic, write, now, renew);
  }
}
