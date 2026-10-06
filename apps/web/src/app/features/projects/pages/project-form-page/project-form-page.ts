import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  signal,
} from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { TranslatePipe } from '@ngx-translate/core';
import { HlmButtonImports } from '@lazykoins/ui/button';
import { HlmCardImports } from '@lazykoins/ui/card';
import { HlmInputImports } from '@lazykoins/ui/input';
import { HlmLabelImports } from '@lazykoins/ui/label';
import { HlmTextareaImports } from '@lazykoins/ui/textarea';
import { CH_CANTONS } from '../../../../core/api/api.types';
import { taxCurrencyOptions } from './tax-currency-options';
import { PageHeader } from '../../../../shared/components/page-header';
import { zodValidator } from '../../../../shared/forms/zod-validator';
import { ProjectFormSchema } from './project-form.schema';
import { ProjectFormPageService } from './project-form-page.service';

/** The tax year people usually declare: the one that just ended (F4.1). */
function lastYear(): number {
  return new Date().getFullYear() - 1;
}

@Component({
  selector: 'lk-project-form-page',
  imports: [
    ReactiveFormsModule,
    TranslatePipe,
    PageHeader,
    ...HlmButtonImports,
    ...HlmCardImports,
    ...HlmInputImports,
    ...HlmLabelImports,
    ...HlmTextareaImports,
  ],
  templateUrl: './project-form-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProjectFormPage {
  protected readonly service = inject(ProjectFormPageService);
  protected readonly cantons = CH_CANTONS;
  /** F4.1a: the country default (CH → CHF) first. */
  protected readonly currencies = signal(taxCurrencyOptions('CH'));

  protected readonly form = inject(FormBuilder).nonNullable.group(
    {
      name: [''],
      taxYear: [lastYear()],
      canton: [''],
      taxCurrency: ['CHF'],
      notes: [''],
    },
    { validators: zodValidator(ProjectFormSchema) },
  );

  constructor() {
    // F4.3: the canton of the newest project, unless the user already picked one.
    effect(() => {
      const canton = this.service.suggestedCanton();
      const control = this.form.controls.canton;
      if (canton && control.pristine && control.value === '') {
        control.setValue(canton);
      }
    });
  }

  protected submit(): void {
    this.form.markAllAsTouched();
    const parsed = ProjectFormSchema.safeParse(this.form.getRawValue());
    if (!parsed.success) return;
    void this.service
      .create({ ...parsed.data, country: 'CH' })
      .catch(() => undefined);
  }
}
