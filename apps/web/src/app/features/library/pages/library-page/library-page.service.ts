import { httpResource } from '@angular/common/http';
import { computed, effect, inject, Injectable, signal } from '@angular/core';
import { apiErrorText } from '../../../../core/api/api-error';
import { apiUrl } from '../../../../core/api/api-url';
import type { LibraryEntry, LibrarySort } from '../../../../core/api/api.types';
import { LibraryAvailability } from '../../../../core/library/library-availability.service';
import { LibraryClient } from '../../library-client';

/** Entries the API returns at most for one search of a linked web library (F5.18). */
export const REMOTE_SEARCH_MAX = 100;

/**
 * F5.17: the mapping library — every published mapping of every user, searchable by name,
 * platform and description, filtered by platform, sorted by rating / usage / newest / name.
 * Authors appear only by pseudonym; `mine` marks my own entries (new version, delete).
 *
 * On the desktop (F5.18) the entries come from the linked web library, read-only: the search
 * goes to that server (debounced; it answers at most `REMOTE_SEARCH_MAX`), filter and sort
 * work on what came back.
 */
@Injectable({ providedIn: 'root' })
export class LibraryPageService {
  private readonly client = inject(LibraryClient);
  private readonly availability = inject(LibraryAvailability);

  /** The desktop: a linked web library, no publish / rate / delete. */
  readonly readOnly = this.availability.readOnly;
  readonly server = this.availability.server;
  private readonly remote = computed(
    () => this.availability.status()?.mode === 'remote',
  );

  /** The search sent to a linked web library (debounced copy of `search`). */
  private readonly remoteQuery = signal('');

  readonly entries = httpResource<LibraryEntry[]>(() => {
    // The desktop: wait until it is known where the library comes from.
    if (this.availability.status() === null) return undefined;
    if (!this.remote()) return apiUrl('/library');
    const query = this.remoteQuery();
    return query === ''
      ? apiUrl('/library')
      : `${apiUrl('/library')}?q=${encodeURIComponent(query)}`;
  });

  /** The linked library had more than one answer holds: refine the search. */
  readonly truncated = computed(
    () =>
      this.remote() &&
      this.entries.hasValue() &&
      this.entries.value().length >= REMOTE_SEARCH_MAX,
  );

  /** Why loading failed, in the user's language (a linked library: its code). */
  readonly errorKey = computed(
    () => apiErrorText(this.entries.error())?.key ?? 'library.loadFailed',
  );

  readonly search = signal('');
  readonly platform = signal('');
  readonly sort = signal<LibrarySort>('rating');

  readonly isEmpty = computed(
    () => this.entries.hasValue() && this.entries.value().length === 0,
  );

  readonly platforms = computed(() =>
    [
      ...new Set(
        (this.entries.hasValue() ? this.entries.value() : []).map(
          (entry) => entry.platform,
        ),
      ),
    ].sort(),
  );

  readonly visible = computed<LibraryEntry[]>(() => {
    const all = this.entries.hasValue() ? this.entries.value() : [];
    const needle = this.search().trim().toLocaleLowerCase('de-CH');
    const platform = this.platform();
    const matching = all.filter(
      (entry) =>
        (platform === '' || entry.platform === platform) &&
        (needle === '' ||
          entry.name.toLocaleLowerCase('de-CH').includes(needle) ||
          entry.platform.toLocaleLowerCase('de-CH').includes(needle) ||
          (entry.description ?? '')
            .toLocaleLowerCase('de-CH')
            .includes(needle)),
    );
    return [...matching].sort(comparator(this.sort()));
  });

  constructor() {
    let timer: ReturnType<typeof setTimeout> | undefined;
    effect((onCleanup) => {
      const text = this.search().trim();
      if (!this.remote()) return;
      timer = setTimeout(() => this.remoteQuery.set(text), 400);
      onCleanup(() => clearTimeout(timer));
    });
  }

  refresh(): void {
    this.entries.reload();
  }

  async take(entry: LibraryEntry): Promise<void> {
    if (await this.client.take(entry.id)) this.refresh();
  }

  async rate(entry: LibraryEntry, stars: number | null): Promise<void> {
    const updated = await this.client.rate(entry.id, stars);
    if (updated) this.replace(updated);
  }

  async remove(entry: LibraryEntry): Promise<void> {
    if (await this.client.remove(entry.id)) this.refresh();
  }

  private replace(updated: LibraryEntry): void {
    if (!this.entries.hasValue()) return;
    this.entries.set(
      this.entries
        .value()
        .map((entry) => (entry.id === updated.id ? updated : entry)),
    );
  }
}

export function comparator(
  sort: LibrarySort,
): (a: LibraryEntry, b: LibraryEntry) => number {
  const byName = (a: LibraryEntry, b: LibraryEntry) =>
    a.name.localeCompare(b.name, 'de-CH') || a.id.localeCompare(b.id);
  switch (sort) {
    case 'name':
      return byName;
    case 'newest':
      // ISO timestamps sort as text; newest first.
      return (a, b) =>
        b.publishedAt.localeCompare(a.publishedAt) || byName(a, b);
    case 'usage':
      return (a, b) => b.usageCount - a.usageCount || byName(a, b);
    default:
      return (a, b) =>
        (b.ratingAverage ?? 0) - (a.ratingAverage ?? 0) ||
        b.ratingCount - a.ratingCount ||
        b.usageCount - a.usageCount ||
        byName(a, b);
  }
}
