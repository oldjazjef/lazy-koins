import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  type WritableSignal,
} from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideSparkles, lucideWandSparkles } from '@ng-icons/lucide';
import { TranslatePipe } from '@ngx-translate/core';
import { HlmBadgeImports } from '@lazykoins/ui/badge';
import { HlmButtonImports } from '@lazykoins/ui/button';
import { HlmSkeletonImports } from '@lazykoins/ui/skeleton';
import {
  BOOKING_KINDS,
  type BookingKind,
  type FileSuggestions,
  type MappingSuggestion,
  type SuggestionPreview,
} from '../../../../core/api/api.types';
import { LibraryAvailability } from '../../../../core/library/library-availability.service';
import { Truncate } from '../../../../shared/components/truncate';
import { StarRating } from '../../../library/components/star-rating';
import { MappingPreviewView } from '../mapping-preview';
import { ProjectFilesService } from '../project-files/project-files.service';

/** What the host does for a file: "Mit AI erstellen", "Neues Mapping", "Als Vorlage anpassen". */
export interface SuggestionAdapt {
  readonly fileId: string;
  readonly spec: Record<string, unknown>;
  readonly missing: readonly string[];
}

type PreviewState =
  | { readonly state: 'loading' }
  | { readonly state: 'ready'; readonly preview: SuggestionPreview }
  | { readonly state: 'failed' };

/** "Übereinstimmung 83 %" — whole percent, never more than shown. */
export function coveragePercent(suggestion: MappingSuggestion): number {
  return Math.floor(suggestion.coverage * 100);
}

/** The kind counts of a preview in the closed list's order (unknown last as in the list). */
export function kindEntries(
  preview: SuggestionPreview,
): { kind: BookingKind; count: number }[] {
  return BOOKING_KINDS.filter(
    (kind) => (preview.kindCounts[kind] ?? 0) > 0,
  ).map((kind) => ({ kind, count: preview.kindCounts[kind] ?? 0 }));
}

/**
 * F5.19 "Mapping beim Upload vorschlagen": for files that need a mapping, the best suggestion
 * with where it comes from (eigenes / Standard-Mapping / Bibliothek), how well it fits, a preview
 * of what it reads (kind counts, unknown values, row errors, first records) and one click to
 * take it — or the other suggestions, "Mit AI erstellen", "Neues Mapping". A near match offers
 * "Als Vorlage anpassen" (the editor, nothing stored before saving). Nothing is assigned without
 * the user's click; nothing at all in a closed project (F4.5).
 *
 * In the files card it lists every waiting file; with `fileId` (the assignment dialog) only that
 * one. The data lives in `ProjectFilesService.suggestions` (one request, shared).
 */
