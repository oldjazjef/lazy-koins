/**
 * The setup wizard (F11.0s) — hand-written domain types and the pure rules: which steps exist on
 * which platform, which are required, when the wizard counts as finished.
 */
import type { PinMode } from '../../pin/domain/pin';

export const SETUP_STEPS = [
  'profile',
  'advisor',
  'ai',
  'rates',
  'wallets',
  'mail',
  'storage',
  'pin',
  'summary',
] as const;
export type SetupStepId = (typeof SETUP_STEPS)[number];

export const STEP_STATES = ['open', 'done', 'skipped', 'error'] as const;
export type StepState = (typeof STEP_STATES)[number];

export interface SetupProgress {
  readonly userId: string;
  readonly steps: Readonly<Partial<Record<SetupStepId, StepState>>>;
  readonly currentStep: SetupStepId;
  /** "App starten" pressed; null = the app sends the user to the wizard. */
  readonly completedAt: string | null;
  readonly updatedAt: string | null;
}

export type SaveSetupProgressInput = Omit<
  SetupProgress,
  'userId' | 'updatedAt'
>;

export function emptyProgress(userId: string): SetupProgress {
  return {
    userId,
    steps: {},
    currentStep: 'profile',
    completedAt: null,
    updatedAt: null,
  };
}

/** What is actually configured — read from the settings, not from the step states. */
export interface SetupFacts {
  /** Name and Wohnkanton set (F11.1). */
  readonly profile: boolean;
  /** Treuhänder name or address. */
  readonly advisor: boolean;
  /** The AI plugin is on and configured (F5.13). */
  readonly ai: boolean;
  /** F11.3 rate lookups on. */
  readonly onlineRates: boolean;
  readonly coingeckoKey: boolean;
  readonly etherscanKey: boolean;
  /** A mailer that can send (F11.10). */
  readonly mail: boolean;
  readonly pin: boolean;
  /** `SETTINGS_ENCRYPTION_KEY` set: keys can be stored at all. */
  readonly keyStorage: boolean;
}

export interface SetupStepDefinition {
  readonly id: SetupStepId;
  readonly required: boolean;
}

/** The steps on this platform, in order: Speicherort only on the desktop; PIN required there. */
export function stepsFor(mode: PinMode): readonly SetupStepDefinition[] {
  return SETUP_STEPS.filter((id) => id !== 'storage' || mode === 'desktop').map(
    (id) => ({
      id,
      required: id === 'profile' || (id === 'pin' && mode === 'desktop'),
    }),
  );
}

/** A required step whose facts are missing — what keeps "App starten" disabled. */
export function missingRequired(
  mode: PinMode,
  facts: SetupFacts,
): SetupStepId[] {
  const missing: SetupStepId[] = [];
  if (!facts.profile) missing.push('profile');
  if (mode === 'desktop' && !facts.pin) missing.push('pin');
  return missing;
}

/**
 * Finished = "App starten" was pressed and nothing required has gone missing since (the desktop's
 * PIN after "PIN vergessen"). Skipped optional steps count as finished.
 */
export function setupComplete(
  progress: SetupProgress,
  mode: PinMode,
  facts: SetupFacts,
): boolean {
  return (
    progress.completedAt !== null && missingRequired(mode, facts).length === 0
  );
}

/** Whether a step may be marked `done` (its facts exist) — required steps are checked. */
export function canMarkDone(step: SetupStepId, facts: SetupFacts): boolean {
  if (step === 'profile') return facts.profile;
  if (step === 'pin') return facts.pin;
  return true;
}
