import type {
  AppNotification,
  NotificationListCriteria,
  NotificationPage,
  NotificationWrite,
  ResolveCriteria,
} from '../domain/notification';

/**
 * The notification centre's storage (F11.11). Every method is scoped to one user: an id of
 * someone else's notification behaves exactly like a missing one. Timestamps are ISO strings.
 */
export abstract class NotificationRepositoryPort {
  abstract findByTopic(
    userId: string,
    topic: string,
  ): Promise<AppNotification | undefined>;

  /** A new row (unread, unresolved). Throws when the topic exists for the user (unique). */
  abstract create(
    userId: string,
    topic: string,
    write: NotificationWrite,
    now: string,
  ): Promise<AppNotification>;

  /**
   * Replaces the content of a topic's row. `renew`: occurred now, unread, unresolved, not
   * dismissed again (news); otherwise only the content changes.
   */
  abstract update(
    userId: string,
    topic: string,
    write: NotificationWrite,
    now: string,
    renew: boolean,
  ): Promise<AppNotification | undefined>;

  /** Marks the matching, not yet resolved notifications as resolved; returns how many. */
  abstract resolve(
    userId: string,
    criteria: ResolveCriteria,
    now: string,
  ): Promise<number>;

  /** Newest first (by `occurredAt`), never dismissed ones. */
  abstract list(
    userId: string,
    criteria: NotificationListCriteria,
  ): Promise<NotificationPage>;

  /** Unread, unresolved, not dismissed — the bell's badge. */
  abstract countUnread(userId: string): Promise<number>;

  /** `false` when there is no such notification of this user. */
  abstract markRead(userId: string, id: string, now: string): Promise<boolean>;

  abstract markAllRead(userId: string, now: string): Promise<number>;

  /** Hidden from every list; a later change of its cause brings it back. */
  abstract dismiss(userId: string, id: string, now: string): Promise<boolean>;

  /** Whether an `error` was raised for this project (or none: `null`) since `since`. */
  abstract hasErrorSince(
    userId: string,
    projectId: string | null,
    since: string,
  ): Promise<boolean>;

  /** Deletes resolved or dismissed notifications that last occurred before `before`. */
  abstract prune(userId: string, before: string): Promise<number>;
}
