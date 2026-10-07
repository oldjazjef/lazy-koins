import { httpResource } from '@angular/common/http';
import { computed, inject, Injectable, signal } from '@angular/core';
import { apiUrl } from '../../../../core/api/api-url';
import type { LibraryEntry, LibrarySort } from '../../../../core/api/api.types';
import { LibraryClient } from '../../library-client';

/**
 * F5.17: the mapping library — every published mapping of every user, searchable by name,
 * platform and description, filtered by platform, sorted by rating / usage / newest / name.
 * Authors appear only by pseudonym; `mine` marks my own entries (new version, delete).
 */
@Injectable({ providedIn: 'root' })
export class LibraryPageService {
  private readonly client = inject(LibraryClient);

  readonly entries = httpResource<LibraryEntry[]>(() => apiUrl('/library'));

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
