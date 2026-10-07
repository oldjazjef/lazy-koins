import { EnvironmentInjector, createEnvironmentInjector } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { DataChanges, reloadOn } from './data-changes';

const settle = async () => {
  await new Promise((resolve) => setTimeout(resolve));
  TestBed.tick();
};

describe('DataChanges', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('counts per project, per scope, and "every project"', () => {
    const changes = TestBed.inject(DataChanges);
    changes.changed({ projectId: 'p1' });
    expect(changes.projectVersion('p1')).toBe(1);
    expect(changes.projectVersion('p2')).toBe(0);
    // A project change is a change to the list of projects, too.
    expect(changes.globalVersion('projects')).toBe(1);
    expect(changes.globalVersion('mappings')).toBe(0);

    // A mapping edited: every project may read its files anew.
    changes.changed({ projectId: null, scope: 'mappings' });
    expect(changes.projectVersion('p1')).toBe(2);
    expect(changes.projectVersion('p2')).toBe(1);
    expect(changes.projectVersion(undefined)).toBe(1);
    expect(changes.globalVersion('mappings')).toBe(1);
    expect(changes.globalVersion('projects')).toBe(2);

    // No project: only the scopes.
    changes.changed({ scope: ['settings', 'notifications'] });
    expect(changes.projectVersion('p1')).toBe(2);
    expect(changes.globalVersion('projects')).toBe(2);
    expect(changes.globalVersion('settings')).toBe(1);
    expect(changes.globalVersion('notifications')).toBe(1);
  });
});

describe('reloadOn', () => {
  afterEach(() => TestBed.resetTestingModule());

  function setup() {
    const changes = TestBed.inject(DataChanges);
    const reload = vi.fn();
    const injector = createEnvironmentInjector(
      [],
      TestBed.inject(EnvironmentInjector),
    );
    reloadOn(() => changes.projectVersion('p1'), [{ reload }], { injector });
    return { changes, reload, injector };
  }

  it('does not reload on the first run (the resource loads by itself)', async () => {
    const { reload } = setup();
    await settle();
    expect(reload).not.toHaveBeenCalled();
  });

  it('reloads once per tick, however many changes came in', async () => {
    const { changes, reload } = setup();
    await settle();
    changes.changed({ projectId: 'p1' });
    changes.changed({ projectId: 'p1' });
    changes.changed({ projectId: null, scope: 'wallets' });
    await settle();
    expect(reload).toHaveBeenCalledTimes(1);
    changes.changed({ projectId: 'p2' });
    await settle();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('stops with its injector (the page left)', async () => {
    const { changes, reload, injector } = setup();
    await settle();
    injector.destroy();
    changes.changed({ projectId: 'p1' });
    await settle();
    expect(reload).not.toHaveBeenCalled();
  });
});
