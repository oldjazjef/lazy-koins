import { LkDatePipe } from '../../../../shared/format/date.pipe';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
} from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { Truncate } from '../../../../shared/components/truncate';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { HlmBadgeImports } from '@lazykoins/ui/badge';
import { HlmButtonImports } from '@lazykoins/ui/button';
import { HlmCardImports } from '@lazykoins/ui/card';
import { HlmInputImports } from '@lazykoins/ui/input';
import { HlmLabelImports } from '@lazykoins/ui/label';
import { HlmSkeletonImports } from '@lazykoins/ui/skeleton';
import { z } from 'zod';
import {
  CH_CANTONS,
  MAX_TAX_YEAR,
  MIN_TAX_YEAR,
} from '../../../../core/api/api.types';
import type { CorrectionOption } from '../../../../core/api/dashboard.types';
import { EmptyState } from '../../../../shared/components/empty-state';
import { PageHeader } from '../../../../shared/components/page-header';
import { ChfPipe } from '../../../../shared/format/number-format';
import { zodValidator } from '../../../../shared/forms/zod-validator';
import { filesByPlatform } from '../../../../shared/files/files-by-platform';
import {
  FollowUpPageService,
  type SelectionGroup,
} from './follow-up-page.service';

const FollowUpSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'projects.form.nameRequired')
    .max(120, 'projects.form.nameTooLong'),
  taxYear: z
    .number('projects.form.taxYearInvalid')
    .int('projects.form.taxYearInvalid')
    .min(MIN_TAX_YEAR, 'projects.form.taxYearInvalid')
    .max(MAX_TAX_YEAR, 'projects.form.taxYearInvalid'),
  canton: z.enum(CH_CANTONS, 'projects.form.cantonRequired'),
});

/**
 * F4.4a: create the next tax year's project from this one — name, year and canton prefilled,
 * what to take over as checkbox groups (all/none each, a summary). A page, as forms are.
 */
@Component({
  selector: 'lk-follow-up-page',
  imports: [
    Truncate,
    LkDatePipe,
    ReactiveFormsModule,
    TranslatePipe,
    ChfPipe,
    PageHeader,
    EmptyState,
    ...HlmBadgeImports,
    ...HlmButtonImports,
    ...HlmCardImports,
    ...HlmInputImports,
    ...HlmLabelImports,
    ...HlmSkeletonImports,
  ],
  providers: [FollowUpPageService],
  templateUrl: './follow-up-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FollowUpPage {
  protected readonly service = inject(FollowUpPageService);
  private readonly translate = inject(TranslateService);
  protected readonly cantons = CH_CANTONS;

  /** Route param `:id` — no default (absent params bind as `undefined`). */
  readonly id = input<string | undefined>();

  protected readonly form = inject(FormBuilder).nonNullable.group(
    { name: [''], taxYear: [0], canton: [''] },
    { validators: zodValidator(FollowUpSchema) },
  );

  protected readonly fileGroups = computed(() =>
    this.service.options.hasValue()
      ? filesByPlatform(this.service.options.value().files)
      : [],
  );

  constructor() {
    effect(() => this.service.projectId.set(this.id()));
    effect(() => {
      if (!this.service.options.hasValue()) return;
      const options = this.service.options.value();
      this.form.reset({
        name: this.translate.instant('projects.followUp.defaultName', {
          year: options.taxYear,
        }),
        taxYear: options.taxYear,
        canton: options.canton,
      });
      this.service.preselect(options);
    });
  }

  protected toggle(group: SelectionGroup, id: string): void {
    this.service.toggle(group, id);
  }

  protected all(group: SelectionGroup, all: boolean): void {
    this.service.setAll(group, all);
  }

  /** A short text for a correction (its type and what it touches). */
  protected describe(correction: CorrectionOption): string {
    const data = correction.data as Record<string, unknown>;
    if (correction.type === 'reclassify') {
      return this.translate.instant('projects.followUp.reclassify', {
        kind: this.translate.instant(`bookings.kind.${String(data['kind'])}`),
      });
    }
    const booking = data['booking'] as Record<string, string> | undefined;
    return this.translate.instant('projects.followUp.manualBooking', {
      asset: booking?.['asset'] ?? '',
      quantity: booking?.['quantity'] ?? '',
      platform: booking?.['platform'] ?? '',
    });
  }

  protected submit(): void {
    this.form.markAllAsTouched();
    const parsed = FollowUpSchema.safeParse(this.form.getRawValue());
    if (!parsed.success) return;
    void this.service.create(parsed.data).catch(() => undefined);
  }
}
