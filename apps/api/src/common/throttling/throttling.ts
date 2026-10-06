import { type ExecutionContext, Injectable } from '@nestjs/common';
import {
  SkipThrottle,
  ThrottlerGuard,
  type ThrottlerModuleOptions,
  type ThrottlerRequest,
} from '@nestjs/throttler';
import type { AuthenticatedUser } from '../../auth/authenticated-user';

/**
 * Two budgets, two guards (the shape surf-lend uses). `default` is per IP and runs before
 * authentication (it must also cover requests with bad tokens). `writes` is per ACCOUNT and runs
 * after it, so one user cannot spread writes over many IPs, and many users behind one IP do not
 * share a budget.
 *
 * Routes tighten a budget with `@Throttle({ writes: { limit, ttl } })`.
 */
export const THROTTLERS = {
  default: { name: 'default', ttl: 60_000, limit: 120 },
  writes: { name: 'writes', ttl: 10 * 60_000, limit: 120 },
} as const;

/** Skips every budget — health checks. */
export const SkipAllThrottles = (): MethodDecorator & ClassDecorator =>
  SkipThrottle({ default: true, writes: true });

const READS = new Set(['GET', 'HEAD', 'OPTIONS']);

function isRead(context: ExecutionContext): boolean {
  const request = context.switchToHttp().getRequest<{ method: string }>();
  return READS.has(request.method);
}

export function throttlerOptions(): ThrottlerModuleOptions {
  return [THROTTLERS.default, { ...THROTTLERS.writes, skipIf: isRead }];
}

/** The per-IP budget only — before authentication. */
@Injectable()
export class IpThrottlerGuard extends ThrottlerGuard {
  protected override handleRequest(
    request: ThrottlerRequest,
  ): Promise<boolean> {
    return request.throttler.name === THROTTLERS.default.name
      ? super.handleRequest(request)
      : Promise.resolve(true);
  }
}

/** The per-account budgets — after authentication; anonymous callers count by IP. */
@Injectable()
export class AccountThrottlerGuard extends ThrottlerGuard {
  protected override handleRequest(
    request: ThrottlerRequest,
  ): Promise<boolean> {
    return request.throttler.name === THROTTLERS.default.name
      ? Promise.resolve(true)
      : super.handleRequest(request);
  }

  protected override getTracker(request: {
    user?: AuthenticatedUser;
    ip?: string;
  }): Promise<string> {
    return Promise.resolve(
      request.user ? `user:${request.user.userId}` : `ip:${request.ip ?? ''}`,
    );
  }
}
