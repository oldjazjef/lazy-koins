import {
  effect,
  type EffectRef,
  inject,
  Injectable,
  Injector,
  signal,
  untracked,
  type WritableSignal,
} from '@angular/core';

/**
 * What a change touched besides one project's data:
 * - `projects` — the project list and everything over all projects (dashboard); bumped by every
 *   project change, too.
 * - `mappings`, `wallets` — the user's global mappings / wallets (they feed every project).
 * - `rates` — rates outside a project (ESTV Kursliste, the dashboard's rate cache).
 * - `settings` — profile, AI, mail, MCP, wallet services, setup.
 * - `notifications` — the notification centre.
 */
export const DATA_SCOPES = [
  'projects',
  'mappings',
  'wallets',
  'rates',
  'settings',
  'notifications',
  // F5.21: my files (the "Dateien" page) — uploads, readings, selections, deletions.
  'files',
] as const;
export type DataScope = (typeof DATA_SCOPES)[number];

export interface DataChange {
  /**
   * The project whose data changed: an id; `null` = every project (unknown which, or all of them:
   * a mapping or a wallet feeds every project that uses it); absent = no project.
   */
  readonly projectId?: string | null;
  readonly scope?: DataScope | readonly DataScope[];
}

/** Anything with `reload()` — an `httpResource`, or `{ reload: () => … }`. */
export interface Reloadable {
  reload(): unknown;
}

/**
 * The ONE place that knows "something changed" (user rule 08.10.2026: „Änderungen sollen alles
 * updaten“). Every successful mutating API request reports itself here (`dataChangesInterceptor`
 * derives the project and scopes from its URL); explicit calls cover what a URL cannot say (a
 * confirmed assistant proposal names its project only in its answer).
 *
 * Readers do not subscribe: a page service reads `projectVersion(id)` / `globalVersion(scope)`
 * through `reloadOn`, so a resource refetches after a change — several changes in one tick are
 * one refetch (signals coalesce), and a resource that is not alive (its page left) or not
 * requested (a tab not shown) is never fetched.
 */
@Injectable({ providedIn: 'root' })
export class DataChanges {
  private readonly allProjects = signal(0);
  private readonly perProject = new Map<string, WritableSignal<number>>();
  private readonly perScope = new Map<DataScope, WritableSignal<number>>(
    DATA_SCOPES.map((scope) => [scope, signal(0)]),
  );

  changed(change: DataChange): void {
    const scopes = new Set<DataScope>(
      change.scope === undefined
        ? []
        : typeof change.scope === 'string'
          ? [change.scope]
          : change.scope,
    );
    if (typeof change.projectId === 'string') {
      bump(this.projectSignal(change.projectId));
      scopes.add('projects');
    } else if (change.projectId === null) {
      bump(this.allProjects);
      scopes.add('projects');
    }
    for (const scope of scopes) {
      const tick = this.perScope.get(scope);
      if (tick) bump(tick);
    }
  }

  /** Changes when this project's data changed (also by a change to every project). */
  projectVersion(projectId: string | null | undefined): number {
    const all = this.allProjects();
    return projectId ? all + this.projectSignal(projectId)() : all;
  }

  /** Changes on every change of that scope. */
  globalVersion(scope: DataScope): number {
    return this.perScope.get(scope)?.() ?? 0;
  }

  private projectSignal(projectId: string): WritableSignal<number> {
    let tick = this.perProject.get(projectId);
    if (!tick) {
      tick = signal(0);
      this.perProject.set(projectId, tick);
    }
    return tick;
  }
}

function bump(tick: WritableSignal<number>): void {
  tick.update((value) => value + 1);
}

/**
 * Reloads the resources whenever `version` changes — not on the first run (the resources load by
 * themselves). `reload()` keeps the value on screen while it refetches (no skeleton flash) and is
 * a no-op for a resource without a request (a tab not shown) or one that is loading anyway.
 * Call it in an injection context; it ends with that context (page left, component destroyed).
 */
export function reloadOn(
  version: () => unknown,
  resources: readonly Reloadable[],
  options: { injector?: Injector } = {},
): EffectRef {
  let seen: unknown;
  let first = true;
  return effect(
    () => {
      const current = version();
      if (first || Object.is(current, seen)) {
        first = false;
        seen = current;
        return;
      }
      seen = current;
      untracked(() => {
        for (const resource of resources) resource.reload();
      });
    },
    { injector: options.injector ?? inject(Injector) },
  );
}
