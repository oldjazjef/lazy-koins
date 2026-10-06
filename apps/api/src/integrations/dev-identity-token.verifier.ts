import { Injectable } from '@nestjs/common';
import { IdentityTokenVerifierPort } from '../auth/ports/identity-token-verifier.port';
import type { VerifiedIdentity } from '../users/domain/user';

const PREFIX = 'dev:';
const EMAIL = /^[^\s@]+@[^\s@]+$/;

/**
 * `AUTH_MODE=dev` only — `validateEnv` refuses it in production. The bearer token
 * `dev:anna@lazykoins.dev` authenticates as that address, with the uid `dev:anna@lazykoins.dev`,
 * which is what scripts/dev/seed.mjs gives its user. No signature, no expiry: this exists so the
 * whole stack runs without a Firebase project.
 */
@Injectable()
export class DevIdentityTokenVerifier extends IdentityTokenVerifierPort {
  async verify(token: string): Promise<VerifiedIdentity | undefined> {
    if (!token.startsWith(PREFIX)) return undefined;
    const email = token.slice(PREFIX.length).trim().toLowerCase();
    if (!EMAIL.test(email)) return undefined;
    return {
      uid: `${PREFIX}${email}`,
      email,
      emailVerified: true,
      name: null,
      signInProvider: 'dev',
    };
  }
}
