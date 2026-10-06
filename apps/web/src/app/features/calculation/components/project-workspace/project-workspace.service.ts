import { HttpClient, httpResource } from '@angular/common/http';
import { computed, DOCUMENT, inject, Injectable, signal } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { firstValueFrom } from 'rxjs';
import { defineAction } from '../../../../core/actions/action';
import type { ActivityProgress } from '../../../../core/activity/activity.service';
import { ActionRunner } from '../../../../core/actions/action-runner';
import { apiUrl } from '../../../../core/api/api-url';
import {
  type ChecksView,
  type Correction,
  type EstvApplySummary,
  type ExportKind,
  type FigureRecords,
  isInternalKind,
  type MailDraft,
  type ManualRateRequest,
  type OpenItem,
  type ProjectExport,
  type RatesView,
  type RefreshStatus,
  type RefreshSummary,
  type ResultView,
  type StoredRate,
} from '../../../../core/api/calculation.types';
import type { DataExportFilter } from '../../../../core/api/dashboard.types';
import { NotificationService } from '../../../../core/notifications/notification.service';
import { EstvService } from '../../../../shared/estv/estv.service';
import { fileNameFrom, saveBlob } from '../../../../shared/files/save-blob';
import { ProjectSentEvents } from '../../../../shared/mail/project-sent-events';

/** How often a running rate refresh is asked for its progress. */
const REFRESH_POLL_MS = 1000;

/** The tabs of a project's workspace, in order. */
export const WORKSPACE_TABS = [
  'files',
  'hints',
  'wallets',
  'rates',
  'result',
  'checks',
  'corrections',
  'exports',
] as const;
export type WorkspaceTab = (typeof WORKSPACE_TABS)[number];

/** A correction started from a figure (F9: "aus einer Position/Buchung erfassen"). */
export interface CorrectionDraft {
  readonly type:
    'price_override' | 'reclassify' | 'manual_booking' | 'manual_holding';
  readonly values: Readonly<Record<string, string>>;
}

/** A statement waiting for the user's "create anyway" while open items exist (F10.2a). */
export interface PendingExport {
  readonly kind: ExportKind;
  readonly openItems: number;
}

/** A correction as the API takes it (amounts as decimal strings). */
export interface NewCorrection {
  readonly data: Record<string, unknown>;
  readonly reason: string;
}

/**
 * Everything of one project beyond its files: result (F7), rates (F7.4), checks (F8),
 * corrections (F9) and exports (F10). Provided by the workspace component and keyed by the
 * project id; the API decides everything (calculation, closed projects) — this service loads,
 * triggers and maps answers to translated messages. Figures stay decimal strings.
 */
@Injectable()
export class ProjectWorkspaceService {
  private readonly http = inject(HttpClient);
  private readonly actions = inject(ActionRunner);
  private readonly notifications = inject(NotificationService);
  private readonly document = inject(DOCUMENT);
  private readonly translate = inject(TranslateService);
  /** F4.7: calculations and exports can make a project "seit dem Versand geändert". */
  private readonly sentEvents = inject(ProjectSentEvents);
  readonly estv = inject(EstvService);

  readonly projectId = signal<string | undefined>(undefined);
  readonly tab = signal<WorkspaceTab>('files');

  private url(path: string): string | undefined {
    const id = this.projectId();
    return id ? apiUrl(`/projects/${id}${path}` as `/${string}`) : undefined;
  }

  readonly result = httpResource<ResultView>(() => this.url('/result'));
  readonly checks = httpResource<ChecksView>(() =>
    this.tab() === 'checks' || this.tab() === 'result' || this.tab() === 'hints'
      ? this.url('/checks')
      : undefined,
  );
  readonly corrections = httpResource<Correction[]>(() =>
    this.tab() === 'corrections' ? this.url('/corrections') : undefined,
  );
  readonly rates = httpResource<RatesView>(() =>
    this.tab() === 'rates' ? this.url('/rates') : undefined,
  );
  readonly exports = httpResource<ProjectExport[]>(() =>
    this.tab() === 'exports' ? this.url('/exports') : undefined,
  );

  readonly lastRefresh = signal<RefreshSummary | null>(null);
  /** F7.4a: what the last refresh / "übernehmen" took from the ESTV Kursliste. */
  readonly lastEstv = signal<EstvApplySummary | null>(null);

  /** The drill-down on screen (F7.5): which figure, and its records once loaded. */
  readonly recordsOf = signal<{ figureId: string; title: string } | null>(null);
  readonly records = signal<FigureRecords | null>(null);

  /** A correction being prepared in the corrections tab. */
  readonly draft = signal<CorrectionDraft | null>(null);

  /** A statement asked for while open items exist — the confirmation dialog shows it. */
  readonly pendingExport = signal<PendingExport | null>(null);

