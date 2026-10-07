import { httpResource } from '@angular/common/http';
import { computed, inject, Injectable, signal } from '@angular/core';
import { Router } from '@angular/router';
import { apiErrorText } from '../../../../core/api/api-error';
import { apiUrl } from '../../../../core/api/api-url';
import type { LibraryEntryDetail } from '../../../../core/api/api.types';
import { LibraryAvailability } from '../../../../core/library/library-availability.service';
import { LibraryClient } from '../../library-client';

/**
 * Page-scoped: one library entry (F5.17) — facts, the JSON, my rating, "Übernehmen" (a private
 * copy), and for my own entry a new version and deleting it (copies others took stay). A
 * deleted or unknown entry is a 404. On the desktop (F5.18) an entry of the linked web library:
 * facts, JSON and "Übernehmen" only.
 */
@Injectable()
export class LibraryDetailPageService {
  private readonly client = inject(LibraryClient);
  private readonly router = inject(Router);
  private readonly availability = inject(LibraryAvailability);

  /** The desktop: a linked web library, no rating / new version / delete. */
  readonly readOnly = this.availability.readOnly;
  readonly server = this.availability.server;

  readonly entryId = signal<string | undefined>(undefined);

  readonly entry = httpResource<LibraryEntryDetail>(() => {
    const id = this.entryId();
    return id ? apiUrl(`/library/${id}`) : undefined;
  });

  readonly notFound = computed(() => {
    const error = this.entry.error() as { status?: number } | undefined;
    return error?.status === 404;
  });

  /** Why loading failed (a linked library: its code, e.g. `incompatibleSpec`). */
  readonly errorKey = computed(
    () => apiErrorText(this.entry.error())?.key ?? 'library.loadFailed',
  );

  readonly json = computed(() =>
    this.entry.hasValue()
      ? JSON.stringify(this.entry.value().spec, null, 2)
      : '',
  );

  readonly columns = computed(() =>
    this.entry.hasValue()
      ? this.entry.value().fingerprint.split('|').join(', ')
      : '',
  );

  readonly busy = signal(false);

  async take(): Promise<void> {
    const id = this.entryId();
    if (!id) return;
    this.busy.set(true);
    try {
      if (await this.client.take(id)) this.entry.reload();
    } finally {
      this.busy.set(false);
    }
  }

  async rate(stars: number | null): Promise<void> {
    const id = this.entryId();
    if (!id || !this.entry.hasValue()) return;
    const updated = await this.client.rate(id, stars);
    if (updated) this.entry.set({ ...this.entry.value(), ...updated });
  }

  /** Removes my entry and goes back to the library. */
  async remove(): Promise<void> {
    const id = this.entryId();
    if (!id) return;
    if (await this.client.remove(id)) {
      await this.router.navigate(['/app/mappings/library'], {
        replaceUrl: true,
      });
    }
  }
}
