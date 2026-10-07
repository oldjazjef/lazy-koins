import { BadRequestException, Logger } from '@nestjs/common';
import { conflict } from '../../common/http/api-errors';
import { ConfigService } from '@nestjs/config';
import {
  CommandHandler,
  type ICommandHandler,
  type IQueryHandler,
  QueryHandler,
} from '@nestjs/cqrs';
import { assertProjectOpen } from '../../calculation/application/calculation.handlers';
import type { Env } from '../../config/env';
import { loadOwnProject } from '../../projects/application/project-access';
import { ProjectRepositoryPort } from '../../projects/ports/project.repository.port';
import { SettingsReader } from '../../settings/application/settings.handlers';
import type { EstvApplySummary } from './estv-project-rates.service';
import { EstvProjectRatesService } from './estv-project-rates.service';
import {
  ESTV_FIRST_YEAR,
  type EstvStatus,
  EstvSyncService,
} from './estv-sync.service';

/** The status plus whether this user may start a download (F11.3). */
export interface EstvStatusView extends EstvStatus {
  readonly online: boolean;
}

async function statusFor(
  sync: EstvSyncService,
  settings: SettingsReader,
  config: ConfigService<Env, true>,
  userId: string,
): Promise<EstvStatusView> {
  const resolved = await settings.resolve(userId);
  return {
    ...(await sync.status()),
    online:
      resolved.onlineRates &&
      config.get('RATES_ONLINE', { infer: true }) !== 'false',
  };
}

export class GetEstvStatusQuery {
  constructor(readonly userId: string) {}
}

/** F7.4a: the stored Kursliste versions, the last checks (errors too) and a running update. */
@QueryHandler(GetEstvStatusQuery)
export class GetEstvStatusHandler implements IQueryHandler<
  GetEstvStatusQuery,
  EstvStatusView
> {
  constructor(
    private readonly sync: EstvSyncService,
    private readonly settings: SettingsReader,
    private readonly config: ConfigService<Env, true>,
  ) {}

  execute({ userId }: GetEstvStatusQuery): Promise<EstvStatusView> {
    return statusFor(this.sync, this.settings, this.config, userId);
  }
}

export class StartEstvUpdateCommand {
  constructor(
    readonly userId: string,
    /** One tax year; absent = every stored year and last year. */
    readonly year?: number,
  ) {}
}

/**
 * "ESTV-Kursliste aktualisieren" (F7.4a): starts the check/download in the background and
 * answers at once with the status (`running`); the app polls `GET /api/rates/estv`. Refused (409)
 * with `ESTV_AUTO=false`, `RATES_ONLINE=false` or the user's rate lookups off (F11.3).
 */
@CommandHandler(StartEstvUpdateCommand)
export class StartEstvUpdateHandler implements ICommandHandler<
  StartEstvUpdateCommand,
  EstvStatusView
> {
  private readonly logger = new Logger('EstvUpdate');

  constructor(
    private readonly sync: EstvSyncService,
    private readonly settings: SettingsReader,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async execute({
    userId,
    year,
  }: StartEstvUpdateCommand): Promise<EstvStatusView> {
    const resolved = await this.settings.resolve(userId);
    if (!this.sync.autoEnabled()) {
      throw conflict(
        'estvAutoOff',
        'The automatic ESTV Kursliste is switched off (ESTV_AUTO / RATES_ONLINE)',
      );
    }
    if (!resolved.onlineRates) {
      throw conflict(
        'offline',
        'Rate lookups on the internet are switched off (settings)',
      );
    }
    const thisYear = this.sync.now().getUTCFullYear();
    if (year !== undefined && (year < ESTV_FIRST_YEAR || year > thisYear)) {
      throw new BadRequestException(
        `year must be between ${ESTV_FIRST_YEAR} and ${thisYear}`,
      );
    }
    const years = year !== undefined ? [year] : await this.sync.yearsToCheck();
    void this.sync.run(years, userId).catch((error: unknown) => {
      this.logger.warn(`ESTV update failed: ${(error as Error).message}`);
    });
    return statusFor(this.sync, this.settings, this.config, userId);
  }
}

export class ApplyEstvCommand {
  constructor(
    readonly userId: string,
    readonly projectId: string,
  ) {}
}

/**
 * Takes the stored Kursliste of the project's tax year into its rates (F7.4a) — local data, no
 * network. "Kurse aktualisieren" does the same before fetching the other sources.
 */
@CommandHandler(ApplyEstvCommand)
export class ApplyEstvHandler implements ICommandHandler<
  ApplyEstvCommand,
  EstvApplySummary
> {
  constructor(
    private readonly projects: ProjectRepositoryPort,
    private readonly settings: SettingsReader,
    private readonly estv: EstvProjectRatesService,
  ) {}

  async execute({
    userId,
    projectId,
  }: ApplyEstvCommand): Promise<EstvApplySummary> {
    const project = await loadOwnProject(this.projects, userId, projectId);
    assertProjectOpen(project);
    const settings = await this.settings.resolve(userId);
    return this.estv.apply(project, { coingeckoIds: settings.coingeckoIds });
  }
}
