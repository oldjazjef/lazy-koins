import { computed, inject, Injectable, signal } from '@angular/core';
import type {
  MappingPreview,
  ProjectFile,
  SpecIssue,
} from '../../../../core/api/api.types';
import {
  type CheckFileOption,
  parseSpecText,
  skeleton,
} from '../mapping-editor';
import { ProjectFilesService } from '../project-files/project-files.service';

/**
 * "Neues Mapping" for a file of the project without one: the editor (JSON + schema validation by
 * the API + preview against one of the project's files), pre-filled from the file's header row;
 * once saved, the file is read with it. Editing an existing mapping happens on the global
 * mapping page (`/app/mappings/:id`, F11.0), not here.
 */
@Injectable()
export class MappingEditorState {
  private readonly files = inject(ProjectFilesService);

  readonly open = signal(false);
  /** The new mapping is assigned to this file once saved. */
  readonly targetFile = signal<ProjectFile | null>(null);
  readonly text = signal('');
  readonly checkFileId = signal('');
  readonly issues = signal<readonly SpecIssue[]>([]);
  /** The text is not JSON at all (checked here, before the API is asked). */
  readonly invalidJson = signal(false);
  readonly preview = signal<MappingPreview | null>(null);
  readonly busy = signal(false);

  readonly checkFiles = computed<CheckFileOption[]>(() =>
    this.files
      .tableFiles()
      .map((file) => ({ id: file.id, label: file.displayName })),
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

  /**
   * F5.19 "Als Vorlage anpassen": a new mapping for the file, starting from a suggestion that
   * comes close. Headers the file lacks are dropped from `match.headers` (so the editor's
   * preview can read it); the user checks the rest and saves — only then is anything stored.
   */
  openFrom(
    file: ProjectFile,
    spec: Record<string, unknown>,
    missing: readonly string[],
  ): void {
    this.reset();
    this.targetFile.set(file);
    this.checkFileId.set(file.id);
    this.text.set(JSON.stringify(adaptedSpec(spec, missing), null, 2));
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
      const saved = await this.files.saveMapping(spec, 'manual');
      if (!saved.ok) {
        this.issues.set(saved.issues);
        return;
      }
      this.open.set(false);
      const target = this.targetFile();
      if (target) {
        await this.files.assign(target, {
          mode: 'mapping',
          mappingId: saved.mapping.id,
        });
      }
    } catch {
      // The service has already shown the failure.
    } finally {
      this.busy.set(false);
    }
  }

  private parse(): unknown {
    const parsed = parseSpecText(this.text());
    this.invalidJson.set(parsed === undefined);
    if (parsed === undefined) {
      this.issues.set([]);
      this.preview.set(null);
    }
    return parsed?.value;
  }

  private reset(): void {
    this.targetFile.set(null);
    this.issues.set([]);
    this.invalidJson.set(false);
    this.preview.set(null);
  }
}

/** A suggested spec without the fingerprint headers the file lacks (never emptied completely). */
export function adaptedSpec(
  spec: Record<string, unknown>,
  missing: readonly string[],
): Record<string, unknown> {
  const match = spec['match'];
  if (typeof match !== 'object' || match === null) return spec;
  const headers = (match as { headers?: unknown }).headers;
  if (!Array.isArray(headers)) return spec;
  const gone = new Set(missing);
  const kept = headers.filter(
    (header) => typeof header !== 'string' || !gone.has(header),
  );
  return {
    ...spec,
    match: { ...match, headers: kept.length > 0 ? kept : headers },
  };
}
