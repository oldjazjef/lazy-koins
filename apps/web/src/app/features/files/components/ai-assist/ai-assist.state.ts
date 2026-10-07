import { AiErrorNotifier } from '../../../../shared/ai/ai-error-notifier';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { computed, inject, Injectable, signal } from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ActivityService } from '../../../../core/activity/activity.service';
import { apiUrl } from '../../../../core/api/api-url';
import type {
  AiRequestPreview,
  AiSettings,
  AiUsage,
  ConfirmedHolding,
  ExtractedHolding,
  Mapping,
  MappingCandidate,
  MappingPreview,
  ProjectFile,
  SpecIssue,
  StatementCandidate,
} from '../../../../core/api/api.types';
import { NotificationService } from '../../../../core/notifications/notification.service';
import { type AiErrorInfo } from '../../../../shared/ai/ai-error-details';
import { ProjectFilesService } from '../project-files/project-files.service';

export type AiMode = 'mapping' | 'statement';

/**
 * - `pickFile`: choose which file needs a mapping (from the mappings section);
 * - `notReady`: the plugin is off / not configured — explains how to switch it on;
 * - `consent`: shows exactly what will be sent (F5.14), first use asks for consent;
 * - `working`: the provider is busy;
 * - `mappingReview` / `statementReview`: the proposal, nothing saved yet.
 */
export type AiStep =
  | 'closed'
  | 'pickFile'
  | 'loading'
  | 'notReady'
  | 'consent'
  | 'working'
  | 'mappingReview'
  | 'statementReview';

/**
 * The AI flows of the files area (F5.13, F5.14): "Mit AI erstellen" (a mapping for a file
 * without one) and "Mit AI auslesen" (balances from a PDF statement). Provided next to
 * `ProjectFilesService`; the API does the work, this holds the dialog's state.
 */
@Injectable()
export class AiAssistState {
  private readonly http = inject(HttpClient);
  private readonly files = inject(ProjectFilesService);
  private readonly notifications = inject(NotificationService);
  private readonly aiErrors = inject(AiErrorNotifier);
  private readonly router = inject(Router);
  private readonly activity = inject(ActivityService);

  readonly step = signal<AiStep>('closed');
  readonly mode = signal<AiMode>('mapping');
  readonly file = signal<ProjectFile | null>(null);
  readonly notReadyReason = signal<'disabled' | 'notConfigured'>('disabled');
  readonly request = signal<AiRequestPreview | null>(null);
  /** The payload exactly as it is sent, pretty-printed for reading. */
  readonly payloadText = computed(() => {
    const request = this.request();
    return request ? readablePayload(request.payload) : '';
  });
  readonly consentChecked = signal(false);
  readonly canSend = computed(
    () => this.request()?.consentGiven === true || this.consentChecked(),
  );

  readonly candidate = signal<MappingCandidate | null>(null);
  /** The reviewed spec as JSON text (editable). */
  readonly specText = signal('');
  readonly invalidJson = signal(false);
  /** Issues of the edited spec (after "Prüfen" or a refused save). */
  readonly issues = signal<readonly SpecIssue[]>([]);
  /** The preview of the edited spec; the AI's own preview until it is re-checked. */
  readonly preview = signal<MappingPreview | null>(null);

  readonly statement = signal<StatementCandidate | null>(null);
  /** Indices of the extracted balances the user keeps. */
  readonly kept = signal<ReadonlySet<number>>(new Set());

  readonly usage = computed<AiUsage | null>(
    () => this.candidate()?.usage ?? this.statement()?.usage ?? null,
  );
  readonly busy = signal(false);
  /** The last failed request with the provider's details (shown in the dialog, expandable). */
  readonly error = signal<AiErrorInfo | null>(null);

  /** Table files without a mapping — the choice when started from the mappings section. */
  readonly filesNeedingMapping = computed(() =>
    this.files.tableFiles().filter((file) => file.status === 'needs_mapping'),
  );
  readonly pickedFileId = signal('');

