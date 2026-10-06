import { DatePipe, JsonPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideDownload,
  lucideFileJson,
  lucidePencil,
  lucideSparkles,
  lucideUpload,
} from '@ng-icons/lucide';
import { TranslatePipe } from '@ngx-translate/core';
import { HlmBadgeImports } from '@lazykoins/ui/badge';
import { HlmButtonImports } from '@lazykoins/ui/button';
import { HlmCardImports } from '@lazykoins/ui/card';
import { HlmDialogImports } from '@lazykoins/ui/dialog';
import { HlmInputImports } from '@lazykoins/ui/input';
import { HlmTableImports } from '@lazykoins/ui/table';
import { HlmTextareaImports } from '@lazykoins/ui/textarea';
import type { Mapping, ProjectMapping } from '../../../../core/api/api.types';
import { MappingPreviewView } from '../mapping-preview';
import { ProjectFilesService } from '../project-files/project-files.service';
import { MappingEditorState } from './mapping-editor.state';

/**
 * The mappings a project's files are read with — visible in the project: name, platform,
 * origin, files, the JSON itself; download, upload (`.json`), a minimal editor. Creating one
 * with AI is the next phase (the button is a placeholder).
 */
@Component({
  selector: 'lk-project-mappings',
  imports: [
    DatePipe,
    JsonPipe,
    FormsModule,
    NgIcon,
    TranslatePipe,
    MappingPreviewView,
    ...HlmBadgeImports,
    ...HlmButtonImports,
    ...HlmCardImports,
    ...HlmDialogImports,
    ...HlmInputImports,
    ...HlmTableImports,
    ...HlmTextareaImports,
  ],
  providers: [
    provideIcons({
      lucideDownload,
      lucideFileJson,
      lucidePencil,
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

  readonly closed = input(false);

  protected readonly viewing = signal<Mapping | null>(null);

  protected picked(event: Event): void {
    const target = event.target as HTMLInputElement;
    const file = target.files?.[0];
    target.value = '';
    if (file) void this.service.importMappingFile(file);
  }

  protected edit(entry: ProjectMapping): void {
    this.editor.openEdit(entry.mapping, entry.files);
  }

  protected viewState(): 'open' | 'closed' {
    return this.viewing() ? 'open' : 'closed';
  }

  protected viewChanged(state: 'open' | 'closed'): void {
    if (state === 'closed') this.viewing.set(null);
  }

  protected editorState(): 'open' | 'closed' {
    return this.editor.open() ? 'open' : 'closed';
  }

  protected editorChanged(state: 'open' | 'closed'): void {
    if (state === 'closed') this.editor.close();
  }

  protected reapplyState(): 'open' | 'closed' {
    return this.editor.reapplyOffer() ? 'open' : 'closed';
  }

  protected reapplyChanged(state: 'open' | 'closed'): void {
    if (state === 'closed') this.editor.declineReapply();
  }
}
