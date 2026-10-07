import { NumberPipe } from '../../../../shared/format/number-format';
import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideFileSpreadsheet,
  lucideFolderOpen,
  lucideSparkles,
  lucideUpload,
  lucideWandSparkles,
  lucideX,
} from '@ng-icons/lucide';
import { TranslatePipe } from '@ngx-translate/core';
import { HlmBadgeImports } from '@lazykoins/ui/badge';
import { HlmButtonImports } from '@lazykoins/ui/button';
import { HlmDialogImports } from '@lazykoins/ui/dialog';
import { HlmInputImports } from '@lazykoins/ui/input';
import { HlmSkeletonImports } from '@lazykoins/ui/skeleton';
import { HlmTableImports } from '@lazykoins/ui/table';
import { HlmTextareaImports } from '@lazykoins/ui/textarea';
import { Truncate } from '../../../../shared/components/truncate';
import { MappingPreviewView } from '../../../files/components/mapping-preview';
import { MappingWorkbenchService } from './mapping-workbench.service';

/**
 * The mapping editor with a sample file (state in `MappingWorkbenchService`, provided by the
 * host): "Beispieldatei" on top (drop zone, file picker, a file from a project), then the JSON
 * on the left and the sample on the right — live preview or the raw table. The host owns the
 * save/cancel buttons (a dialog footer or under the card); the AI consent is its own dialog.
 */
@Component({
  selector: 'lk-mapping-workbench',
  imports: [
    NumberPipe,
    FormsModule,
    RouterLink,
    NgIcon,
    TranslatePipe,
    MappingPreviewView,
    Truncate,
    ...HlmBadgeImports,
    ...HlmButtonImports,
    ...HlmDialogImports,
    ...HlmInputImports,
    ...HlmSkeletonImports,
    ...HlmTableImports,
    ...HlmTextareaImports,
  ],
  providers: [
    provideIcons({
      lucideFileSpreadsheet,
      lucideFolderOpen,
      lucideSparkles,
      lucideUpload,
      lucideWandSparkles,
      lucideX,
    }),
  ],
  host: { class: 'block min-w-0' },
  templateUrl: './mapping-workbench.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MappingWorkbench {
  protected readonly state = inject(MappingWorkbenchService);

  /** Prefix of the element ids (label targets). */
  readonly idPrefix = input('mapping');

  protected readonly dragging = signal(false);

  protected picked(event: Event): void {
    const target = event.target as HTMLInputElement;
    const file = target.files?.[0];
    target.value = '';
    if (file) void this.state.useFile(file);
  }

  protected dragOver(event: DragEvent): void {
    event.preventDefault();
    this.dragging.set(true);
  }

  protected dragLeave(): void {
    this.dragging.set(false);
  }

  protected drop(event: DragEvent): void {
    event.preventDefault();
    this.dragging.set(false);
    const file = event.dataTransfer?.files[0];
    if (file) void this.state.useFile(file);
  }

  /** Cells of a raw row padded to the widest row, so the table stays rectangular. */
  protected cells(row: readonly string[]): string[] {
    const width = this.state.rawWidth();
    return Array.from({ length: width }, (_, index) => row[index] ?? '');
  }

  protected aiDialogState(): 'open' | 'closed' {
    return this.state.aiStep() === 'closed' ? 'closed' : 'open';
  }

  protected aiDialogChanged(state: 'open' | 'closed'): void {
    if (state === 'closed') this.state.closeAi();
  }
}
