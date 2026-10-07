import {
  Injectable,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { conflict } from '../../common/http/api-errors';
import {
  CommandHandler,
  type ICommandHandler,
  type IQueryHandler,
  QueryHandler,
} from '@nestjs/cqrs';
import {
  countryRules,
  missingFileHints,
  rulesInLanguage,
  withTaxCurrency,
} from '@lazykoins/engine';
import { BUILD_INFO } from '../../app/build-info';
import { localeOr } from '../../common/i18n/locale';
import { CalculationInputService } from '../../calculation/application/calculation-input.service';
import { CalculationService } from '../../calculation/calculation.service';
import type { Snapshot } from '../../calculation/domain/calculation';
import {
  CalculationSnapshotRepositoryPort,
  OpenItemStateRepositoryPort,
} from '../../calculation/ports/calculation.repository.port';
import { readsRecords } from '../../files/domain/project-file';
import { HintStateRepositoryPort } from '../../files/ports/hint-state.repository.port';
import { ProjectFileRepositoryPort } from '../../files/ports/project-file.repository.port';
import { NotificationService } from '../../notifications/application/notification.service';
import { ProjectNotifications } from '../../notifications/application/project-notifications.service';
import { projectRoute, Topics } from '../../notifications/domain/notification';
import { loadOwnProject } from '../../projects/application/project-access';
import type { Project } from '../../projects/domain/project';
import { ProjectRepositoryPort } from '../../projects/ports/project.repository.port';
import { SettingsReader } from '../../settings/application/settings.handlers';
import { UserRepositoryPort } from '../../users/ports/user.repository.port';
import type {
  ExportKind,
  ProjectExportContent,
  ProjectExportMeta,
} from '../domain/project-export';
import {
  PdfRendererPort,
  PdfUnavailableError,
  ProjectExportRepositoryPort,
} from '../ports/project-export.repository.port';
import { detailedWorkbook } from './excel/detailed-workbook';
import { internalWorkbook } from './excel/internal-workbook';
import { simpleWorkbook } from './excel/simple-workbook';
import {
  type ExportData,
  exportFileName,
  type ExportVariant,
} from './export-data';
import { type MailDraft, mailDraft } from './mail-draft';
import { internalReportHtml } from './pdf/internal-report-html';
import {
  detailedStatementHtml,
  simpleStatementHtml,
} from './pdf/statement-html';

/** Collects what a document shows: the latest result, ticks, names (F10.4), file hints. */
@Injectable()
export class ExportDataService {
  constructor(
    private readonly snapshots: CalculationSnapshotRepositoryPort,
    private readonly states: OpenItemStateRepositoryPort,
    private readonly settings: SettingsReader,
    private readonly users: UserRepositoryPort,
    private readonly files: ProjectFileRepositoryPort,
    private readonly inputs: CalculationInputService,
    private readonly calculation: CalculationService,
    private readonly hintStates: HintStateRepositoryPort,
  ) {}

  /**
   * The latest snapshot; an open project is recalculated first when its data changed (or it was
   * never calculated). A closed project uses what it has.
   */
  async currentSnapshot(userId: string, project: Project): Promise<Snapshot> {
    let snapshot = await this.snapshots.latest(project.id);
    const stale =
      !snapshot ||
      (project.status !== 'closed' &&
        (await this.inputs.inputHash(project)) !== snapshot.inputHash);
    if (stale && project.status !== 'closed') {
      await this.calculation.calculate(userId, project.id);
      snapshot = await this.snapshots.latest(project.id);
    }
    if (!snapshot) {
      throw conflict(
        'noCalculation',
        'The project has no calculation yet: reopen it and calculate',
      );
    }
    return snapshot;
  }

  async build(
    userId: string,
    project: Project,
    snapshot: Snapshot,
    createdAt: string,
  ): Promise<ExportData> {
    const countryRule = countryRules(project.country);
    if (!countryRule)
      throw new Error(`No country rules for ${project.country}`);
    // F4.1a: the statement is in the currency the snapshot was calculated in.
    const settings = await this.settings.resolve(userId);
    // F11.2: the document in the user's language and format; labels from the rules (F10.3).
    const locale = localeOr(settings.locale);
    const rules = rulesInLanguage(
      withTaxCurrency(countryRule, snapshot.result.currency),
      locale,
    );
    const user = await this.users.findById(userId);
    const states = new Map(
      (await this.states.listByProject(project.id)).map((s) => [s.itemKey, s]),
    );
    // F5.7a: a deactivated file covers nothing (its records are not in the snapshot either).
    const coverage = (await this.files.listByProject(project.id))
      .filter(readsRecords)
      .flatMap((file) => file.coverage);
    // Hints marked "in Ordnung" or ignored (F5.8) are settled: not in the internal report.
    const dismissed = new Set(
      (await this.hintStates.listByProject(project.id)).map((s) => s.hintKey),
    );
    return {
      projectName: project.name,
      taxYear: project.taxYear,
      canton: project.canton,
      ownerName: settings.displayName || user?.displayName || '',
      advisorName: settings.advisorName,
      advisorEmail: settings.advisorEmail,
      createdAt,
      calculatedAt: snapshot.createdAt,
      appVersion: BUILD_INFO.full,
      locale,
      format: {
        numberFormat: settings.numberFormat,
        dateFormat: settings.dateFormat,
      },
      rules,
      result: snapshot.result,
      items: snapshot.result.openItems.map((item) => ({
        ...item,
        done: states.get(item.key)?.done ?? false,
        note: states.get(item.key)?.note ?? '',
      })),
      hints: missingFileHints(project.taxYear, coverage).filter(
        (hint) => !dismissed.has(hint.key),
      ),
    };
  }
}

export class CreateExportCommand {
  constructor(
    readonly userId: string,
    readonly projectId: string,
    readonly kind: ExportKind,
  ) {}
}

const VARIANTS: Readonly<Record<ExportKind, ExportVariant>> = {
  simple_pdf: 'einfach',
  simple_xlsx: 'einfach',
  detailed_pdf: 'ausfuehrlich',
  detailed_xlsx: 'ausfuehrlich',
  internal_report_pdf: 'pruefbericht-intern',
  internal_report_xlsx: 'pruefbericht-intern',
};

/**
 * F10.1, F10.2, F10.2a, F10.5: renders a statement (or the internal check report) from the latest
 * result and keeps it with its date. Allowed on a closed project too — that is when the final
 * statement is made. Open items never block a statement: the web asks before (F10.2a).
 */
@CommandHandler(CreateExportCommand)
export class CreateExportHandler implements ICommandHandler<
  CreateExportCommand,
  ProjectExportMeta
> {
  constructor(
    private readonly projects: ProjectRepositoryPort,
    private readonly exports: ProjectExportRepositoryPort,
    private readonly data: ExportDataService,
    private readonly pdf: PdfRendererPort,
    @Optional() private readonly notifications?: NotificationService,
    @Optional() private readonly projectNotifications?: ProjectNotifications,
  ) {}

  async execute({
    userId,
    projectId,
    kind,
  }: CreateExportCommand): Promise<ProjectExportMeta> {
    const project = await loadOwnProject(this.projects, userId, projectId);
    const topic = Topics.exportFailed(project.id);
    let created: ProjectExportMeta;
    try {
      created = await this.create(userId, project, kind);
    } catch (error) {
      // F11.12: "Auszug konnte nicht erstellt werden" — which kind, "Erneut versuchen".
      await this.notifications?.raise(userId, topic, {
        kind: 'error',
        projectId: project.id,
        params: { kind },
        action: projectRoute(
          project.id,
          'notifications.action.retry',
          'exports',
        ),
      });
      throw error;
    }
    await this.notifications?.resolve(userId, topic);
    // A statement made after sending is "seit dem Versand geändert" (F4.7).
    await this.projectNotifications?.sentChanged(userId, project.id);
    return created;
  }

  private async create(
    userId: string,
    project: Project,
    kind: ExportKind,
  ): Promise<ProjectExportMeta> {
    const snapshot = await this.data.currentSnapshot(userId, project);
    const data = await this.data.build(
      userId,
      project,
      snapshot,
      new Date().toISOString(),
    );
    const bytes = await this.render(kind, data);
    return this.exports.create(project.id, {
      kind,
      fileName: exportFileName(
        data,
        VARIANTS[kind],
        kind.endsWith('_pdf') ? 'pdf' : 'xlsx',
      ),
      bytes,
      snapshotId: snapshot.id,
      wealthChf: snapshot.wealthChf,
      incomeChf: snapshot.incomeChf,
    });
  }

  private async render(
    kind: ExportKind,
    data: ExportData,
  ): Promise<Uint8Array> {
    switch (kind) {
      case 'simple_xlsx':
        return simpleWorkbook(data);
      case 'detailed_xlsx':
        return detailedWorkbook(data);
      case 'internal_report_xlsx':
        return internalWorkbook(data);
      case 'simple_pdf':
      case 'detailed_pdf':
      case 'internal_report_pdf':
        try {
          return await this.pdf.render(
            kind === 'simple_pdf'
              ? simpleStatementHtml(data)
              : kind === 'detailed_pdf'
                ? detailedStatementHtml(data)
                : internalReportHtml(data),
          );
        } catch (error) {
          if (error instanceof PdfUnavailableError) {
            throw new ServiceUnavailableException({
              statusCode: 503,
              error: 'Service Unavailable',
              message:
                'PDF exports need Chromium: pnpm exec playwright-core install chromium, or PDF_CHROMIUM_PATH',
              code: 'pdfUnavailable',
            });
          }
          throw error;
        }
    }
  }
}

export class ListExportsQuery {
  constructor(
    readonly userId: string,
    readonly projectId: string,
  ) {}
}

@QueryHandler(ListExportsQuery)
export class ListExportsHandler implements IQueryHandler<
  ListExportsQuery,
  ProjectExportMeta[]
> {
  constructor(
    private readonly projects: ProjectRepositoryPort,
    private readonly exports: ProjectExportRepositoryPort,
  ) {}

  async execute({
    userId,
    projectId,
  }: ListExportsQuery): Promise<ProjectExportMeta[]> {
    const project = await loadOwnProject(this.projects, userId, projectId);
    return this.exports.listByProject(project.id);
  }
}

export class GetExportContentQuery {
  constructor(
    readonly userId: string,
    readonly projectId: string,
    readonly exportId: string,
  ) {}
}

@QueryHandler(GetExportContentQuery)
export class GetExportContentHandler implements IQueryHandler<
  GetExportContentQuery,
  ProjectExportContent
> {
  constructor(
    private readonly projects: ProjectRepositoryPort,
    private readonly exports: ProjectExportRepositoryPort,
  ) {}

  async execute({
    userId,
    projectId,
    exportId,
  }: GetExportContentQuery): Promise<ProjectExportContent> {
    const project = await loadOwnProject(this.projects, userId, projectId);
    const content = await this.exports.findContent(exportId);
    if (!content || content.projectId !== project.id) {
      throw new NotFoundException('No such export');
    }
    return content;
  }
}

export class GetMailDraftQuery {
  constructor(
    readonly userId: string,
    readonly projectId: string,
  ) {}
}

/** F10.6: from the latest result as it is (no recalculation for a draft). */
@QueryHandler(GetMailDraftQuery)
export class GetMailDraftHandler implements IQueryHandler<
  GetMailDraftQuery,
  MailDraft
> {
  constructor(
    private readonly projects: ProjectRepositoryPort,
    private readonly snapshots: CalculationSnapshotRepositoryPort,
    private readonly exports: ProjectExportRepositoryPort,
    private readonly data: ExportDataService,
  ) {}

  async execute({ userId, projectId }: GetMailDraftQuery): Promise<MailDraft> {
    const project = await loadOwnProject(this.projects, userId, projectId);
    const snapshot = await this.snapshots.latest(project.id);
    if (!snapshot) throw new NotFoundException('Not calculated yet');
    const data = await this.data.build(
      userId,
      project,
      snapshot,
      snapshot.createdAt,
    );
    return mailDraft(data, await this.exports.listByProject(project.id));
  }
}
