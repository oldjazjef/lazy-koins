/**
 * The setup wizard (F11.0s) and the PIN lock (F11.0p) — mirrors of apps/api's `setup/dto` and
 * `pin/dto`, hand-written like the other API types.
 */

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

export interface SetupStep {
  id: SetupStepId;
  required: boolean;
  state: StepState;
}

export interface SetupFacts {
  profile: boolean;
  advisor: boolean;
  ai: boolean;
  onlineRates: boolean;
  coingeckoKey: boolean;
  etherscanKey: boolean;
  mail: boolean;
  pin: boolean;
  keyStorage: boolean;
}

export interface SetupView {
  mode: 'desktop' | 'web';
  steps: SetupStep[];
  currentStep: SetupStepId;
  completedAt: string | null;
  complete: boolean;
  missing: SetupStepId[];
  facts: SetupFacts;
}

export interface UpdateSetupRequest {
  currentStep?: SetupStepId;
  states?: Partial<Record<SetupStepId, StepState>>;
}

export interface PinStatus {
  mode: 'desktop' | 'web';
  hasPin: boolean;
  required: boolean;
  unlocked: boolean;
  expiresAt: string | null;
  autoLockMinutes: number;
  failedAttempts: number;
  retryAfterSeconds: number;
  reloginRequired: boolean;
  maxFailures: number | null;
}

export interface UnlockGrant {
  token: string;
  expiresAt: string;
}

export interface PinUnlocked {
  status: PinStatus;
  unlock: UnlockGrant;
}

export interface PinReset {
  status: PinStatus;
  erasedKeys: Record<'ai' | 'mail' | 'coingecko' | 'etherscan', boolean> | null;
}

/** The error codes of the PIN endpoints (`pin.errors.<code>`). */
export const PIN_ERROR_CODES = [
  'wrongPin',
  'pinThrottled',
  'reloginRequired',
  'invalidPin',
  'currentPinRequired',
  'pinRequired',
  'confirmationRequired',
  'noPin',
] as const;
export type PinErrorCode = (typeof PIN_ERROR_CODES)[number];

export const KEY_CHECK_CODES = [
  'invalidKey',
  'rateLimited',
  'network',
  'timeout',
  'providerError',
] as const;

/** `POST /api/settings/keys/coingecko/test`. */
export interface KeyCheckResult {
  ok: boolean;
  code?: (typeof KEY_CHECK_CODES)[number];
  status: number | null;
  providerMessage: string | null;
  url: string;
  millis: number;
}
