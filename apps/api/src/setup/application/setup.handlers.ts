import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CommandHandler,
  type ICommandHandler,
  type IQueryHandler,
  QueryHandler,
} from '@nestjs/cqrs';
import { aiReady } from '../../ai/domain/ai-settings';
import { AiSettingsRepositoryPort } from '../../ai/ports/ai-settings.repository.port';
import type { Env } from '../../config/env';
import { mailReady } from '../../mail/domain/mail-settings';
import { MailSettingsRepositoryPort } from '../../mail/ports/mail.repository.port';
import {
  PinClock,
  PinLockState,
  PinRuntime,
} from '../../pin/application/pin-sessions';
import type { PinMode } from '../../pin/domain/pin';
import { UserSettingsRepositoryPort } from '../../settings/ports/user-settings.repository.port';
import {
  canMarkDone,
  emptyProgress,
  missingRequired,
  type SetupFacts,
  type SetupProgress,
  type SetupStepId,
  setupComplete,
  type StepState,
  stepsFor,
} from '../domain/setup';
import { SetupProgressRepositoryPort } from '../ports/setup-progress.repository.port';

export interface SetupStepView {
  readonly id: SetupStepId;
  readonly required: boolean;
  readonly state: StepState;
}

/** The wizard as the app sees it. */
export interface SetupView {
  readonly mode: PinMode;
  readonly steps: readonly SetupStepView[];
  readonly currentStep: SetupStepId;
  readonly completedAt: string | null;
  /** The app opens normally; false = it sends the user to /app/setup. */
  readonly complete: boolean;
  /** Required steps whose settings are missing (they keep "App starten" disabled). */
  readonly missing: readonly SetupStepId[];
  readonly facts: SetupFacts;
}

/** Reads what is configured from the slices' own ports (never opens a key). */
@Injectable()
export class SetupFactsReader {
  constructor(
    private readonly settings: UserSettingsRepositoryPort,
    private readonly ai: AiSettingsRepositoryPort,
    private readonly mail: MailSettingsRepositoryPort,
    private readonly pins: PinLockState,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async read(userId: string): Promise<SetupFacts> {
    const [settings, ai, mail, pin] = await Promise.all([
      this.settings.find(userId),
      this.ai.find(userId),
      this.mail.find(userId),
      this.pins.pinOf(userId),
    ]);
    return {
      profile: Boolean(settings?.displayName && settings.canton),
      advisor: Boolean(settings?.advisorName || settings?.advisorEmail),
      ai: ai ? aiReady(ai) : false,
      onlineRates: settings?.onlineRates ?? true,
      coingeckoKey: Boolean(settings?.sealedKeys.coingecko),
      etherscanKey: Boolean(settings?.sealedKeys.etherscan),
      mail: mail ? mailReady(mail) : false,
      pin: pin !== null,
      keyStorage:
        (this.config.get('SETTINGS_ENCRYPTION_KEY', { infer: true }) ?? '') !==
        '',
    };
  }
}

/** Builds the view; shared by every handler. */
@Injectable()
export class SetupViews {
  constructor(
    private readonly progress: SetupProgressRepositoryPort,
    private readonly facts: SetupFactsReader,
    private readonly runtime: PinRuntime,
  ) {}

  get mode(): PinMode {
    return this.runtime.mode;
  }

  async load(
    userId: string,
  ): Promise<{ progress: SetupProgress; facts: SetupFacts }> {
    const [progress, facts] = await Promise.all([
      this.progress.find(userId),
      this.facts.read(userId),
    ]);
    return { progress: progress ?? emptyProgress(userId), facts };
  }