  /** From the mappings section: pick the file first (or start right away when there is one). */
  openPicker(): void {
    const candidates = this.filesNeedingMapping();
    if (candidates.length === 0) {
      this.notifications.info('ai.mapping.noFile');
      return;
    }
    const [only] = candidates;
    if (candidates.length === 1 && only) {
      void this.start(only, 'mapping');
      return;
    }
    this.pickedFileId.set(candidates[0]?.id ?? '');
    this.step.set('pickFile');
  }

  async startPicked(): Promise<void> {
    const file = this.filesNeedingMapping().find(
      (f) => f.id === this.pickedFileId(),
    );
    if (file) await this.start(file, 'mapping');
  }

  /** Loads the settings, then the exact payload — nothing is sent to the provider yet. */
  async start(file: ProjectFile, mode: AiMode): Promise<void> {
    this.reset();
    this.file.set(file);
    this.mode.set(mode);
    this.step.set('loading');
    try {
      const settings = await firstValueFrom(
        this.http.get<AiSettings>(apiUrl('/ai/settings')),
      );
      if (!settings.enabled || !settings.ready) {
        this.notReadyReason.set(
          settings.enabled ? 'notConfigured' : 'disabled',
        );
        this.step.set('notReady');
        return;
      }
      const request = await firstValueFrom(
        this.http.get<AiRequestPreview>(apiUrl(`${this.base(file)}/payload`)),
      );
      this.request.set(request);
      this.step.set('consent');
    } catch (error) {
      this.fail(error);
      this.step.set('closed');
    }
  }

  /** Sends the shown payload. The first time only with the consent box ticked. */
  async send(): Promise<void> {
    const file = this.file();
    if (!file || !this.canSend()) return;
    this.error.set(null);
    this.step.set('working');
    // The provider may take a minute: the activity indicator shows it, and when the dialog was
    // closed meanwhile, the toast offers to open the proposal.
    const review: AiStep =
      this.mode() === 'mapping' ? 'mappingReview' : 'statementReview';
    const ready = () =>
      this.step() === 'working'
        ? null
        : {
            key: `activity.ai.${this.mode()}Ready`,
            params: { name: file.displayName },
            action: {
              labelKey: 'activity.show',
              onClick: () => this.step.set(review),
            },
          };
    try {
      const body = { consent: this.consentChecked() };
      if (this.mode() === 'mapping') {
        const candidate = await this.activity.track(
          'activity.ai.mapping',
          this.http.post<MappingCandidate>(apiUrl(this.base(file)), body),
          { params: { name: file.displayName }, success: ready },
        );
        this.candidate.set(candidate);
        this.specText.set(JSON.stringify(candidate.spec, null, 2));
        this.issues.set(candidate.issues);
        this.preview.set(candidate.preview);
        if (this.step() === 'working') this.step.set('mappingReview');
      } else {
        const statement = await this.activity.track(
          'activity.ai.statement',
          this.http.post<StatementCandidate>(apiUrl(this.base(file)), body),
          { params: { name: file.displayName }, success: ready },
        );
        this.statement.set(statement);
        this.kept.set(
          new Set(
            statement.holdings
              .map((holding, index) => ({ holding, index }))
              .filter(({ holding }) => holding.quantity !== null)
              .map(({ index }) => index),
          ),
        );
        if (this.step() === 'working') this.step.set('statementReview');
      }
    } catch (error) {
      this.fail(error);
      if (this.step() === 'working') this.step.set('consent');
    }
  }

  /** Validates the edited spec and previews it against the file (the files area's check). */
  async recheck(): Promise<void> {
    const file = this.file();
    const spec = this.parseSpec();
    if (!file || spec === undefined) return;
    this.busy.set(true);
    try {
      const check = await this.files.checkMapping(file, { spec }, 50);
      this.issues.set(check.ok ? [] : check.issues);
      this.preview.set(check.ok ? check.preview : null);
    } catch {
      // checkMapping has shown the failure.
    } finally {
      this.busy.set(false);
    }
  }