  private readonly status = this.actions.status<unknown>('project-workspace');
  readonly isBusy = computed(() => this.status()?.state === 'pending');

  private readonly calculateAction = defineAction<string, ResultView>({
    run: (id) =>
      firstValueFrom(
        this.http.post<ResultView>(apiUrl(`/projects/${id}/calculate`), {}),
      ),
    messages: {
      success: 'calculation.calculated',
      error: 'calculation.calculateFailed',
    },
  });

  private readonly refreshAction = defineAction<
    { id: string; force: boolean },
    RefreshSummary
  >({
    run: ({ id, force }) =>
      firstValueFrom(
        this.http.post<RefreshSummary>(
          apiUrl(`/projects/${id}/rates/refresh`),
          { force },
        ),
      ),
    messages: {
      success: 'rates.refreshed',
      error: 'rates.refreshFailed',
    },
  });

  private readonly manualRateAction = defineAction<
    { id: string; rate: ManualRateRequest },
    unknown
  >({
    run: ({ id, rate }) =>
      firstValueFrom(
        this.http.put(apiUrl(`/projects/${id}/rates/manual`), rate),
      ),
    messages: { success: 'rates.overridden', error: 'rates.overrideFailed' },
  });

  private readonly deleteRateAction = defineAction<
    { id: string; rate: StoredRate },
    unknown
  >({
    run: ({ id, rate }) =>
      firstValueFrom(
        this.http.delete(apiUrl(`/projects/${id}/rates/manual`), {
          params: {
            kind: rate.kind,
            asset: rate.asset,
            currency: rate.currency,
            date: rate.date,
            source: rate.source,
          },
        }),
      ),
    messages: { success: 'rates.removed', error: 'rates.removeFailed' },
  });

  private readonly applyEstvAction = defineAction<string, EstvApplySummary>({
    run: (id) =>
      firstValueFrom(
        this.http.post<EstvApplySummary>(
          apiUrl(`/projects/${id}/rates/estv/apply`),
          {},
        ),
      ),
    messages: { error: 'estv.applyFailed' },
  });

  private readonly kurslisteAction = defineAction<
    { id: string; file: File },
    { imported: number; skipped: number }
  >({
    run: ({ id, file }) =>
      firstValueFrom(
        this.http.post<{ imported: number; skipped: number }>(
          apiUrl(`/projects/${id}/rates/estv`),
          file,
          { headers: { 'Content-Type': 'application/octet-stream' } },
        ),
      ),
    messages: { error: 'rates.estvFailed' },
  });

  private readonly correctionAction = defineAction<
    { id: string; correction: NewCorrection },
    Correction
  >({
    run: ({ id, correction }) =>
      firstValueFrom(
        this.http.post<Correction>(
          apiUrl(`/projects/${id}/corrections`),
          correction,
        ),
      ),
    messages: {
      success: 'corrections.created',
      error: 'corrections.createFailed',
    },
  });

  private readonly undoAction = defineAction<
    { id: string; correction: Correction; undo: boolean },
    Correction
  >({
    run: ({ id, correction, undo }) =>
      firstValueFrom(
        this.http.post<Correction>(
          apiUrl(
            `/projects/${id}/corrections/${correction.id}/${undo ? 'undo' : 'redo'}`,
          ),
          {},
        ),
      ),
    messages: {
      success: 'corrections.changed',
      error: 'corrections.changeFailed',
    },
  });

  private readonly itemAction = defineAction<
    { id: string; key: string; done?: boolean; note?: string },
    unknown
  >({
    run: ({ id, key, done, note }) =>
      firstValueFrom(
        this.http.patch(apiUrl(`/projects/${id}/open-items`), {
          key,
          done,
          note,
        }),
      ),
    messages: { error: 'checks.saveFailed' },
  });

  private readonly exportAction = defineAction<
    { id: string; kind: ExportKind },
    ProjectExport
  >({
    run: ({ id, kind }) =>
      firstValueFrom(
        this.http.post<ProjectExport>(apiUrl(`/projects/${id}/exports`), {
          kind,
        }),
      ),
    // Success is toasted by createExport (with the download as its action).
    messages: { error: 'exports.createFailed' },
  });

  /** F7.6: recalculate, then every view shows the new snapshot. */
  async calculate(): Promise<void> {
    const view = await this.actions.run(
      this.calculateAction,
      this.requireId(),
      { key: 'project-workspace', activity: { label: 'activity.calculate' } },
    );
    this.result.set(view);
    this.reloadDerived();
    this.sentEvents.changed();
  }

  /** "Kurse aktualisieren (12/40)": the API reports its progress while the request runs. */
  readonly refreshProgress = signal<ActivityProgress | null>(null);

