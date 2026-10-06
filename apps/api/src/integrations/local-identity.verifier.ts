import { IdentityTokenVerifierPort } from '../auth/ports/identity-token-verifier.port';
import type { VerifiedIdentity } from '../users/domain/user';

/** The uid of the desktop app's single user — stable, so its data survives restarts. */
export const LOCAL_UID = 'local:owner';

/**
 * `AUTH_MODE=local` only (the Electron desktop app, F1.2): no login, one user, data on this
 * machine. Every request — with or without a token, whatever the token says — acts as that one
 * user. `validateEnv` demands `LOCAL_MODE=true` for it and main.ts then listens on 127.0.0.1
 * only, so nothing outside the machine can reach an API that trusts everyone.
 */
export class LocalIdentityVerifier extends IdentityTokenVerifierPort {
  private readonly identity: VerifiedIdentity;

  constructor(email: string) {
    super();
    this.identity = {
      uid: LOCAL_UID,
      email: email.trim().toLowerCase(),
      emailVerified: true,
      name: null,
      signInProvider: 'local',
    };
  }

  async verify(_token: string): Promise<VerifiedIdentity> {
    return this.identity;
  }

  override ambient(): VerifiedIdentity {
    return this.identity;
  }
}
