import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideDownload,
  lucideExternalLink,
  lucideSparkles,
  lucideUpload,
} from '@ng-icons/lucide';
import type { ProjectMapping } from '../../../../core/api/api.types';
import { TranslatePipe } from '@ngx-translate/core';
import { HlmBadgeImports } from '@lazykoins/ui/badge';
import { HlmButtonImports } from '@lazykoins/ui/button';
import { HlmCardImports } from '@lazykoins/ui/card';
import { HlmDialogImports } from '@lazykoins/ui/dialog';
import { HlmTableImports } from '@lazykoins/ui/table';
import { AiAssistState } from '../ai-assist';
import { MappingEditorForm } from '../mapping-editor';
import { ProjectFilesService } from '../project-files/project-files.service';
import { MappingEditorState } from './mapping-editor.state';
import { paginate, Paginator } from '../../../../shared/components/paginator';
import { Truncate } from '../../../../shared/components/truncate';
import {
  type RowAction,
  RowActions,
} from '../../../../shared/components/row-actions';

/**
 * The mappings this project's files are read with: name (linking to the global mapping page,
 * where they are viewed, edited and deleted — F11.0), platform, origin, files; download, upload
 * of a `.json`, "Mit AI erstellen" for a file without a mapping (`AiAssistState`) and the editor
 * of a new mapping for one file (`MappingEditorState`).
 */
@Component({
  selector: 'lk-project-mappings',
  imports: [
    DatePipe,
    RouterLink,
    NgIcon,
    TranslatePipe,
    Paginator,
    Truncate,
    RowActions,
    MappingEditorForm,
    ...HlmBadgeImports,
    ...HlmButtonImports,
    ...HlmCardImports,
    ...HlmDialogImports,
    ...HlmTableImports,
  ],
  providers: [provideIcons({ lucideSparkles, lucideUpload })],
  templateUrl: './project-mappings.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProjectMappings {
  protected readonly service = inject(ProjectFilesService);
  protected readonly editor = inject(MappingEditorState);
  protected readonly ai = inject(AiAssistState);

  readonly closed = input(false);

  private readonly router = inject(Router);
  protected readonly pager = paginate(
    computed(() =>
      this.service.projectMappings.hasValue()
        ? this.service.projectMappings.value()
        : [],
    ),
    { storageKey: 'project-mappings' },
  );
  protected readonly actions: readonly RowAction<'open' | 'download'>[] = [
    { id: 'open', labelKey: 'mappings.openPage', icon: lucideExternalLink },
    {
      id: 'download',
      labelKey: 'mappings.actions.download',
      icon: lucideDownload,
    },
  ];

  protected act(action: 'open' | 'download', entry: ProjectMapping): void {
    if (action === 'download') {
      void this.service.downloadMapping(entry.mapping);
    } else {
      void this.router.navigate(['/app/mappings', entry.mapping.id]);
    }
  }

  protected fileNames(entry: ProjectMapping): string {
    return entry.files.map((file) => file.displayName).join(', ');
  }

  protected picked(event: Event): void {
    const target = event.target as HTMLInputElement;
    const file = target.files?.[0];
    target.value = '';
    if (file) void this.service.importMappingFile(file);
  }

  /** From the editor of a new mapping for a file: let the AI write it instead. */
  protected editorWithAi(): void {
    const file = this.editor.targetFile();
    this.editor.close();
    if (file) void this.ai.start(file, 'mapping');
  }

  protected editorState(): 'open' | 'closed' {
    return this.editor.open() ? 'open' : 'closed';
  }

  protected editorChanged(state: 'open' | 'closed'): void {
    if (state === 'closed') this.editor.close();
  }
}
