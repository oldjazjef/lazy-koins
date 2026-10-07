import { httpResource } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideLibraryBig } from '@ng-icons/lucide';
import { TranslatePipe } from '@ngx-translate/core';
import { HlmButtonImports } from '@lazykoins/ui/button';
import { apiUrl } from '../../../../core/api/api-url';
import type {
  LibraryEntry,
  LibraryFileMatches,
  TakenLibraryMapping,
} from '../../../../core/api/api.types';
import { AuthService } from '../../../../core/auth/auth.service';
import { Truncate } from '../../../../shared/components/truncate';
import { LibraryClient } from '../../library-client';
import { StarRating } from '../star-rating';

/**
 * F5.16 in the files area: "In der Bibliothek gefunden: N passende Mappings" for files that
 * need a mapping, each with a one-click "Übernehmen" (private copy + assigned to the file) —
 * shown before the AI option. Web only; nothing on the desktop, in a closed project or without
 * a match. `refresh` is any value that changes when the project's files change (the files
 * overview), so the matches follow uploads and assignments.
 */
@Component({
  selector: 'lk-library-matches',
  imports: [
    RouterLink,
    NgIcon,
    TranslatePipe,
    Truncate,
    StarRating,
    ...HlmButtonImports,
  ],
  providers: [provideIcons({ lucideLibraryBig })],
  templateUrl: './library-matches.html',
  // No box of its own: without matches it must not add a gap to the files card.
  host: { class: 'contents' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LibraryMatches {
  private readonly client = inject(LibraryClient);
  private readonly webApp = inject(AuthService).hasAccount;

  readonly projectId = input.required<string>();
  /** Only this file (the assignment dialog); all files that need a mapping otherwise. */
  readonly fileId = input<string | undefined>();
  readonly refresh = input<unknown>();
  readonly closed = input(false);
  readonly taken = output<TakenLibraryMapping>();

  protected readonly busy = signal<string | null>(null);

  protected readonly matches = httpResource<LibraryFileMatches[]>(() => {
    this.refresh();
    return this.webApp && !this.closed()
      ? apiUrl(`/projects/${this.projectId()}/library-matches`)
      : undefined;
  });

  protected readonly visible = computed<LibraryFileMatches[]>(() => {
    const all = this.matches.hasValue() ? this.matches.value() : [];
    const only = this.fileId();
    return only ? all.filter((file) => file.projectFileId === only) : all;
  });

  protected readonly count = computed(
    () =>
      new Set(
        this.visible().flatMap((file) => file.matches.map((entry) => entry.id)),
      ).size,
  );

  protected async take(
    entry: LibraryEntry,
    file: LibraryFileMatches,
  ): Promise<void> {
    this.busy.set(`${file.projectFileId}:${entry.id}`);
    try {
      const taken = await this.client.take(entry.id, {
        projectId: this.projectId(),
        projectFileId: file.projectFileId,
      });
      if (taken) {
        this.matches.reload();
        this.taken.emit(taken);
      }
    } finally {
      this.busy.set(null);
    }
  }
}
