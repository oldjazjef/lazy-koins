import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getAuth } from 'firebase-admin/auth';
import { IdentityTokenVerifierPort } from '../../auth/ports/identity-token-verifier.port';
import type { Env } from '../../config/env';
import type { VerifiedIdentity } from '../../users/domain/user';
import { firebaseApp } from './firebase-app';

/**
 * Verifies Firebase Authentication ID tokens: signature against Google's public keys, audience =
 * our project (`FIREBASE_PROJECT_ID`), not expired. Revocation is not checked per request
 * (`checkRevoked` would cost a network round trip every time); ID tokens live one hour, which
 * bounds the window.
 */
@Injectable()
export class FirebaseIdentityTokenVerifier extends IdentityTokenVerifierPort {
  private readonly logger = new Logger(FirebaseIdentityTokenVerifier.name);

  constructor(private readonly config: ConfigService<Env, true>) {
    super();
  }

  async verify(token: string): Promise<VerifiedIdentity | undefined> {
    const project = this.config.get('FIREBASE_PROJECT_ID', { infer: true });
    try {
      const decoded = await getAuth(firebaseApp(project)).verifyIdToken(token);
      return {
        uid: decoded.uid,
        email: decoded.email ?? null,
        emailVerified: decoded.email_verified === true,
        name: typeof decoded['name'] === 'string' ? decoded['name'] : null,
        signInProvider: decoded.firebase.sign_in_provider,
        // Seconds since the epoch of the actual sign-in (stays the same across token refreshes).
        ...(typeof decoded.auth_time === 'number'
          ? { authTime: new Date(decoded.auth_time * 1000).toISOString() }
          : {}),
      };
    } catch (error) {
      this.logger.debug(
        `Rejected ID token: ${error instanceof Error ? error.message : error}`,
      );
      return undefined;
    }
  }
}
