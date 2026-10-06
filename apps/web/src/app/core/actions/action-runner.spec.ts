import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { NotificationService } from '../notifications/notification.service';
import { ActionRunner } from './action-runner';
import { ActionEntry, defineAction } from './action';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function createRunner() {
  const notifications = { success: vi.fn(), error: vi.fn(), info: vi.fn() };
  TestBed.configureTestingModule({
    providers: [{ provide: NotificationService, useValue: notifications }],
  });
  return { runner: TestBed.inject(ActionRunner), notifications };
}

function entryOf<R>(runner: ActionRunner, key: string): ActionEntry<R> {
  const entry = runner.status<R>(key)();
  if (!entry) throw new Error(`no tracked entry for key "${key}"`);
  return entry;
}

describe('ActionRunner', () => {
  it('tracks pending then success, and resolves with the result', async () => {
    const { runner } = createRunner();
    const work = deferred<string>();
    const action = defineAction<number, string>({ run: () => work.promise });

    const run = runner.run(action, 1, { key: 'a' });
    expect(entryOf(runner, 'a').state).toBe('pending');

    work.resolve('done');
    await expect(run).resolves.toBe('done');
    expect(entryOf(runner, 'a').state).toBe('success');
    expect(entryOf<string>(runner, 'a').result).toBe('done');
  });

  it('tracks pending then error, records the error, and rethrows', async () => {
    const { runner } = createRunner();
    const failure = new Error('boom');
    const action = defineAction<number, string>({
      run: () => Promise.reject(failure),
    });

    const run = runner.run(action, 1, { key: 'b' });

    await expect(run).rejects.toBe(failure);
    expect(entryOf(runner, 'b').state).toBe('error');
    expect(entryOf(runner, 'b').error).toBe(failure);
  });

  it('tracks different keys independently', async () => {
    const { runner } = createRunner();
    const action = defineAction<number, number>({
      run: (n) => Promise.resolve(n * 2),
    });

    await runner.run(action, 1, { key: 'x' });
    const pendingY = runner.run(action, 2, { key: 'y' });

    expect(entryOf(runner, 'x').state).toBe('success');
    await pendingY;
    expect(entryOf<number>(runner, 'y').result).toBe(4);
  });

  it('exposes a busy aggregate across all tracked keys', async () => {
    const { runner } = createRunner();
    const work = deferred<void>();
    const action = defineAction<void, void>({ run: () => work.promise });

    const run = runner.run(action, undefined, { key: 'busy-key' });
    expect(runner.busy()).toBe(true);

    work.resolve();
    await run;
    expect(runner.busy()).toBe(false);
  });

  it('retries with the original payload', async () => {
    const { runner } = createRunner();
    const action = defineAction<number, number>({
      run: (n) => Promise.resolve(n + 1),
    });

    await runner.run(action, 41, { key: 'retry-key' });
    const result = await entryOf<number>(runner, 'retry-key').retry();

    expect(result).toBe(42);
  });

  it('only exposes undo when the action defines one, and running it is tracked like any run', async () => {
    const restore = vi.fn().mockResolvedValue(undefined);
    const withUndo = defineAction<string, void>({
      run: () => Promise.resolve(),
      undo: restore,
    });
    const withoutUndo = defineAction<string, void>({
      run: () => Promise.resolve(),
    });
    const { runner } = createRunner();

    await runner.run(withUndo, 'id-1', { key: 'with-undo' });
    await runner.run(withoutUndo, 'id-1', { key: 'without-undo' });

    expect(entryOf(runner, 'without-undo').undo).toBeUndefined();

    const { undo } = entryOf(runner, 'with-undo');
    if (!undo) throw new Error('expected undo to be defined');
    await undo();

    expect(restore).toHaveBeenCalledWith('id-1', undefined);
    expect(entryOf(runner, 'with-undo:undo').state).toBe('success');
  });

  it('offers the undo closure as a toast action when the action defines one', async () => {
    const restore = vi.fn().mockResolvedValue(undefined);
    const action = defineAction<void, void>({
      run: () => Promise.resolve(),
      undo: restore,
      messages: { success: 'thing.done' },
    });
    const { runner, notifications } = createRunner();

    await runner.run(action, undefined, { key: 'with-toast-undo' });

    expect(notifications.success).toHaveBeenCalledWith(
      'thing.done',
      expect.objectContaining({ labelKey: 'actions.undo' }),
    );
  });

  it('notifies success/error from the action messages, resolved through NotificationService', async () => {
    const { runner, notifications } = createRunner();
    const ok = defineAction<void, void>({
      run: () => Promise.resolve(),
      messages: { success: 'thing.done' },
    });
    const fails = defineAction<void, void>({
      run: () => Promise.reject(new Error('nope')),
      messages: { error: 'thing.failed' },
    });

    await runner.run(ok, undefined, { key: 'ok' });
    await runner.run(fails, undefined, { key: 'fails' }).catch(() => undefined);

    expect(notifications.success).toHaveBeenCalledWith('thing.done');
    expect(notifications.error).toHaveBeenCalledWith('thing.failed');
  });

  it('extracts the server message from a failed HTTP call and appends it to the toast', async () => {
    // A ForbiddenException naming the missing permission (see PermissionsGuard) is exactly the kind
    // of detail a bare "failed" toast used to swallow.
    const { runner, notifications } = createRunner();
    const httpError = new HttpErrorResponse({
      status: 403,
      error: {
        statusCode: 403,
        message: 'Missing permission(s): group:manage',
      },
    });
    const fails = defineAction<void, void>({
      run: () => Promise.reject(httpError),
      messages: { error: 'groups.adminsFailed' },
    });

    await runner
      .run(fails, undefined, { key: 'http-fail' })
      .catch(() => undefined);

    expect(notifications.error).toHaveBeenCalledWith(
      'groups.adminsFailed',
      'Missing permission(s): group:manage',
    );
  });

  it('suppresses the notification when silent is set', async () => {
    const { runner, notifications } = createRunner();
    const action = defineAction<void, void>({
      run: () => Promise.resolve(),
      messages: { success: 'thing.done' },
    });

    await runner.run(action, undefined, { key: 'silent', silent: true });

    expect(notifications.success).not.toHaveBeenCalled();
  });
});
