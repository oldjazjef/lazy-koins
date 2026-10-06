import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { HlmButtonImports } from '@lazykoins/ui/button';
import { HlmCardImports } from '@lazykoins/ui/card';
import { HlmDialogImports } from '@lazykoins/ui/dialog';
import { HlmInputImports } from '@lazykoins/ui/input';
import { HlmLabelImports } from '@lazykoins/ui/label';
import { HlmSkeletonImports } from '@lazykoins/ui/skeleton';
import { HlmTextareaImports } from '@lazykoins/ui/textarea';
import { z } from 'zod';
import {
  PROJECT_STATUSES,
  type ProjectStatus,
  TAX_CURRENCIES,
} from '../../../../core/api/api.types';
import { taxCurrencyOptions } from '../project-form-page/tax-currency-options';
import type { Carryover } from '../../../../core/api/dashboard.types';
import { EmptyState } from '../../../../shared/components/empty-state';
import { ProjectDashboardCard } from '../../../dashboard/components/project-dashboard-card';
import { ProjectWorkspace } from '../../../calculation/components/project-workspace/project-workspace';
import { PageHeader } from '../../../../shared/components/page-header';
import { zodValidator } from '../../../../shared/forms/zod-validator';
import { ProjectSentBadge } from '../../components/project-sent-badge';
import { ProjectStatusBadge } from '../../components/project-status-badge';
import { ProjectDetailPageService } from './project-detail-page.service';

const ProjectEditSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'projects.form.nameRequired')
    .max(120, 'projects.form.nameTooLong'),
  notes: z.string().max(5000, 'projects.form.notesTooLong'),
  status: z.enum(PROJECT_STATUSES),
  taxCurrency: z.enum(TAX_CURRENCIES),
});
type ProjectEdit = z.infer<typeof ProjectEditSchema>;

type Confirm = 'reopen' | 'delete' | 'currency';

/**
 * The project's data (name, notes, status) and its workspace: files and mappings (F5), rates,
 * result, checks, corrections and exports (F7–F10).
 */
@Component({
  selector: 'lk-project-detail-page',
  imports: [
    DatePipe,
    ReactiveFormsModule,
    RouterLink,
    TranslatePipe,
    PageHeader,
    EmptyState,
    ProjectStatusBadge,
    ProjectSentBadge,
    ProjectWorkspace,
    ProjectDashboardCard,
    ...HlmButtonImports,
    ...HlmCardImports,
    ...HlmDialogImports,
    ...HlmInputImports,
    ...HlmLabelImports,
    ...HlmSkeletonImports,
    ...HlmTextareaImports,
  ],
  providers: [ProjectDetailPageService],
  templateUrl: './project-detail-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProjectDetailPage {
  protected readonly service = inject(ProjectDetailPageService);
  protected readonly statuses = PROJECT_STATUSES;

  /** Route param `:id` — no default, absent params bind as `undefined` (see CLAUDE.md). */
  readonly id = input<string | undefined>();
  /** Query `?tab=hints` — a notification's link to a workspace tab (F11.11). No default. */
  readonly tab = input<string | undefined>();

  protected readonly confirm = signal<Confirm | null>(null);
  /** F4.1a: changes waiting for the confirmation of a new tax currency. */
  private readonly pendingEdit = signal<ProjectEdit | null>(null);
  protected readonly pendingCurrency = computed(
    () => this.pendingEdit()?.taxCurrency ?? '',
  );
  /** The currencies offered: the project's own and the country default first. */
  protected readonly currencies = computed(() =>
    this.service.project.hasValue()
      ? taxCurrencyOptions(
          this.service.project.value().country,
          this.service.project.value().taxCurrency,
        )
      : taxCurrencyOptions('CH'),
  );

  protected readonly form = inject(FormBuilder).nonNullable.group(
    {
      name: [''],
      notes: [''],
      status: ['in_progress' as ProjectStatus],
      taxCurrency: ['CHF'],
    },
    { validators: zodValidator(ProjectEditSchema) },
  );

  constructor() {
    effect(() => this.service.projectId.set(this.id()));
    // Fill the form from the loaded project; a closed project is read-only (F4.5).
    effect(() => {
      if (!this.service.project.hasValue()) return;
      const project = this.service.project.value();
      this.form.reset({
        name: project.name,
        notes: project.notes,
        status: project.status,
        taxCurrency: project.taxCurrency,
      });
      if (project.status === 'closed') this.form.disable();
      else this.form.enable();
    });
  }

  protected save(): void {
    this.form.markAllAsTouched();
    const parsed = ProjectEditSchema.safeParse(this.form.getRawValue());
    if (!parsed.success) return;
    // F4.1a: another tax currency needs a confirmation (the calculation becomes stale).
    const project = this.service.project.hasValue()
      ? this.service.project.value()
      : undefined;
    if (project && parsed.data.taxCurrency !== project.taxCurrency) {
      this.pendingEdit.set(parsed.data);
      this.confirm.set('currency');
      return;
    }
    const { taxCurrency: _same, ...rest } = parsed.data;
    void this.service.save(rest).catch(() => undefined);
  }

  protected setCarriedDone(item: Carryover, done: boolean): void {
    void this.service.setCarriedDone(item, done).catch(() => undefined);
  }

  protected dialogState(): 'open' | 'closed' {
    return this.confirm() ? 'open' : 'closed';
  }

  protected dialogChanged(state: 'open' | 'closed'): void {
    if (state === 'closed') {
      // Cancelled a currency change: the select shows the project's currency again.
      if (this.pendingEdit() && this.service.project.hasValue()) {
        this.form.controls.taxCurrency.setValue(
          this.service.project.value().taxCurrency,
        );
      }
      this.confirm.set(null);
      this.pendingEdit.set(null);
    }
  }

  protected confirmed(): void {
    const action = this.confirm();
    this.confirm.set(null);
    if (action === 'reopen') {
      void this.service.reopen().catch(() => undefined);
    } else if (action === 'delete') {
      void this.service.remove().catch(() => undefined);
    } else if (action === 'currency') {
      const edit = this.pendingEdit();
      this.pendingEdit.set(null);
      if (edit) void this.service.save(edit).catch(() => undefined);
    }
  }
}