  async refreshRates(force = false): Promise<void> {
    const id = this.requireId();
    const stop = this.pollRefreshStatus(id);
    try {
      const summary = await this.actions.run(
        this.refreshAction,
        { id, force },
        {
          key: 'project-workspace',
          activity: { label: 'activity.rates', progress: this.refreshProgress },
        },
      );
      this.lastRefresh.set(summary);
      this.lastEstv.set(summary.estv);
    } finally {
      stop();
    }
    this.rates.reload();
    this.result.reload();
  }

  /** Polls `…/rates/refresh/status` only while the refresh runs; one request at a time. */
  private pollRefreshStatus(id: string): () => void {
    this.refreshProgress.set(null);
    let inFlight = false;
    let stopped = false;
    const timer = setInterval(() => {
      if (inFlight) return;
      inFlight = true;
      firstValueFrom(
        this.http.get<RefreshStatus>(
          apiUrl(`/projects/${id}/rates/refresh/status`),
        ),
      )
        .then((status) => {
          if (!stopped && status.running) {
            this.refreshProgress.set({
              done: status.done,
              total: status.total,
            });
          }
        })
        .catch(() => undefined)
        .finally(() => (inFlight = false));
    }, REFRESH_POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
      this.refreshProgress.set(null);
    };
  }

  /** F7.4a: takes the stored Kursliste of the tax year into the project (no network). */
  async applyEstv(): Promise<void> {
    const summary = await this.actions.run(
      this.applyEstvAction,
      this.requireId(),
      { key: 'project-workspace' },
    );
    this.lastEstv.set(summary);
    if (summary.label) {
      this.notifications.info('estv.applied', {
        count: summary.matched.length,
        label: summary.label,
      });
    } else {
      this.notifications.info('estv.noneForYear', { year: summary.year });
    }
    this.rates.reload();
    this.result.reload();
  }

  /**
   * "ESTV-Kursliste aktualisieren" in the project: downloads the year's list when a newer one
   * exists (the deployment's, F7.4a), then takes it into the project.
   */
  async updateEstv(taxYear: number): Promise<void> {
    await this.estv.update(taxYear);
    await this.applyEstv();
  }

  async setManualRate(rate: ManualRateRequest): Promise<void> {
    await this.actions.run(
      this.manualRateAction,
      { id: this.requireId(), rate },
      { key: 'project-workspace' },
    );
    this.rates.reload();
    this.result.reload();
  }

  async deleteManualRate(rate: StoredRate): Promise<void> {
    await this.actions.run(
      this.deleteRateAction,
      { id: this.requireId(), rate },
      { key: 'project-workspace' },
    );
    this.rates.reload();
    this.result.reload();
  }

  async importKursliste(file: File): Promise<void> {
    const result = await this.actions.run(
      this.kurslisteAction,
      { id: this.requireId(), file },
      { key: 'project-workspace', activity: { label: 'activity.estv' } },
    );
    this.notifications.info('rates.estvImported', {
      count: result.imported,
    });
    this.rates.reload();
    this.result.reload();
  }

  /** F9: creates the correction and recalculates, so its before/after shows at once. */
  async createCorrection(correction: NewCorrection): Promise<void> {
    await this.actions.run(
      this.correctionAction,
      { id: this.requireId(), correction },
      { key: 'project-workspace' },
    );
    await this.calculate();
  }

  async setUndone(correction: Correction, undo: boolean): Promise<void> {
    await this.actions.run(
      this.undoAction,
      { id: this.requireId(), correction, undo },
      { key: 'project-workspace' },
    );
    await this.calculate();
  }

  async saveItem(
    item: OpenItem,
    changes: { done?: boolean; note?: string },
  ): Promise<void> {
    await this.actions.run(
      this.itemAction,
      { id: this.requireId(), key: item.key, ...changes },
      { key: `open-item:${item.key}` },
    );
    this.checks.reload();
  }

  /** F10: the toast offers the download right away (the user may have left the tab meanwhile). */
  async createExport(kind: ExportKind): Promise<void> {
    const created = await this.actions.run(
      this.exportAction,
      { id: this.requireId(), kind },
      {
        key: 'project-workspace',
        activity: {
          label: 'activity.export',
          params: { kind: this.translate.instant(`exports.kind.${kind}`) },
        },
      },
    );
    this.notifications.success('exports.created', {
      labelKey: 'exports.download',
      onClick: () => void this.download(created),
    });
    this.exports.reload();
    this.result.reload();
    this.sentEvents.changed();
  }

  /**
   * A statement is handed to the tax authority, so it carries no open items (F10.2a): while some
   * are not ticked off, ask first (`pendingExport` → confirm / cancel / go to the checks). The
   * internal report is created at once — it is where the open items are.
   */
  async requestExport(kind: ExportKind): Promise<void> {
    if (!isInternalKind(kind)) {
      const openItems = await this.openItemCount();
      if (openItems > 0) {
        this.pendingExport.set({ kind, openItems });
        return;
      }
    }
    await this.createExport(kind);
  }