  /** Saves the reviewed spec as a mapping (origin AI) and reads the file with it. */
  async saveMapping(): Promise<void> {
    const file = this.file();
    const spec = this.parseSpec();
    if (!file || spec === undefined) return;
    this.busy.set(true);
    try {
      const saved = await firstValueFrom(
        this.http.post<{ mapping: Mapping; file: ProjectFile }>(
          apiUrl(`${this.base(file)}/accept`),
          { spec },
        ),
      );
      // The mapping is mine now, usable in every project (F11.0): link to its page.
      this.notifications.success('ai.mapping.saved', {
        labelKey: 'mappings.openPage',
        onClick: () =>
          void this.router.navigate(['/app/mappings', saved.mapping.id]),
      });
      this.close();
    } catch (error) {
      const issues = specIssuesOf(error);
      if (issues) {
        this.issues.set(issues);
      } else {
        this.fail(error);
      }
    } finally {
      this.busy.set(false);
    }
  }

  toggleKept(index: number): void {
    this.kept.update((kept) => {
      const next = new Set(kept);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  /** Stores the kept balances as a derived standard-format CSV; the PDF stays as evidence. */
  async saveStatement(): Promise<void> {
    const file = this.file();
    const statement = this.statement();
    if (!file || !statement) return;
    const holdings = statement.holdings
      .filter((_, index) => this.kept().has(index))
      .map(confirmed);
    if (holdings.length === 0) return;
    this.busy.set(true);
    try {
      // The API reads the PDF again and re-checks every quantity before storing.
      await this.activity.track(
        'activity.ai.statementSave',
        this.http.post<ProjectFile>(apiUrl(`${this.base(file)}/accept`), {
          holdings,
        }),
        { params: { name: file.displayName } },
      );
      this.notifications.success('ai.statement.saved');
      this.close();
    } catch (error) {
      if (
        error instanceof HttpErrorResponse &&
        error.status === 409 &&
        (error.error as { existingId?: unknown } | null)?.existingId
      ) {
        this.notifications.error('ai.statement.duplicate');
      } else {
        this.fail(error);
      }
    } finally {
      this.busy.set(false);
    }
  }

  close(): void {
    this.step.set('closed');
  }

  private base(file: ProjectFile): `/${string}` {
    const projectId = this.files.projectId();
    return `/projects/${projectId ?? ''}/files/${file.id}/ai/${this.mode()}`;
  }

  private parseSpec(): unknown {
    try {
      const value: unknown = JSON.parse(this.specText());
      this.invalidJson.set(false);
      return value;
    } catch {
      this.invalidJson.set(true);
      return undefined;
    }
  }

  /**
   * The toast says what failed in the user's language; the dialog's error panel keeps the
   * technical details (the API's English one-line detail, the provider's own words — F11.2).
   */
  private fail(error: unknown): void {
    this.error.set(this.aiErrors.notify(error));
  }

  private reset(): void {
    this.error.set(null);
    this.request.set(null);
    this.consentChecked.set(false);
    this.candidate.set(null);
    this.specText.set('');
    this.invalidJson.set(false);
    this.issues.set([]);
    this.preview.set(null);
    this.statement.set(null);
    this.kept.set(new Set());
  }
}

/**
 * The payload as indented JSON with every array of plain values on one line — a file row reads
 * as a row. Only whitespace differs from what is sent.
 */
export function readablePayload(payload: unknown): string {
  return JSON.stringify(payload, null, 2).replace(
    /\[\n([^[\]{}]*?)\n\s*\]/g,
    (_, items: string) =>
      `[${items
        .split(',\n')
        .map((item) => item.trim())
        .join(', ')}]`,
  );
}

/** A kept balance as the API expects it back: what the AI returned, never re-typed numbers. */
export function confirmed(holding: ExtractedHolding): ConfirmedHolding {
  return {
    asset: holding.asset,
    quantityAsPrinted: holding.quantityAsPrinted,
    asOf: holding.asOf,
    platform: holding.platform,
    account: holding.account,
    ...(holding.priceChfAsPrinted
      ? { priceChfAsPrinted: holding.priceChfAsPrinted }
      : {}),
    ...(holding.priceUsdAsPrinted
      ? { priceUsdAsPrinted: holding.priceUsdAsPrinted }
      : {}),
    page: holding.page,
  };
}

function specIssuesOf(error: unknown): readonly SpecIssue[] | undefined {
  if (!(error instanceof HttpErrorResponse) || error.status !== 400) {
    return undefined;
  }
  const issues = (error.error as { issues?: SpecIssue[] } | null)?.issues;
  return Array.isArray(issues) ? issues : undefined;
}
