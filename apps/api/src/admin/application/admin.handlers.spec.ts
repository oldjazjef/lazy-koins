import { NotificationService } from '../../notifications/application/notification.service';
import { InMemoryNotificationRepository } from '../../notifications/testing/in-memory-notification.repository';
import { InMemoryAdminRepository } from '../testing/in-memory-admin.repository';
import {
  type AdminActor,
  AdminOverviewHandler,
  BlockUserCommand,
  BlockUserHandler,
  DeleteUserCommand,
  DeleteUserHandler,
  HideLibraryEntryCommand,
  HideLibraryEntryHandler,
  ListAdminAuditHandler,
  ListAdminAuditQuery,
  ListAdminUsersHandler,
  ListAdminUsersQuery,
  SetUserAdminCommand,
  SetUserAdminHandler,
} from './admin.handlers';

const ADMIN_ID = '00000000-0000-7000-8000-000000000001';
const ANNA_ID = '00000000-0000-7000-8000-000000000002';
const OTHER_ADMIN_ID = '00000000-0000-7000-8000-000000000003';
const ENTRY_ID = '00000000-0000-7000-8000-0000000000aa';

function setup() {
  const repo = new InMemoryAdminRepository();
  repo.addUser({
    id: ADMIN_ID,
    email: 'admin@lazykoins.dev',
    isPlatformAdmin: true,
  });
  repo.addUser({ id: ANNA_ID, email: 'anna@lazykoins.dev', projects: 2 });
  repo.addUser({
    id: OTHER_ADMIN_ID,
    email: 'boss@lazykoins.dev',
    isPlatformAdmin: true,
  });
  repo.library.set(ENTRY_ID, {
    id: ENTRY_ID,
    name: 'Kraken Ledger',
    platform: 'kraken',
    description: null,
    authorName: 'anna',
    authorId: ANNA_ID,
    authorEmail: 'anna@lazykoins.dev',
    version: 1,
    usageCount: 0,
    ratingCount: 0,
    publishedAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    hiddenAt: null,
    hiddenReason: null,
  });
  const notificationRepo = new InMemoryNotificationRepository();
  const notifications = new NotificationService(notificationRepo);
  const actor: AdminActor = { userId: ADMIN_ID, email: 'admin@lazykoins.dev' };
  return {
    repo,
    notificationRepo,
    actor,
    block: new BlockUserHandler(repo),
    role: new SetUserAdminHandler(repo),
    remove: new DeleteUserHandler(repo),
    hide: new HideLibraryEntryHandler(repo, notifications),
    users: new ListAdminUsersHandler(repo),
    audit: new ListAdminAuditHandler(repo),
    overview: new AdminOverviewHandler(repo),
  };
}

