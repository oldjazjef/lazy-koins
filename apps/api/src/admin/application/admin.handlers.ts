import {
  BadRequestException,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import {
  CommandHandler,
  type ICommandHandler,
  type IQueryHandler,
  QueryHandler,
} from '@nestjs/cqrs';
import { conflict } from '../../common/http/api-errors';
import { NotificationService } from '../../notifications/application/notification.service';
import { Topics } from '../../notifications/domain/notification';
import {
  ADMIN_LIMITS,
  type AdminAuditEntry,
  type AdminLibraryEntry,
  type AdminLibraryFilter,
  type AdminOverview,
  type AdminUser,
  type AdminUserFilter,
  cleanReason,
  type Page,
} from '../domain/admin';
import { AdminRepositoryPort } from '../ports/admin.repository.port';

/** Who acts — always a platform admin (checked by `PlatformAdminGuard`). */
export interface AdminActor {
  readonly userId: string;
  readonly email: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function page(offset?: number, limit?: number) {
  return {
    offset: Math.max(0, Math.floor(offset ?? 0)),
    limit: Math.min(
      ADMIN_LIMITS.maxPageSize,
      Math.max(1, Math.floor(limit ?? ADMIN_LIMITS.pageSize)),
    ),
  };
}

function reasonOr400(reason: string | undefined): string {
  const clean = cleanReason(reason);
  if (clean === null) {
    throw new BadRequestException({
      statusCode: 400,
      error: 'Bad Request',
      message: `A reason (1–${ADMIN_LIMITS.maxReason} characters) is required`,
      code: 'reasonRequired',
    });
  }
  return clean;
}

async function loadUser(
  admin: AdminRepositoryPort,
  id: string,
): Promise<AdminUser> {
  const user = await admin.findUser(id);
  if (!user) throw new NotFoundException('No such user');
  return user;
}

function notSelf(actor: AdminActor, target: AdminUser): void {
  if (actor.userId === target.id) {
    throw conflict('adminSelf', 'Not on your own account');
  }
}

function notAdmin(target: AdminUser): void {
  if (target.isPlatformAdmin) {
    throw conflict(
      'adminTarget',
      'Revoke the admin role first, then block or delete the account',
    );
  }
}

// ------------------------------------------------------------------ queries

export class AdminOverviewQuery {}

@QueryHandler(AdminOverviewQuery)
export class AdminOverviewHandler implements IQueryHandler<
  AdminOverviewQuery,
  AdminOverview
> {
  constructor(private readonly admin: AdminRepositoryPort) {}

  execute(): Promise<AdminOverview> {
    return this.admin.overview(
      new Date(Date.now() - 30 * DAY_MS).toISOString(),
    );
  }
}

export class ListAdminUsersQuery {
  constructor(
    readonly query?: string,
    readonly filter?: AdminUserFilter,
    readonly offset?: number,
    readonly limit?: number,
  ) {}
}

@QueryHandler(ListAdminUsersQuery)
export class ListAdminUsersHandler implements IQueryHandler<
  ListAdminUsersQuery,
  Page<AdminUser>
> {
  constructor(private readonly admin: AdminRepositoryPort) {}

  execute(q: ListAdminUsersQuery): Promise<Page<AdminUser>> {
    return this.admin.listUsers({
      query: q.query,
      filter: q.filter ?? 'all',
      ...page(q.offset, q.limit),
    });
  }
}

export class ListAdminLibraryQuery {
  constructor(
    readonly query?: string,
    readonly filter?: AdminLibraryFilter,
    readonly offset?: number,
    readonly limit?: number,
  ) {}
}

@QueryHandler(ListAdminLibraryQuery)
export class ListAdminLibraryHandler implements IQueryHandler<
  ListAdminLibraryQuery,
  Page<AdminLibraryEntry>
> {
  constructor(private readonly admin: AdminRepositoryPort) {}

  execute(q: ListAdminLibraryQuery): Promise<Page<AdminLibraryEntry>> {
    return this.admin.listLibrary({
      query: q.query,
      filter: q.filter ?? 'all',
      ...page(q.offset, q.limit),
    });
  }
}

export class ListAdminAuditQuery {
  constructor(
    readonly offset?: number,
    readonly limit?: number,
  ) {}
}

@QueryHandler(ListAdminAuditQuery)
export class ListAdminAuditHandler implements IQueryHandler<
  ListAdminAuditQuery,
  Page<AdminAuditEntry>
> {
  constructor(private readonly admin: AdminRepositoryPort) {}

  execute(q: ListAdminAuditQuery): Promise<Page<AdminAuditEntry>> {
    const { offset, limit } = page(q.offset, q.limit);
    return this.admin.listAudit(offset, limit);
  }
}

// ------------------------------------------------------------------ commands

export class BlockUserCommand {
  constructor(
    readonly actor: AdminActor,
    readonly userId: string,
    readonly blocked: boolean,
    readonly reason?: string,
  ) {}
}

/** Block (with a reason) or unblock an account; never one's own or another admin's. */
@CommandHandler(BlockUserCommand)
export class BlockUserHandler implements ICommandHandler<
  BlockUserCommand,
  AdminUser
> {
  constructor(private readonly admin: AdminRepositoryPort) {}

  async execute(c: BlockUserCommand): Promise<AdminUser> {
    const target = await loadUser(this.admin, c.userId);
    notSelf(c.actor, target);
    if (c.blocked) {
      notAdmin(target);
      const reason = reasonOr400(c.reason);
      await this.admin.setBlocked(target.id, {
        atIso: new Date().toISOString(),
        reason,
      });
      await this.audit(c.actor, 'user.block', target, reason);
    } else {
      await this.admin.setBlocked(target.id, null);
      await this.audit(c.actor, 'user.unblock', target, cleanReason(c.reason));
    }
    return loadUser(this.admin, target.id);
  }

  private audit(
    actor: AdminActor,
    action: 'user.block' | 'user.unblock',
    target: AdminUser,
    reason: string | null,
  ) {
    return this.admin.addAudit({
      actorId: actor.userId,
      actorEmail: actor.email,
      action,
      targetType: 'user',
      targetId: target.id,
      targetLabel: target.email,
      reason,
    });
  }
}

export class SetUserAdminCommand {
  constructor(
    readonly actor: AdminActor,
    readonly userId: string,
    readonly admin: boolean,
    readonly reason?: string,
  ) {}
}

/** Grant or revoke the admin role — never one's own (so an admin always remains). */
@CommandHandler(SetUserAdminCommand)
export class SetUserAdminHandler implements ICommandHandler<
  SetUserAdminCommand,
  AdminUser
> {
  constructor(private readonly admin: AdminRepositoryPort) {}

  async execute(c: SetUserAdminCommand): Promise<AdminUser> {
    const target = await loadUser(this.admin, c.userId);
    notSelf(c.actor, target);
    if (c.admin && target.blockedAt) {
      throw conflict('adminTarget', 'A blocked account cannot be made admin');
    }
    await this.admin.setAdmin(target.id, c.admin);
    await this.admin.addAudit({
      actorId: c.actor.userId,
      actorEmail: c.actor.email,
      action: c.admin ? 'user.grantAdmin' : 'user.revokeAdmin',
      targetType: 'user',
      targetId: target.id,
      targetLabel: target.email,
      reason: cleanReason(c.reason),
    });
    return loadUser(this.admin, target.id);
  }
}

export class DeleteUserCommand {
  constructor(
    readonly actor: AdminActor,
    readonly userId: string,
    readonly reason: string | undefined,
    /** The account's e-mail address, typed again (the confirmation). */
    readonly confirmEmail: string | undefined,
  ) {}
}

/**
 * Deletes an account and everything it owns (F2.2, cascade) — never one's own, never an admin's.
 * Needs a reason and the account's e-mail typed again. The audit keeps the address (what was
 * deleted, by whom, why); nothing else of the account remains.
 */
@CommandHandler(DeleteUserCommand)
export class DeleteUserHandler implements ICommandHandler<
  DeleteUserCommand,
  void
> {
  constructor(private readonly admin: AdminRepositoryPort) {}

  async execute(c: DeleteUserCommand): Promise<void> {
    const target = await loadUser(this.admin, c.userId);
    notSelf(c.actor, target);
    notAdmin(target);
    const reason = reasonOr400(c.reason);
    if (
      (c.confirmEmail ?? '').trim().toLowerCase() !==
      target.email.trim().toLowerCase()
    ) {
      throw new BadRequestException({
        statusCode: 400,
        error: 'Bad Request',
        message: "Type the account's e-mail address to confirm",
        code: 'confirmationMismatch',
      });
    }
    await this.admin.addAudit({
      actorId: c.actor.userId,
      actorEmail: c.actor.email,
      action: 'user.delete',
      targetType: 'user',
      targetId: target.id,
      targetLabel: target.email,
      reason,
    });
    await this.admin.deleteUser(target.id);
  }
}

export class HideLibraryEntryCommand {
  constructor(
    readonly actor: AdminActor,
    readonly libraryId: string,
    readonly hidden: boolean,
    readonly reason?: string,
  ) {}
}

/**
 * Moderation of the public library: a hidden entry is gone for everyone (like one its author
 * deleted — copies others took keep working); its author gets a notification with the reason.
 * Showing it again resolves that notification.
 */
@CommandHandler(HideLibraryEntryCommand)
export class HideLibraryEntryHandler implements ICommandHandler<
  HideLibraryEntryCommand,
  AdminLibraryEntry
> {
  constructor(
    private readonly admin: AdminRepositoryPort,
    @Optional() private readonly notifications?: NotificationService,
  ) {}

  async execute(c: HideLibraryEntryCommand): Promise<AdminLibraryEntry> {
    const entry = await this.admin.findLibraryEntry(c.libraryId);
    if (!entry) throw new NotFoundException('No such library mapping');
    const topic = Topics.libraryHidden(entry.id);
    let reason: string | null;
    if (c.hidden) {
      reason = reasonOr400(c.reason);
      await this.admin.setLibraryHidden(entry.id, {
        atIso: new Date().toISOString(),
        reason,
      });
      await this.notifications?.raise(entry.authorId, topic, {
        kind: 'info',
        params: { name: entry.name, reason },
      });
    } else {
      reason = cleanReason(c.reason);
      await this.admin.setLibraryHidden(entry.id, null);
      await this.notifications?.resolve(entry.authorId, topic);
    }
    await this.admin.addAudit({
      actorId: c.actor.userId,
      actorEmail: c.actor.email,
      action: c.hidden ? 'library.hide' : 'library.unhide',
      targetType: 'library',
      targetId: entry.id,
      targetLabel: entry.name,
      reason,
    });
    const after = await this.admin.findLibraryEntry(entry.id);
    if (!after) throw new NotFoundException('No such library mapping');
    return after;
  }
}

export const ADMIN_HANDLERS = [
  AdminOverviewHandler,
  ListAdminUsersHandler,
  ListAdminLibraryHandler,
  ListAdminAuditHandler,
  BlockUserHandler,
  SetUserAdminHandler,
  DeleteUserHandler,
  HideLibraryEntryHandler,
];
