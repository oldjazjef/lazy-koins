import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideDownload,
  lucideExternalLink,
  lucideSparkles,
  lucideUpload,
} from '@ng-icons/lucide';
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
    MappingEditorForm,
    ...HlmBadgeImports,
    ...HlmButtonImports,
    ...HlmCardImports,
    ...HlmDialogImports,
    ...HlmTableImports,
  ],
  providers: [
    provideIcons({
      lucideDownload,
      lucideExternalLink,
      lucideSparkles,
      lucideUpload,
    }),
  ],
  templateUrl: './project-mappings.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProjectMappings {
  protected readonly service = inject(ProjectFilesService);
  protected readonly editor = inject(MappingEditorState);
  protected readonly ai = inject(AiAssistState);

  readonly closed = input(false);

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
