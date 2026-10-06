/**
 * How the app obtains the bearer token the API accepts. Two implementations, picked by
 * `runtimeEnv().authMode`, which must match the API's `AUTH_MODE`.
 */
export interface AuthStrategy {
  /** Resolves once a persisted session (if any) has been restored; true = signed in. */
  restore(): Promise<boolean>;
  /** A current token, refreshed if it is about to expire; null when signed out. */
  token(): Promise<string | null>;
  /** The signed-in e-mail address, for the header; null when signed out. */
  email(): string | null;
  signOut(): Promise<void>;
}
