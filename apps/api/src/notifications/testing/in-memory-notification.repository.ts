import type {
  AppNotification,
  NotificationListCriteria,
  NotificationPage,
  NotificationWrite,
  ResolveCriteria,
} from '../domain/notification';
import { NotificationRepositoryPort } from '../ports/notification.repository.port';

/** Port double for handler specs — a real in-memory implementation, not an ORM mock. */
export class InMemoryNotificationRepository extends NotificationRepositoryPort {
  private readonly rows = new Map<string, AppNotification>();
  private seq = 0;
  /** Project names for `projectName` (the adapter joins them). */
  readonly projectNames = new Map<string, string>();

  /** Every row, dismissed and resolved ones included (for assertions). */
  all(userId?: string): AppNotification[] {
    return [...this.rows.values()].filter(
      (row) => userId === undefined || row.userId === userId,
    );
  }

  /** The row of a topic (any user when `userId` is left out). */
  topic(topic: string, userId?: string): AppNotification | undefined {
    return this.all(userId).find((row) => row.topic === topic);
  }

  async findByTopic(
    userId: string,
    topic: string,
  ): Promise<AppNotification | undefined> {
    return this.rows.get(`${userId}|${topic}`);
  }

  async create(
    userId: string,
    topic: string,
    write: NotificationWrite,
    now: string,
  ): Promise<AppNotification> {
    const key = `${userId}|${topic}`;
    if (this.rows.has(key)) throw new Error('Unique constraint (user, topic)');
    this.seq += 1;
    const row: AppNotification = {
      id: `00000000-0000-7000-8000-${String(this.seq).padStart(12, '0')}`,
      userId,
      topic,
      ...write,
      projectName: write.projectId
        ? (this.projectNames.get(write.projectId) ?? null)
        : null,
      createdAt: now,
      occurredAt: now,
      readAt: null,
      resolvedAt: null,
      dismissedAt: null,
    };
    this.rows.set(key, row);
    return row;
  }

  async update(
    userId: string,
    topic: string,
    write: NotificationWrite,
    now: string,
    renew: boolean,
  ): Promise<AppNotification | undefined> {
    const key = `${userId}|${topic}`;
    const existing = this.rows.get(key);
    if (!existing) return undefined;
    const row: AppNotification = {
      ...existing,
      ...write,
      projectName: write.projectId
        ? (this.projectNames.get(write.projectId) ?? null)
        : null,
      ...(renew
        ? { occurredAt: now, readAt: null, resolvedAt: null, dismissedAt: null }
        : {}),
    };
    this.rows.set(key, row);
    return row;
  }

  async resolve(
    userId: string,
    criteria: ResolveCriteria,
    now: string,
  ): Promise<number> {
    let count = 0;
    for (const [key, row] of this.rows) {
      if (row.userId !== userId || row.resolvedAt !== null) continue;
      if (criteria.topics && !criteria.topics.includes(row.topic)) continue;
      if (criteria.topicPrefix && !row.topic.startsWith(criteria.topicPrefix))
        continue;
      if (
        criteria.projectId !== undefined &&
        row.projectId !== criteria.projectId
      )
        continue;
      if (criteria.exceptTopics?.includes(row.topic)) continue;
      this.rows.set(key, { ...row, resolvedAt: now });
      count += 1;
    }
    return count;
  }

  async list(
    userId: string,
    criteria: NotificationListCriteria,
  ): Promise<NotificationPage> {
    const matching = this.all(userId)
      .filter(
        (row) =>
          row.dismissedAt === null &&
          (criteria.status === 'all' || row.readAt === null) &&
          (criteria.includeResolved || row.resolvedAt === null) &&
          (!criteria.kind || row.kind === criteria.kind) &&
          (!criteria.projectId || row.projectId === criteria.projectId),
      )
      .sort((a, b) =>
        a.occurredAt === b.occurredAt
          ? b.id.localeCompare(a.id)
          : b.occurredAt.localeCompare(a.occurredAt),
      );
    return {
      items: matching.slice(criteria.offset, criteria.offset + criteria.limit),
      total: matching.length,
    };
  }

  async countUnread(userId: string): Promise<number> {
    return this.all(userId).filter(
      (row) =>
        row.readAt === null &&
        row.resolvedAt === null &&
        row.dismissedAt === null,
    ).length;
  }

  async markRead(userId: string, id: string, now: string): Promise<boolean> {
    const entry = [...this.rows].find(
      ([, row]) => row.id === id && row.userId === userId,
    );
    if (!entry) return false;
    if (entry[1].readAt === null)
      this.rows.set(entry[0], { ...entry[1], readAt: now });
    return true;
  }

  async markAllRead(userId: string, now: string): Promise<number> {
    let count = 0;
    for (const [key, row] of this.rows) {
      if (row.userId === userId && row.readAt === null) {
        this.rows.set(key, { ...row, readAt: now });
        count += 1;
      }
    }
    return count;
  }

  async dismiss(userId: string, id: string, now: string): Promise<boolean> {
    const entry = [...this.rows].find(
      ([, row]) => row.id === id && row.userId === userId,
    );
    if (!entry) return false;
    this.rows.set(entry[0], {
      ...entry[1],
      dismissedAt: now,
      readAt: entry[1].readAt ?? now,
    });
    return true;
  }

  async hasErrorSince(
    userId: string,
    projectId: string | null,
    since: string,
  ): Promise<boolean> {
    return this.all(userId).some(
      (row) =>
        row.projectId === projectId &&
        row.kind === 'error' &&
        !row.topic.startsWith('task.') &&
        row.occurredAt >= since,
    );
  }

  async prune(userId: string, before: string): Promise<number> {
    let count = 0;
    for (const [key, row] of this.rows) {
      if (
        row.userId === userId &&
        row.occurredAt < before &&
        (row.resolvedAt !== null || row.dismissedAt !== null)
      ) {
        this.rows.delete(key);
        count += 1;
      }
    }
    return count;
  }
}
