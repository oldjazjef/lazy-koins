import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslatePipe } from '@ngx-translate/core';
import { HlmBadgeImports } from '@lazykoins/ui/badge';
import { HlmButtonImports } from '@lazykoins/ui/button';
import { HlmDialogImports } from '@lazykoins/ui/dialog';
import { HlmInputImports } from '@lazykoins/ui/input';
import { HlmSkeletonImports } from '@lazykoins/ui/skeleton';
import type { FileCandidate } from '../../../../core/api/api.types';
import { Truncate } from '../../../../shared/components/truncate';
import { filesByPlatform } from '../../../../shared/files/files-by-platform';
import { LkDatePipe } from '../../../../shared/format/date.pipe';
import { SelectFilesService } from './select-files.service';

/** The button + dialog of F5.22 in a project's files area: pick files from "Dateien". */
@Component({
  selector: 'lk-select-files',
  imports: [
    FormsModule,
    Truncate,
    LkDatePipe,
    TranslatePipe,
    ...HlmBadgeImports,
    ...HlmButtonImports,
    ...HlmDialogImports,
    ...HlmInputImports,
    ...HlmSkeletonImports,
  ],
  providers: [SelectFilesService],
  templateUrl: './select-files.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SelectFiles {
  protected readonly service = inject(SelectFilesService);
  readonly projectId = input.required<string>();
  readonly disabled = input(false);
  /** Files were added: the files area reloads (DataChanges does it, too). */
  readonly added = output<number>();

  protected readonly open = signal(false);

  protected groups(files: readonly FileCandidate[]) {
    return filesByPlatform(files);
  }

  protected show(): void {
    this.open.set(true);
    void this.service.load(this.projectId());
  }

  protected state(): 'open' | 'closed' {
    return this.open() ? 'open' : 'closed';
  }

  protected changed(state: 'open' | 'closed'): void {
    if (state === 'closed') this.open.set(false);
  }

  protected async confirm(): Promise<void> {
    try {
      const count = await this.service.add(this.projectId());
      this.open.set(false);
      this.added.emit(count);
    } catch {
      // the action runner reported it
    }
  }
}
