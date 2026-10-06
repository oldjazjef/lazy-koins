import { Injectable } from '@nestjs/common';
import type {
  Notification as NotificationRow,
  Prisma,
} from '../../../generated/prisma/client';
import type {
  AppNotification,
  NotificationAction,
  NotificationKind,
  NotificationListCriteria,
  NotificationPage,
  NotificationParams,
  NotificationWrite,
  ResolveCriteria,
} from '../../../notifications/domain/notification';
import { NotificationRepositoryPort } from '../../../notifications/ports/notification.repository.port';
import { toIsoString } from '../mappers/scalar.mapper';
import { PrismaService } from '../prisma.service';

type Row = NotificationRow & { project: { name: string } | null };

function parseObject<T>(text: string | null): T | null {
  if (text === null) return null;
  try {
    const value: unknown = JSON.parse(text);
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as T)
      : null;
  } catch {
    return null;
  }
}

function toNotification(row: Row): AppNotification {
  return {
    id: row.id,
    userId: row.userId,
    projectId: row.projectId,
    projectName: row.project?.name ?? null,
    kind: row.kind as NotificationKind,
    topic: row.topic,
    titleKey: row.titleKey,
    params: parseObject<NotificationParams>(row.params) ?? {},
    action: parseObject<NotificationAction>(row.action),
    createdAt: toIsoString(row.createdAt),
    occurredAt: toIsoString(row.occurredAt),
    readAt: row.readAt ? toIsoString(row.readAt) : null,
    resolvedAt: row.resolvedAt ? toIsoString(row.resolvedAt) : null,
    dismissedAt: row.dismissedAt ? toIsoString(row.dismissedAt) : null,
  };
}

function content(write: NotificationWrite) {
  return {
    projectId: write.projectId,
    kind: write.kind,
    titleKey: write.titleKey,
    params: JSON.stringify(write.params),
    action: write.action ? JSON.stringify(write.action) : null,
  };
}

const WITH_PROJECT = { project: { select: { name: true } } } as const;

@Injectable()
export class NotificationPrismaRepository extends NotificationRepositoryPort {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async findByTopic(
    userId: string,
    topic: string,
  ): Promise<AppNotification | undefined> {
    const row = await this.prisma.notification.findUnique({
      where: { userId_topic: { userId, topic } },
      include: WITH_PROJECT,
    });
    return row ? toNotification(row) : undefined;
  }

  async create(
    userId: string,
    topic: string,
    write: NotificationWrite,
    now: string,
  ): Promise<AppNotification> {
    const at = new Date(now);
    const row = await this.prisma.notification.create({
      data: {
        userId,
        topic,
        ...content(write),
        createdAt: at,
        occurredAt: at,
      },
      include: WITH_PROJECT,
    });
    return toNotification(row);
  }

  async update(
    userId: string,
    topic: string,
    write: NotificationWrite,
    now: string,
    renew: boolean,
  ): Promise<AppNotification | undefined> {
    const existing = await this.prisma.notification.findUnique({
      where: { userId_topic: { userId, topic } },
      select: { id: true },
    });
    if (!existing) return undefined;
    const row = await this.prisma.notification.update({
      where: { id: existing.id },
      data: {
        ...content(write),
        ...(renew
          ? {
              occurredAt: new Date(now),
              readAt: null,
              resolvedAt: null,
              dismissedAt: null,
            }
          : {}),
      },
      include: WITH_PROJECT,
    });
    return toNotification(row);
  }

  async resolve(
    userId: string,
    criteria: ResolveCriteria,
    now: string,
  ): Promise<number> {
    if (criteria.topics && criteria.topics.length === 0) return 0;
    const topic: Prisma.StringFilter = {};
    if (criteria.topics) topic.in = [...criteria.topics];
    if (criteria.topicPrefix) topic.startsWith = criteria.topicPrefix;
    if (criteria.exceptTopics && criteria.exceptTopics.length > 0) {
      topic.notIn = [...criteria.exceptTopics];
    }
    const result = await this.prisma.notification.updateMany({
      where: {
        userId,
        resolvedAt: null,
        topic,
        ...(criteria.projectId !== undefined
          ? { projectId: criteria.projectId }
          : {}),
      },
      data: { resolvedAt: new Date(now) },
    });
    return result.count;
  }

  async list(
    userId: string,
    criteria: NotificationListCriteria,
  ): Promise<NotificationPage> {
    const where: Prisma.NotificationWhereInput = {
      userId,
      dismissedAt: null,
      ...(criteria.status === 'unread' ? { readAt: null } : {}),
      ...(criteria.includeResolved ? {} : { resolvedAt: null }),
      ...(criteria.kind ? { kind: criteria.kind } : {}),
      ...(criteria.projectId ? { projectId: criteria.projectId } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        include: WITH_PROJECT,
        orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
        skip: criteria.offset,
        take: criteria.limit,
      }),
      this.prisma.notification.count({ where }),
    ]);
    return { items: rows.map(toNotification), total };
  }

  countUnread(userId: string): Promise<number> {
    return this.prisma.notification.count({
      where: { userId, readAt: null, resolvedAt: null, dismissedAt: null },
    });
  }

  async markRead(userId: string, id: string, now: string): Promise<boolean> {
    const found = await this.prisma.notification.findFirst({
      where: { id, userId },
      select: { readAt: true },
    });
    if (!found) return false;
    if (!found.readAt) {
      await this.prisma.notification.update({
        where: { id },
        data: { readAt: new Date(now) },
      });
    }
    return true;
  }

  async markAllRead(userId: string, now: string): Promise<number> {
    const result = await this.prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date(now) },
    });
    return result.count;
  }

  async dismiss(userId: string, id: string, now: string): Promise<boolean> {
    const result = await this.prisma.notification.updateMany({
      where: { id, userId },
      data: { dismissedAt: new Date(now), readAt: new Date(now) },
    });
    return result.count > 0;
  }

  async hasErrorSince(
    userId: string,
    projectId: string | null,
    since: string,
  ): Promise<boolean> {
    const found = await this.prisma.notification.findFirst({
      where: {
        userId,
        projectId,
        kind: 'error',
        occurredAt: { gte: new Date(since) },
        NOT: { topic: { startsWith: 'task.' } },
      },
      select: { id: true },
    });
    return found !== null;
  }

  async prune(userId: string, before: string): Promise<number> {
    const result = await this.prisma.notification.deleteMany({
      where: {
        userId,
        occurredAt: { lt: new Date(before) },
        OR: [{ resolvedAt: { not: null } }, { dismissedAt: { not: null } }],
      },
    });
    return result.count;
  }
}
