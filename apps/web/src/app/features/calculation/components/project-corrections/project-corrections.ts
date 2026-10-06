import { DatePipe, JsonPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { TranslatePipe } from '@ngx-translate/core';
import { HlmBadgeImports } from '@lazykoins/ui/badge';
import { HlmButtonImports } from '@lazykoins/ui/button';
import { HlmCardImports } from '@lazykoins/ui/card';
import { HlmInputImports } from '@lazykoins/ui/input';
import { HlmLabelImports } from '@lazykoins/ui/label';
import { HlmSkeletonImports } from '@lazykoins/ui/skeleton';
import { HlmTableImports } from '@lazykoins/ui/table';
import { BOOKING_KINDS } from '../../../../core/api/api.types';
import {
  type Correction,
  CORRECTION_TYPES,
  type CorrectionType,
} from '../../../../core/api/calculation.types';
import { EmptyState } from '../../../../shared/components/empty-state';
import { ProjectWorkspaceService } from '../project-workspace/project-workspace.service';
import { correctionBody, type CorrectionFormValue } from './correction-form';

/**
 * Korrekturen (F9): a form for price overrides, reclassifications and manual bookings or
 * holdings (prefilled when started from a figure), and the history with before/after, undo and
 * redo (F9.4).
 */
@Component({
  selector: 'lk-project-corrections',
  imports: [
    DatePipe,
    JsonPipe,
    ReactiveFormsModule,
    TranslatePipe,
    EmptyState,
    ...HlmBadgeImports,
    ...HlmButtonImports,
    ...HlmCardImports,
    ...HlmInputImports,
    ...HlmLabelImports,
    ...HlmSkeletonImports,
    ...HlmTableImports,
  ],
  templateUrl: './project-corrections.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProjectCorrections {
  protected readonly service = inject(ProjectWorkspaceService);
  protected readonly types = CORRECTION_TYPES;
  protected readonly kinds = BOOKING_KINDS;

  readonly closed = input(false);
  readonly taxYear = input.required<number>();

  protected readonly error = signal<string | null>(null);

  protected readonly form = inject(FormBuilder).nonNullable.group({
    type: ['price_override' as CorrectionType],
    reason: [''],
    asset: [''],
    date: [''],
    priceChf: [''],
    bookingId: [''],
    kind: ['transfer'],
    platform: [''],
    accountId: ['main'],
    timestamp: [''],
    quantity: [''],
    fee: [''],
    evidence: [''],
  });

  constructor() {
    // A correction started from the result: prefill, then forget the draft.
    effect(() => {
      const draft = this.service.draft();
      if (!draft) return;
      this.form.reset({
        ...this.blank(),
        type: draft.type,
        ...draft.values,
        date: draft.values['date'] ?? draft.values['asOf'] ?? this.yearEnd(),
      });
      this.error.set(null);
      this.service.draft.set(null);
    });
  }

  protected yearEnd(): string {
    return `${this.taxYear()}-12-31`;
  }

  private blank(): CorrectionFormValue {
    return {
      type: 'price_override',
      reason: '',
      asset: '',
      date: this.yearEnd(),
      priceChf: '',
      bookingId: '',
      kind: 'transfer',
      platform: '',
      accountId: 'main',
      timestamp: '',
      quantity: '',
      fee: '',
      evidence: '',
    };
  }

  protected newOf(type: CorrectionType): void {
    this.form.reset({ ...this.blank(), type });
    this.error.set(null);
  }

  protected submit(): void {
    const result = correctionBody(this.form.getRawValue());
    if (!result.ok) {
      this.error.set(result.error);
      return;
    }
    this.error.set(null);
    void this.service
      .createCorrection(result.body)
      .then(() => this.form.reset(this.blank()))
      .catch(() => undefined);
  }

  protected undo(correction: Correction, undo: boolean): void {
    void this.service.setUndone(correction, undo).catch(() => undefined);
  }

  protected entries(
    side: Record<string, string | null> | null | undefined,
  ): [string, string | null][] {
    return side ? Object.entries(side) : [];
  }
}
