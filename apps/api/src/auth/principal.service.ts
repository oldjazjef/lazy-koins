import { ForbiddenException, Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { type Env, platformAdminEmails } from '../config/env';
import { displayNameFor, type VerifiedIdentity } from '../users/domain/user';
import { UserRepositoryPort } from '../users/ports/user.repository.port';
import type { AuthenticatedUser } from './authenticated-user';

/** `last_seen_at` is written at most this often per user (one write, not one per request). */
const LAST_SEEN_EVERY_MS = 15 * 60 * 1000;

/**
 * Turns a verified identity into the request principal, creating the account on first sight.
 *
 * Called on every authenticated request, so it calls the port directly rather than through the
 * query bus (same exception surf-lend and etx make for their principal lookup). The common case
 * is one indexed lookup by identity uid; the upsert only runs for a uid never seen before — the
 * first request after sign-up.
 *
 * Platform admin: a blocked account answers 403 `accountBlocked` on every request; an address in
 * `PLATFORM_ADMIN_EMAILS` becomes admin on its first request **with a verified e-mail** (never
 * from an unverified one — anyone could register it). Not in `AUTH_MODE=local` (no admins).
 */
@Injectable()
export class PrincipalService {
  private readonly bootstrapAdmins: ReadonlySet<string>;
  private readonly local: boolean;

  constructor(
    private readonly users: UserRepositoryPort,
    @Optional() config?: ConfigService<Env, true>,
  ) {
    this.local = config?.get('AUTH_MODE', { infer: true }) === 'local';
    this.bootstrapAdmins = config
      ? platformAdminEmails({
          PLATFORM_ADMIN_EMAILS:
            config.get('PLATFORM_ADMIN_EMAILS', { infer: true }) ?? '',
        })
      : new Set();
  }

  async resolve(identity: VerifiedIdentity): Promise<AuthenticatedUser> {
    const known = await this.users.findPrincipalByIdentityUid(identity.uid);
    if (known?.blockedAt) {
      throw new ForbiddenException({
        statusCode: 403,
        error: 'Forbidden',
        message: 'This account is blocked',
        code: 'accountBlocked',
      });
    }
    const id =
      known?.id ??
      (await this.users.upsertFromIdentity(identity, displayNameFor(identity)))
        .id;
    let isPlatformAdmin = known?.isPlatformAdmin ?? false;
    if (
      !isPlatformAdmin &&
      !this.local &&
      identity.emailVerified &&
      identity.email &&
      this.bootstrapAdmins.has(identity.email.toLowerCase())
    ) {
      await this.users.grantPlatformAdmin(id);
      isPlatformAdmin = true;
    }
    await this.touch(id, known?.lastSeenAt ?? null);
    return {
      userId: id,
      email: identity.email ?? '',
      ...(identity.authTime ? { authTime: identity.authTime } : {}),
      ...(isPlatformAdmin ? { isPlatformAdmin } : {}),
    };
  }

  private async touch(id: string, lastSeenAt: string | null): Promise<void> {
    const now = new Date();
    if (
      lastSeenAt &&
      now.getTime() - Date.parse(lastSeenAt) < LAST_SEEN_EVERY_MS
    ) {
      return;
    }
    await this.users.touchLastSeen(id, now.toISOString());
  }
}
