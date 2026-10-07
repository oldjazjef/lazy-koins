import { Injectable } from '@nestjs/common';
import { IdentityTokenVerifierPort } from '../auth/ports/identity-token-verifier.port';
import type { VerifiedIdentity } from '../users/domain/user';

const PREFIX = 'dev:';
const EMAIL = /^[^\s@#]+@[^\s@#]+$/;
/** Optional `#<epoch ms>` after the address: when the dev user signed in (like Firebase `auth_time`). */
const SIGNED_IN_AT = /^(.*)#(\d{10,16})$/;

/**
 * `AUTH_MODE=dev` only — `validateEnv` refuses it in production. The bearer token
 * `dev:anna@lazykoins.dev` authenticates as that address, with the uid `dev:anna@lazykoins.dev`,
 * which is what scripts/dev/seed.mjs gives its user. No signature, no expiry: this exists so the
 * whole stack runs without a Firebase project. The app's dev sign-in appends `#<epoch ms>` of the
 * sign-in, so the PIN lock's "fresh sign-in" rule (F11.0p) works in dev as with Firebase.
 */
@Injectable()
export class DevIdentityTokenVerifier extends IdentityTokenVerifierPort {
  async verify(token: string): Promise<VerifiedIdentity | undefined> {
    if (!token.startsWith(PREFIX)) return undefined;
    let rest = token.slice(PREFIX.length).trim();
    let authTime: string | undefined;
    const timed = SIGNED_IN_AT.exec(rest);
    if (timed?.[1] && timed[2]) {
      rest = timed[1];
      authTime = new Date(Number(timed[2])).toISOString();
    }
    const email = rest.toLowerCase();
    if (!EMAIL.test(email)) return undefined;
    return {
      uid: `${PREFIX}${email}`,
      email,
      emailVerified: true,
      name: null,
      signInProvider: 'dev',
      ...(authTime ? { authTime } : {}),
    };
  }
}