describe('admin handlers', () => {
  it('blocks with a reason and unblocks, both audited', async () => {
    const t = setup();
    await expect(
      t.block.execute(new BlockUserCommand(t.actor, ANNA_ID, true, '  ')),
    ).rejects.toMatchObject({ response: { code: 'reasonRequired' } });
    const blocked = await t.block.execute(
      new BlockUserCommand(t.actor, ANNA_ID, true, 'Spam in der Bibliothek'),
    );
    expect(blocked.blockedReason).toBe('Spam in der Bibliothek');
    const back = await t.block.execute(
      new BlockUserCommand(t.actor, ANNA_ID, false),
    );
    expect(back.blockedAt).toBeNull();
    expect(
      t.repo.audit.map((a) => [a.action, a.targetLabel, a.reason]),
    ).toEqual([
      ['user.block', 'anna@lazykoins.dev', 'Spam in der Bibliothek'],
      ['user.unblock', 'anna@lazykoins.dev', null],
    ]);
    expect(t.repo.audit[0]?.actorEmail).toBe('admin@lazykoins.dev');
  });

  it('never acts on the own account, and treats other admins only after revoking', async () => {
    const t = setup();
    for (const command of [
      new BlockUserCommand(t.actor, ADMIN_ID, true, 'x'),
      new SetUserAdminCommand(t.actor, ADMIN_ID, false),
    ]) {
      const handler = command instanceof BlockUserCommand ? t.block : t.role;
      await expect(handler.execute(command as never)).rejects.toMatchObject({
        response: { code: 'adminSelf' },
      });
    }
    await expect(
      t.remove.execute(
        new DeleteUserCommand(t.actor, ADMIN_ID, 'x', 'admin@lazykoins.dev'),
      ),
    ).rejects.toMatchObject({ response: { code: 'adminSelf' } });
    await expect(
      t.block.execute(new BlockUserCommand(t.actor, OTHER_ADMIN_ID, true, 'x')),
    ).rejects.toMatchObject({ response: { code: 'adminTarget' } });
    await t.role.execute(
      new SetUserAdminCommand(
        t.actor,
        OTHER_ADMIN_ID,
        false,
        'Rolle nicht mehr nötig',
      ),
    );
    const blocked = await t.block.execute(
      new BlockUserCommand(t.actor, OTHER_ADMIN_ID, true, 'x'),
    );
    expect(blocked.blockedAt).not.toBeNull();
    // A blocked account cannot be made admin.
    await expect(
      t.role.execute(new SetUserAdminCommand(t.actor, OTHER_ADMIN_ID, true)),
    ).rejects.toMatchObject({ response: { code: 'adminTarget' } });
  });

  it('grants the admin role and lists admins', async () => {
    const t = setup();
    await t.role.execute(new SetUserAdminCommand(t.actor, ANNA_ID, true));
    const admins = await t.users.execute(
      new ListAdminUsersQuery(undefined, 'admins'),
    );
    expect(admins.items.map((u) => u.email).sort()).toEqual([
      'admin@lazykoins.dev',
      'anna@lazykoins.dev',
      'boss@lazykoins.dev',
    ]);
    expect(t.repo.audit.at(-1)?.action).toBe('user.grantAdmin');
  });

  it('deletes an account only with a reason and its e-mail typed again', async () => {
    const t = setup();
    await expect(
      t.remove.execute(
        new DeleteUserCommand(t.actor, ANNA_ID, 'Auf Wunsch', 'anna@other.ch'),
      ),
    ).rejects.toMatchObject({ response: { code: 'confirmationMismatch' } });
    await expect(
      t.remove.execute(
        new DeleteUserCommand(t.actor, ANNA_ID, '', 'anna@lazykoins.dev'),
      ),
    ).rejects.toMatchObject({ response: { code: 'reasonRequired' } });
    expect(t.repo.deleted).toEqual([]);
    await t.remove.execute(
      new DeleteUserCommand(
        t.actor,
        ANNA_ID,
        'Auf Wunsch',
        ' ANNA@lazykoins.dev ',
      ),
    );
    expect(t.repo.deleted).toEqual([ANNA_ID]);
    expect(t.repo.audit.at(-1)).toMatchObject({
      action: 'user.delete',
      targetLabel: 'anna@lazykoins.dev',
      reason: 'Auf Wunsch',
    });
    await expect(
      t.remove.execute(
        new DeleteUserCommand(t.actor, ANNA_ID, 'x', 'anna@lazykoins.dev'),
      ),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('hides a library entry, tells its author why, and shows it again', async () => {
    const t = setup();
    const hidden = await t.hide.execute(
      new HideLibraryEntryCommand(t.actor, ENTRY_ID, true, 'Enthält eine IBAN'),
    );
    expect(hidden.hiddenReason).toBe('Enthält eine IBAN');
    const note = await t.notificationRepo.findByTopic(
      ANNA_ID,
      `library.hidden:${ENTRY_ID}`,
    );
    expect(note).toMatchObject({
      kind: 'info',
      params: { name: 'Kraken Ledger', reason: 'Enthält eine IBAN' },
      resolvedAt: null,
    });
    const shown = await t.hide.execute(
      new HideLibraryEntryCommand(t.actor, ENTRY_ID, false),
    );
    expect(shown.hiddenAt).toBeNull();
    expect(
      (
        await t.notificationRepo.findByTopic(
          ANNA_ID,
          `library.hidden:${ENTRY_ID}`,
        )
      )?.resolvedAt,
    ).not.toBeNull();
    const log = await t.audit.execute(new ListAdminAuditQuery());
    expect(log.items.map((a) => a.action)).toEqual([
      'library.unhide',
      'library.hide',
    ]);
  });

  it('counts for the overview', async () => {
    const t = setup();
    const overview = await t.overview.execute();
    expect(overview).toMatchObject({ users: 3, admins: 2, projects: 2 });
  });
});
