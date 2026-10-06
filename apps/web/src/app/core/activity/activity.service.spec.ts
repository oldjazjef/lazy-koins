import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { ActionRunner } from '../actions/action-runner';
import { defineAction } from '../actions/action';
import { NotificationService } from '../notifications/notification.service';
import { ActivityService } from './activity.service';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function setup() {
  const notifications = { success: vi.fn(), error: vi.fn(), info: vi.fn() };
  TestBed.configureTestingModule({
    providers: [{ provide: NotificationService, useValue: notifications }],
  });
  return { activity: TestBed.inject(ActivityService), notifications };
}

describe('ActivityService', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('lists several running tasks, oldest first, and removes each when it ends', async () => {
    const { activity } = setup();
    const a = deferred<string>();
    const b = deferred<number>();
    const first = activity.track('activity.rates', a.promise);
    const second = activity.track('activity.upload', () => b.promise, {
      params: { count: 3 },
    });
    expect(activity.count()).toBe(2);
    expect(activity.busy()).toBe(true);
    expect(activity.tasks().map((t) => t.label)).toEqual([
      'activity.rates',
      'activity.upload',
    ]);
    expect(activity.tasks()[1]?.params()).toEqual({ count: 3 });

    b.resolve(5);
    await expect(second).resolves.toBe(5);
    expect(activity.tasks().map((t) => t.label)).toEqual(['activity.rates']);
    a.resolve('done');
    await expect(first).resolves.toBe('done');
    expect(activity.busy()).toBe(false);
  });

  it('turns into a success toast, with an action, when asked to', async () => {
    const { activity, notifications } = setup();
    const onClick = vi.fn();
    await activity.track('activity.export', Promise.resolve({ id: 'e1' }), {
      success: (result) => ({
        key: 'exports.created',
        params: { id: (result as { id: string }).id },
        action: { labelKey: 'exports.download', onClick },
      }),
    });
    expect(notifications.success).toHaveBeenCalledWith(
      'exports.created',
      { labelKey: 'exports.download', onClick },
      { id: 'e1' },
    );
    await activity.track('activity.calculate', Promise.resolve(1), {
      success: 'calculation.calculated',
    });
    expect(notifications.success).toHaveBeenLastCalledWith(
      'calculation.calculated',
    );
    // A success function may decide the toast is not needed (the dialog shows the result).
    await activity.track('activity.ai.mapping', Promise.resolve(1), {
      success: () => null,
    });
    expect(notifications.success).toHaveBeenCalledTimes(2);
  });

  it('turns into an error toast with the server reason, and rethrows', async () => {
    const { activity, notifications } = setup();
    const failure = new HttpErrorResponse({
      status: 409,
      error: { message: 'The project is closed: reopen it first' },
    });
    await expect(
      activity.track('activity.rates', Promise.reject(failure), {
        error: 'rates.refreshFailed',
      }),
    ).rejects.toBe(failure);
    expect(activity.count()).toBe(0);
    expect(notifications.error).toHaveBeenCalledWith(
      'rates.refreshFailed',
      'The project is closed: reopen it first',
    );
    // Without an error key it stays silent — the caller reports it.
    await expect(
      activity.track('activity.rates', Promise.reject(new Error('x'))),
    ).rejects.toThrow('x');
    expect(notifications.error).toHaveBeenCalledTimes(1);
  });

  it('tracks an observable (its first value) and reads progress live', async () => {
    const { activity } = setup();
    const progress = signal<{ done: number; total: number } | null>(null);
    const source = new Subject<string>();
    const tracked = activity.track('activity.upload', source, { progress });
    expect(activity.tasks()[0]?.progress()).toBeNull();
    progress.set({ done: 2, total: 5 });
    expect(activity.tasks()[0]?.progress()).toEqual({ done: 2, total: 5 });
    source.next('ok');
    await expect(tracked).resolves.toBe('ok');
    expect(activity.count()).toBe(0);
  });

  it('is what ActionRunner uses for long actions (opt-in), leaving the toast to the runner', async () => {
    const { activity, notifications } = setup();
    const runner = TestBed.inject(ActionRunner);
    const work = deferred<number>();
    const action = defineAction<void, number>({
      run: () => work.promise,
      messages: { success: 'rates.refreshed' },
    });
    const run = runner.run(action, undefined, {
      key: 'long',
      activity: { label: 'activity.rates' },
    });
    expect(activity.tasks().map((t) => t.label)).toEqual(['activity.rates']);
    work.resolve(1);
    await run;
    expect(activity.count()).toBe(0);
    expect(notifications.success).toHaveBeenCalledTimes(1);
    expect(notifications.success).toHaveBeenCalledWith('rates.refreshed');

    // Without the flag nothing is shown.
    await runner.run(action, undefined, { key: 'short' });
    expect(activity.count()).toBe(0);
  });
});
