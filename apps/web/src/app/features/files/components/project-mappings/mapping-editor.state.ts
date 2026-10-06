import { computed, inject, Injectable, signal } from '@angular/core';
import type {
  Mapping,
  MappingPreview,
  ProjectFile,
  SpecIssue,
} from '../../../../core/api/api.types';
import { ProjectFilesService } from '../project-files/project-files.service';

/**
 * The minimal mapping editor (JSON text + schema validation by the API + preview against one of
 * the project's files). Shared by the files table ("Neues Mapping" for a file) and the mappings
 * list ("Bearbeiten"), so it lives next to the section's service.
 */
@Injectable()
export class MappingEditorState {
  private readonly files = inject(ProjectFilesService);

  readonly open = signal(false);
  /** Editing this stored mapping; `null` for a new one. */
  readonly mapping = signal<Mapping | null>(null);
  /** A new mapping is assigned to this file once saved. */
  readonly targetFile = signal<ProjectFile | null>(null);
  readonly text = signal('');
  readonly checkFileId = signal('');
  readonly issues = signal<readonly SpecIssue[]>([]);
  /** The text is not JSON at all (checked here, before the API is asked). */
  readonly invalidJson = signal(false);
  readonly preview = signal<MappingPreview | null>(null);
  readonly busy = signal(false);
  /** After saving an edit: how many files could be re-read with it. */
  readonly reapplyOffer = signal<{ mappingId: string; files: number } | null>(
    null,
  );

  readonly checkFile = computed(() =>
    this.files.tableFiles().find((file) => file.id === this.checkFileId()),
  );

  /** A new mapping; with a file, its header row pre-fills `match.headers`. */
  async openNew(file?: ProjectFile): Promise<void> {
    this.reset();
    this.targetFile.set(file ?? null);
    this.checkFileId.set(file?.id ?? this.files.tableFiles()[0]?.id ?? '');
    let headers: string[] = [];
    if (file) {
      try {
        const preview = await this.files.preview(file, 5);
        const rows = preview.sheets?.[0]?.rows ?? [];
        headers = (
          rows.find((row) => row.some((cell) => cell.trim() !== '')) ?? []
        )
          .map((cell) => cell.trim())
          .filter((cell) => cell !== '');
      } catch {
        headers = [];
      }
    }
    this.text.set(
      JSON.stringify(skeleton(file?.displayName ?? '', headers), null, 2),
    );
    this.open.set(true);
  }

  openEdit(mapping: Mapping, files: readonly { id: string }[] = []): void {
    this.reset();
    this.mapping.set(mapping);
    const usable = this.files.tableFiles();
    this.checkFileId.set(
      usable.find((file) => files.some((f) => f.id === file.id))?.id ??
        usable[0]?.id ??
        '',
    );
    this.text.set(JSON.stringify(mapping.spec, null, 2));
    this.open.set(true);
  }

  close(): void {
    this.open.set(false);
  }

  /** Validates (via the API) and previews the spec against the chosen file. */
  async check(): Promise<void> {
    const spec = this.parse();
    const file = this.checkFile();
    if (spec === undefined || !file) return;
    this.busy.set(true);
    try {
      const result = await this.files.checkMapping(file, { spec });
      this.issues.set(result.ok ? [] : result.issues);
      this.preview.set(result.ok ? result.preview : null);
    } catch {
      this.preview.set(null);
    } finally {
      this.busy.set(false);
    }
  }

  async save(): Promise<void> {
    const spec = this.parse();
    if (spec === undefined) return;
    this.busy.set(true);
    try {
      const existing = this.mapping();
      const saved = await this.files.saveMapping(spec, {
        mappingId: existing?.id,
        origin: 'manual',
      });
      if (!saved.ok) {
        this.issues.set(saved.issues);
        return;
      }
      this.open.set(false);
      const target = this.targetFile();
      if (!existing && target) {
        await this.files.assign(target, {
          mode: 'mapping',
          mappingId: saved.mapping.id,
        });
      } else if (existing && saved.filesUsing > 0) {
        this.reapplyOffer.set({
          mappingId: saved.mapping.id,
          files: saved.filesUsing,
        });
      }
    } catch {
      // The service has already shown the failure.
    } finally {
      this.busy.set(false);
    }
  }

  async reapply(): Promise<void> {
    const offer = this.reapplyOffer();
    this.reapplyOffer.set(null);
    if (offer) await this.files.reapply(offer.mappingId).catch(() => undefined);
  }

  declineReapply(): void {
    this.reapplyOffer.set(null);
  }

  private parse(): unknown {
    try {
      const value: unknown = JSON.parse(this.text());
      this.invalidJson.set(false);
      return value;
    } catch {
      this.invalidJson.set(true);
      this.issues.set([]);
      this.preview.set(null);
      return undefined;
    }
  }

  private reset(): void {
    this.mapping.set(null);
    this.targetFile.set(null);
    this.issues.set([]);
    this.invalidJson.set(false);
    this.preview.set(null);
    this.reapplyOffer.set(null);
  }
}

/**
 * A starting point the user completes: the file's columns as the fingerprint, the parts to fill
 * left empty (the API's issues then say exactly what is missing).
 */
export function skeleton(fileName: string, headers: readonly string[]) {
  return {
    format: 'lazy-koins-mapping',
    version: 1,
    name: fileName.replace(/\.[^.]+$/, '') || 'Neues Mapping',
    platform: '',
    match: { headers: [...headers] },
    bookings: {
      timestamp: { column: '', format: 'ymd', timeZone: 'UTC' },
      account: { value: 'main' },
      asset: { column: '' },
      quantity: { mode: 'signed', column: '' },
      kind: { columns: [''], rules: [], default: 'unknown' },
    },
  };
}