  view(progress: SetupProgress, facts: SetupFacts): SetupView {
    const mode = this.mode;
    return {
      mode,
      steps: stepsFor(mode).map(({ id, required }) => ({
        id,
        required,
        state: stateOf(id, progress, facts),
      })),
      currentStep:
        progress.currentStep === 'storage' && mode !== 'desktop'
          ? 'pin'
          : progress.currentStep,
      completedAt: progress.completedAt,
      complete: setupComplete(progress, mode, facts),
      missing: missingRequired(mode, facts),
      facts,
    };
  }
}

/** A required step reads as `open` again when its settings went missing (PIN vergessen). */
function stateOf(
  id: SetupStepId,
  progress: SetupProgress,
  facts: SetupFacts,
): StepState {
  const stored = progress.steps[id] ?? 'open';
  if (stored === 'done' && !canMarkDone(id, facts)) return 'open';
  return stored;
}

export class GetSetupQuery {
  constructor(readonly userId: string) {}
}

@QueryHandler(GetSetupQuery)
export class GetSetupHandler implements IQueryHandler<
  GetSetupQuery,
  SetupView
> {
  constructor(private readonly views: SetupViews) {}

  async execute({ userId }: GetSetupQuery): Promise<SetupView> {
    const { progress, facts } = await this.views.load(userId);
    return this.views.view(progress, facts);
  }
}

export interface SetupChanges {
  /** The step on screen, so a resumed wizard opens there. */
  readonly currentStep?: SetupStepId;
  readonly states?: Readonly<Partial<Record<SetupStepId, StepState>>>;
}

export class UpdateSetupCommand {
  constructor(
    readonly userId: string,
    readonly changes: SetupChanges,
  ) {}
}

/**
 * Stores step states and the current step. A required step cannot be skipped, and `done` needs
 * its settings (profile: name + Wohnkanton; PIN: a PIN) — 422 `stepRequired` / `stepIncomplete`.
 */
@CommandHandler(UpdateSetupCommand)
export class UpdateSetupHandler implements ICommandHandler<
  UpdateSetupCommand,
  SetupView
> {
  constructor(
    private readonly progress: SetupProgressRepositoryPort,
    private readonly views: SetupViews,
  ) {}

  async execute({ userId, changes }: UpdateSetupCommand): Promise<SetupView> {
    const { progress, facts } = await this.views.load(userId);
    const definitions = stepsFor(this.views.mode);
    const steps = { ...progress.steps };
    for (const [id, state] of Object.entries(changes.states ?? {}) as Array<
      [SetupStepId, StepState]
    >) {
      const definition = definitions.find((step) => step.id === id);
      if (!definition) {
        throw problem('unknownStep', `Step ${id} does not exist here`, id);
      }
      if (state === 'skipped' && definition.required) {
        throw problem('stepRequired', `Step ${id} cannot be skipped`, id);
      }
      if (state === 'done' && !canMarkDone(id, facts)) {
        throw problem('stepIncomplete', `Step ${id} is not set up yet`, id);
      }
      steps[id] = state;
    }
    const currentStep =
      changes.currentStep &&
      definitions.some((step) => step.id === changes.currentStep)
        ? changes.currentStep
        : progress.currentStep;
    const saved = await this.progress.save(userId, {
      steps,
      currentStep,
      completedAt: progress.completedAt,
    });
    return this.views.view(saved, facts);
  }
}

export class CompleteSetupCommand {
  constructor(readonly userId: string) {}
}

/** "App starten": every required step is set up → the wizard is finished. */
@CommandHandler(CompleteSetupCommand)
export class CompleteSetupHandler implements ICommandHandler<
  CompleteSetupCommand,
  SetupView
> {
  constructor(
    private readonly progress: SetupProgressRepositoryPort,
    private readonly views: SetupViews,
    private readonly clock: PinClock,
  ) {}

  async execute({ userId }: CompleteSetupCommand): Promise<SetupView> {
    const { progress, facts } = await this.views.load(userId);
    const missing = missingRequired(this.views.mode, facts);
    if (missing.length > 0) {
      throw new UnprocessableEntityException({
        statusCode: 422,
        error: 'Unprocessable Entity',
        message: `Required steps are not set up: ${missing.join(', ')}`,
        code: 'setupIncomplete',
        missing,
      });
    }
    const steps = { ...progress.steps };
    for (const { id, required } of stepsFor(this.views.mode)) {
      if (required || id === 'summary') steps[id] = 'done';
      // An optional step never touched counts as skipped ("Später").
      else if (!steps[id] || steps[id] === 'open') steps[id] = 'skipped';
    }
    const saved = await this.progress.save(userId, {
      steps,
      currentStep: 'summary',
      completedAt:
        progress.completedAt ?? new Date(this.clock.now()).toISOString(),
    });
    return this.views.view(saved, facts);
  }
}

function problem(
  code: string,
  message: string,
  step: string,
): UnprocessableEntityException {
  return new UnprocessableEntityException({
    statusCode: 422,
    error: 'Unprocessable Entity',
    message,
    code,
    step,
  });
}
