import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
} from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { HlmBadgeImports } from '@lazykoins/ui/badge';
import { HlmButtonImports } from '@lazykoins/ui/button';
import { HlmCardImports } from '@lazykoins/ui/card';
import { HlmInputImports } from '@lazykoins/ui/input';
import { HlmLabelImports } from '@lazykoins/ui/label';
import { HlmSkeletonImports } from '@lazykoins/ui/skeleton';
import { z } from 'zod';
import { LibraryAvailability } from '../../../../core/library/library-availability.service';
import { PageHeader } from '../../../../shared/components/page-header';
import { zodValidator } from '../../../../shared/forms/zod-validator';
import { LibrarySettingsPageService } from './library-settings-page.service';

export const LibrarySettingsSchema = z.object({
  url: z.string().trim().max(300, 'library.remote.urlProblems.tooLong'),
  enabled: z.boolean(),
  suggestions: z.boolean(),
});

/**
 * Einstellungen › Bibliothek (desktop only, F5.18): the address of a web deployment whose
 * mapping library this app may read (empty by default — then the app never goes online for
 * it), on/off, suggestions in the files tab on/off, "Verbindung testen", and a plain statement
 * of what leaves the device.
 */
@Component({
  selector: 'lk-library-settings-page',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    TranslatePipe,
    PageHeader,
    ...HlmBadgeImports,
    ...HlmButtonImports,
    ...HlmCardImports,
    ...HlmInputImports,
    ...HlmLabelImports,
    ...HlmSkeletonImports,
  ],
  templateUrl: './library-settings-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LibrarySettingsPage {
  protected readonly service = inject(LibrarySettingsPageService);
  protected readonly library = inject(LibraryAvailability);

  protected readonly form = inject(FormBuilder).nonNullable.group(
    {
      url: [''],
      enabled: [false],
      suggestions: [true],
    },
    { validators: zodValidator(LibrarySettingsSchema) },
  );

  constructor() {
    effect(() => {
      if (!this.service.settings.hasValue() || this.form.dirty) return;
      const saved = this.service.settings.value();
      this.form.reset({
        url: saved.url,
        enabled: saved.enabled,
        suggestions: saved.suggestions,
      });
    });
  }

  protected async save(): Promise<void> {
    const parsed = LibrarySettingsSchema.safeParse(this.form.getRawValue());
    if (!parsed.success) return;
    const value = {
      ...parsed.data,
      // No address = switched off (the API does the same).
      enabled: parsed.data.url === '' ? false : parsed.data.enabled,
    };
    if (await this.service.save(value)) this.form.reset(value);
  }

  protected test(): void {
    void this.service.test(this.form.controls.url.value.trim());
  }
}
