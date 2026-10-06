import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { HlmButtonImports } from '@lazykoins/ui/button';
import { HlmDialogImports } from '@lazykoins/ui/dialog';
import { HlmSkeletonImports } from '@lazykoins/ui/skeleton';
import type { TakeOverSource } from '../../../../core/api/dashboard.types';
import { filesByPlatform } from '../../../../shared/files/files-by-platform';
import { TakeOverFilesService } from './take-over-files.service';

/** The button + dialog of F4.4 in a project's files area. */
@Component({
  selector: 'lk-take-over-files',
  imports: [
    DatePipe,
    TranslatePipe,
    ...HlmButtonImports,
    ...HlmDialogImports,
    ...HlmSkeletonImports,
  ],
  providers: [TakeOverFilesService],
  templateUrl: './take-over-files.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TakeOverFiles {
  protected readonly service = inject(TakeOverFilesService);
  readonly projectId = input.required<string>();
  readonly disabled = input(false);
  /** Files were linked: the files area reloads. */
  readonly added = output<number>();

  protected readonly open = signal(false);
  protected groups<T extends { readonly platform: string | null }>(
    files: readonly T[],
  ) {
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

  protected selectable(source: TakeOverSource): number {
    return source.files.filter((f) => !f.inTarget).length;
  }

  protected async confirm(): Promise<void> {
    try {
      const count = await this.service.takeOver(this.projectId());
      this.open.set(false);
      this.added.emit(count);
    } catch {
      // the action runner reported it
    }
  }
}
