import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideShieldAlert, lucideUpload } from '@ng-icons/lucide';
import { TranslatePipe } from '@ngx-translate/core';
import { HlmBadgeImports } from '@lazykoins/ui/badge';
import { HlmButtonImports } from '@lazykoins/ui/button';
import { HlmDialogImports } from '@lazykoins/ui/dialog';
import { HlmInputImports } from '@lazykoins/ui/input';
import { HlmLabelImports } from '@lazykoins/ui/label';
import { HlmSkeletonImports } from '@lazykoins/ui/skeleton';
import { HlmTextareaImports } from '@lazykoins/ui/textarea';
import { LibraryPublishService } from './library-publish.service';

/**
 * F5.15: the review dialog before a mapping becomes public — source (my mapping or a `.json`),
 * privacy findings with "entfernen", the exact public JSON, pseudonym + description, explicit
 * confirmation. State in `LibraryPublishService` (provided by the host page).
 */
@Component({
  selector: 'lk-library-publish-dialog',
  imports: [
    FormsModule,
    NgIcon,
    TranslatePipe,
    ...HlmBadgeImports,
    ...HlmButtonImports,
    ...HlmDialogImports,
    ...HlmInputImports,
    ...HlmLabelImports,
    ...HlmSkeletonImports,
    ...HlmTextareaImports,
  ],
  providers: [provideIcons({ lucideShieldAlert, lucideUpload })],
  templateUrl: './publish-dialog.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LibraryPublishDialog {
  protected readonly publish = inject(LibraryPublishService);

  protected readonly title = computed(() =>
    this.publish.libraryId()
      ? 'library.publish.titleVersion'
      : 'library.publish.title',
  );

  protected state(): 'open' | 'closed' {
    return this.publish.open() ? 'open' : 'closed';
  }

  protected changed(state: 'open' | 'closed'): void {
    if (state === 'closed') this.publish.close();
  }

  protected chooseMapping(id: string): void {
    if (id) void this.publish.use({ mappingId: id });
  }

  protected picked(event: Event): void {
    const target = event.target as HTMLInputElement;
    const file = target.files?.[0];
    target.value = '';
    if (file) void this.publish.useFile(file);
  }
}
