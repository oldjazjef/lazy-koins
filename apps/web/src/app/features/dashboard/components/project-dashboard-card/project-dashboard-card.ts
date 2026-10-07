import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  untracked,
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { HlmCardImports } from '@lazykoins/ui/card';
import { HlmSkeletonImports } from '@lazykoins/ui/skeleton';
import type { KpiKind } from '../../../../core/api/dashboard.types';
import { AssistantEvents } from '../../../../core/assistant/assistant-events';
import { LineChart } from '../../../../shared/charts';
import { RecordsDialog } from '../../../../shared/components/records-dialog';
import { ProjectSentEvents } from '../../../../shared/mail/project-sent-events';
import { ChfPipe, isNegative } from '../../../../shared/format/number-format';
import { taxYearPeriod } from '../../dashboard-period';
import { DashboardPageService } from '../../pages/dashboard-page/dashboard-page.service';
import { TranslateService } from '@ngx-translate/core';

/**
 * The compact dashboard of ONE project for its tax year (F11.4): value at the end, change,
 * the course as a small line, In / Out / Ertrag with drill-down.
 */
@Component({
  selector: 'lk-project-dashboard-card',
  imports: [
    TranslatePipe,
    ChfPipe,
    LineChart,
    RecordsDialog,
    ...HlmCardImports,
    ...HlmSkeletonImports,
  ],
  providers: [DashboardPageService],
  template: `
    <section hlmCard>
      <div hlmCardHeader>
        <h2 hlmCardTitle>
          {{ 'dashboard.card.title' | translate: { year: taxYear() } }}
        </h2>
      </div>
      <div hlmCardContent class="flex flex-col gap-3">
        @if (service.view.hasValue()) {
          @let view = service.view.value();
          <div>
            <p class="text-2xl font-semibold tabular-nums">
              {{ view.endValueChf | lkChf: view.currency }}
            </p>
            @if (view.changePct !== null) {
              <p
                class="text-sm font-medium tabular-nums"
                [class.lk-positive]="!isNegative(view.changeChf)"
                [class.lk-negative]="isNegative(view.changeChf)"
              >
                {{ isNegative(view.changeChf) ? '' : '+'
                }}{{ view.changePct }} %
              </p>
            }
          </div>
          <lk-line-chart
            [points]="points()"
            [compact]="true"
            [currency]="view.currency"
            [label]="
              'dashboard.chartLabel' | translate: { currency: view.currency }
            "
          />
          <dl class="grid grid-cols-3 gap-2 text-sm">
            @for (kind of kinds; track kind) {
              <div>
                <dt class="text-muted-foreground">
                  {{ 'dashboard.kpi.' + kind | translate }}
                </dt>
                <dd>
                  <button
                    type="button"
                    class="font-medium tabular-nums hover:underline"
                    (click)="open(kind)"
                  >
                    {{ valueOf(kind) | lkChf: view.currency }}
                  </button>
                </dd>
              </div>
            }
          </dl>
          @if (view.missingPrices.length > 0) {
            <p class="text-muted-foreground text-xs">
              {{
                'dashboard.missing.body'
                  | translate: { assets: view.missingPrices.join(', ') }
              }}
            </p>
          }
        } @else if (service.view.error()) {
          <p class="text-muted-foreground text-sm">
            {{ 'dashboard.loadFailed' | translate }}
          </p>
        } @else {
          <hlm-skeleton class="h-40 w-full" />
        }
      </div>
    </section>
    <lk-records-dialog
      [title]="service.recordsOf()?.title ?? null"
      [data]="service.records()"
      (closed)="service.closeRecords()"
    />
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProjectDashboardCard {
  protected readonly service = inject(DashboardPageService);
  private readonly sentEvents = inject(ProjectSentEvents);
  private readonly assistantEvents = inject(AssistantEvents);
  private readonly translate = inject(TranslateService);
  protected readonly isNegative = isNegative;
  protected readonly kinds: readonly KpiKind[] = [
    'deposits',
    'withdrawals',
    'income',
  ];

  readonly projectId = input.required<string>();
  readonly taxYear = input.required<number>();

  protected readonly points = computed(() =>
    this.service.view.hasValue()
      ? this.service.view.value().series.map((p) => ({
          date: p.date,
          value: p.valueChf,
          missing: p.missing,
        }))
      : [],
  );

  constructor() {
    effect(() => {
      this.service.projectId.set(this.projectId());
      this.service.setCustom(
        taxYearPeriod(this.taxYear(), this.service.today()),
      );
    });
    // Regression (07.10.2026): after "Neu berechnen" the chart kept the old values. Reload on
    // every change the workspace announces (calculation, export, correction) and on changes the
    // assistant made to this project — not on the first run.
    let seenSent = this.sentEvents.version();
    effect(() => {
      const version = this.sentEvents.version();
      if (version === seenSent) return;
      seenSent = version;
      untracked(() => this.service.view.reload());
    });
    let seenChange = this.assistantEvents.change()?.seq ?? 0;
    effect(() => {
      const change = this.assistantEvents.change();
      if (!change || change.seq === seenChange) return;
      seenChange = change.seq;
      const id = untracked(() => this.projectId());
      if (change.projectId === null || change.projectId === id) {
        untracked(() => this.service.view.reload());
      }
    });
  }

  protected valueOf(kind: KpiKind): string | null {
    return this.service.view.hasValue()
      ? (this.service.view.value().kpis.find((k) => k.kind === kind)
          ?.valueChf ?? null)
      : null;
  }

  protected open(kind: KpiKind): void {
    void this.service.showRecords(
      kind,
      this.translate.instant(`dashboard.kpi.${kind}`),
    );
  }
}