@Component({
  selector: 'lk-mapping-suggestions',
  imports: [
    NgIcon,
    TranslatePipe,
    Truncate,
    StarRating,
    MappingPreviewView,
    ...HlmBadgeImports,
    ...HlmButtonImports,
    ...HlmSkeletonImports,
  ],
  providers: [provideIcons({ lucideWandSparkles, lucideSparkles })],
  templateUrl: './mapping-suggestions.html',
  host: { class: 'contents' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MappingSuggestions {
  protected readonly files = inject(ProjectFilesService);
  private readonly library = inject(LibraryAvailability);
  protected readonly server = this.library.server;

  /** Only this file (the assignment dialog). */
  readonly fileId = input<string | undefined>();
  readonly closed = input(false);
  /** A suggestion was taken (the dialog closes). */
  readonly taken = output<void>();
  readonly withAi = output<string>();
  readonly newMapping = output<string>();
  readonly adapt = output<SuggestionAdapt>();

  protected readonly visible = computed<FileSuggestions[]>(() => {
    if (this.closed() || !this.files.suggestions.hasValue()) return [];
    const all = this.files.suggestions.value().files;
    const only = this.fileId();
    return only ? all.filter((file) => file.projectFileId === only) : all;
  });

  protected readonly libraryUnavailable = computed(
    () =>
      this.files.suggestions.hasValue() &&
      this.files.suggestions.value().library === 'unavailable',
  );

  /** The suggestion shown per file (index into its list); 0 = the best. */
  private readonly chosen = signal<ReadonlyMap<string, string>>(new Map());
  /** "Andere Vorschläge" opened per file. */
  protected readonly othersOpen = signal<ReadonlySet<string>>(new Set());
  /** The full preview table opened per file. */
  protected readonly detailsOpen = signal<ReadonlySet<string>>(new Set());
  protected readonly previews = signal<ReadonlyMap<string, PreviewState>>(
    new Map(),
  );
  protected readonly busy = signal<string | null>(null);

  constructor() {
    // New suggestions (a change to the project or my mappings): previews are read again.
    effect(() => {
      this.files.suggestions.value();
      untracked(() => this.previews.set(new Map()));
    });
    // The preview of every shown suggestion that reads its file — loaded once per suggestion.
    effect(() => {
      for (const file of this.visible()) {
        const shown = this.shown(file);
        if (!shown?.reads) continue;
        const key = previewKey(file.projectFileId, shown);
        if (untracked(() => this.previews().has(key))) continue;
        untracked(() => void this.loadPreview(file.projectFileId, shown, key));
      }
    });
  }

  protected shown(file: FileSuggestions): MappingSuggestion | undefined {
    const id = this.chosen().get(file.projectFileId);
    return (
      file.suggestions.find((s) => `${s.source}:${s.id}` === id) ??
      file.suggestions[0]
    );
  }

  protected others(file: FileSuggestions): MappingSuggestion[] {
    const shown = this.shown(file);
    return file.suggestions.filter((s) => s !== shown);
  }

  protected previewStatus(
    file: FileSuggestions,
    suggestion: MappingSuggestion,
  ): PreviewState['state'] | undefined {
    return this.previews().get(previewKey(file.projectFileId, suggestion))
      ?.state;
  }

  protected readyPreview(
    file: FileSuggestions,
    suggestion: MappingSuggestion,
  ): SuggestionPreview | null {
    const state = this.previews().get(
      previewKey(file.projectFileId, suggestion),
    );
    return state?.state === 'ready' ? state.preview : null;
  }

  protected percent = coveragePercent;
  protected kinds = kindEntries;

  protected sourceKey(suggestion: MappingSuggestion): string {
    return `files.suggestions.source.${suggestion.source}`;
  }

  protected show(file: FileSuggestions, suggestion: MappingSuggestion): void {
    const next = new Map(this.chosen());
    next.set(file.projectFileId, `${suggestion.source}:${suggestion.id}`);
    this.chosen.set(next);
    this.toggle(this.othersOpen, file.projectFileId, false);
  }

  protected toggleOthers(file: FileSuggestions): void {
    this.toggle(this.othersOpen, file.projectFileId);
  }

  protected toggleDetails(file: FileSuggestions): void {
    this.toggle(this.detailsOpen, file.projectFileId);
  }

  protected isOpen(set: ReadonlySet<string>, file: FileSuggestions): boolean {
    return set.has(file.projectFileId);
  }

  protected async take(
    file: FileSuggestions,
    suggestion: MappingSuggestion,
  ): Promise<void> {
    this.busy.set(file.projectFileId);
    try {
      const done = await this.files.takeSuggestion(
        { id: file.projectFileId },
        suggestion,
      );
      if (done) this.taken.emit();
    } finally {
      this.busy.set(null);
    }
  }

  protected async startAdapt(
    file: FileSuggestions,
    suggestion: MappingSuggestion,
  ): Promise<void> {
    this.busy.set(file.projectFileId);
    try {
      const spec = await this.files.suggestionSpec(suggestion);
      this.adapt.emit({
        fileId: file.projectFileId,
        spec,
        missing: suggestion.missing,
      });
    } catch {
      // The entry may be gone (library) — the list reloads with the next change.
    } finally {
      this.busy.set(null);
    }
  }

  private async loadPreview(
    fileId: string,
    suggestion: MappingSuggestion,
    key: string,
  ): Promise<void> {
    this.setPreview(key, { state: 'loading' });
    try {
      const preview = await this.files.suggestionPreview(
        { id: fileId },
        suggestion,
      );
      this.setPreview(key, { state: 'ready', preview });
    } catch {
      this.setPreview(key, { state: 'failed' });
    }
  }

  private setPreview(key: string, state: PreviewState): void {
    const next = new Map(this.previews());
    next.set(key, state);
    this.previews.set(next);
  }

  private toggle(
    target: WritableSignal<ReadonlySet<string>>,
    id: string,
    open?: boolean,
  ): void {
    const next = new Set(target());
    const want = open ?? !next.has(id);
    if (want) next.add(id);
    else next.delete(id);
    target.set(next);
  }
}

function previewKey(fileId: string, suggestion: MappingSuggestion): string {
  return `${fileId}|${suggestion.source}:${suggestion.id}`;
}