  async confirmExport(): Promise<void> {
    const pending = this.pendingExport();
    if (!pending) return;
    this.pendingExport.set(null);
    await this.createExport(pending.kind);
  }

  cancelExport(): void {
    this.pendingExport.set(null);
  }

  /** From the confirmation to the Prüfungen tab. */
  showChecks(): void {
    this.pendingExport.set(null);
    this.tab.set('checks');
  }

  /** Open items not ticked off, from the latest calculation; unknown (no calculation) = 0. */
  private async openItemCount(): Promise<number> {
    try {
      const view = await firstValueFrom(
        this.http.get<ChecksView>(
          apiUrl(`/projects/${this.requireId()}/checks`),
        ),
      );
      return view.items.filter((item) => !item.done).length;
    } catch {
      return 0;
    }
  }

  /** F7.5: the records behind a figure. */
  figureRecords(figureId: string): Promise<FigureRecords> {
    return firstValueFrom(
      this.http.get<FigureRecords>(
        apiUrl(`/projects/${this.requireId()}/result/records`),
        { params: { figure: figureId } },
      ),
    );
  }

  async showRecords(figureId: string, title: string): Promise<void> {
    this.records.set(null);
    this.recordsOf.set({ figureId, title });
    try {
      this.records.set(await this.figureRecords(figureId));
    } catch {
      this.recordsOf.set(null);
      this.notifications.error('result.recordsFailed');
    }
  }

  /** Everything the tabs show, again (after a change the assistant made, F11.14). */
  reloadAll(): void {
    this.result.reload();
    this.checks.reload();
    this.corrections.reload();
    this.rates.reload();
    this.exports.reload();
    this.sentEvents.changed();
  }

  closeRecords(): void {
    this.recordsOf.set(null);
    this.records.set(null);
  }

  /** Opens the corrections tab with a prefilled form. */
  startCorrection(draft: CorrectionDraft): void {
    this.draft.set(draft);
    this.tab.set('corrections');
  }

  mailDraft(): Promise<MailDraft> {
    return firstValueFrom(
      this.http.get<MailDraft>(
        apiUrl(`/projects/${this.requireId()}/mail-draft`),
      ),
    );
  }

  async download(item: ProjectExport): Promise<void> {
    try {
      const response = await firstValueFrom(
        this.http.get(
          apiUrl(`/projects/${this.requireId()}/exports/${item.id}/content`),
          { observe: 'response', responseType: 'blob' },
        ),
      );
      saveBlob(
        this.document,
        response.body ?? new Blob(),
        fileNameFrom(
          response.headers.get('Content-Disposition'),
          item.fileName,
        ),
      );
    } catch {
      this.notifications.error('exports.downloadFailed');
    }
  }

  /** F10.7: bookings/holdings in the standard format, filtered, as CSV or Excel. */
  async downloadData(
    format: 'csv' | 'xlsx',
    type: 'bookings' | 'holdings',
    filter: DataExportFilter,
  ): Promise<void> {
    const params: Record<string, string> = { format, type };
    for (const [key, value] of Object.entries(filter)) {
      if (typeof value === 'string' && value.trim() !== '')
        params[key] = value.trim();
    }
    await this.downloadFrom(
      `/projects/${this.requireId()}/data-export`,
      params,
      `daten.${format}`,
      'exports.data.failed',
    );
  }

  /** F10.8: the project package (.lkproj.zip). */
  async downloadPackage(): Promise<void> {
    await this.downloadFrom(
      `/projects/${this.requireId()}/package`,
      {},
      'projekt.lkproj.zip',
      'exports.data.packageFailed',
    );
  }

  /** A download is running (data export, package). */
  readonly downloading = signal(false);

  private async downloadFrom(
    path: `/${string}`,
    params: Record<string, string>,
    fallback: string,
    errorKey: string,
  ): Promise<void> {
    this.downloading.set(true);
    try {
      const response = await firstValueFrom(
        this.http.get(apiUrl(path), {
          params,
          observe: 'response',
          responseType: 'blob',
        }),
      );
      saveBlob(
        this.document,
        response.body ?? new Blob(),
        fileNameFrom(response.headers.get('Content-Disposition'), fallback),
      );
    } catch {
      this.notifications.error(errorKey);
    } finally {
      this.downloading.set(false);
    }
  }

  private reloadDerived(): void {
    this.checks.reload();
    this.corrections.reload();
  }

  private requireId(): string {
    const id = this.projectId();
    if (!id) throw new Error('No project on screen');
    return id;
  }
}
