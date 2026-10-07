import {
  type CanActivate,
  type ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthenticatedUser } from '../auth/authenticated-user';
import {
  PinLockState,
  PinSessions,
  UNLOCK_HEADER,
} from './application/pin-sessions';

export const ALLOW_WHILE_LOCKED_KEY = 'pin:allowWhileLocked';

/**
 * Marks a route that answers while the PIN lock is closed: the lock's own endpoints (status,
 * unlock, lock, forgot) and `GET /me`. Everything else is a data request and is refused.
 */
export const AllowWhileLocked = () => SetMetadata(ALLOW_WHILE_LOCKED_KEY, true);

interface LockedRequest {
  headers: Record<string, string | string[] | undefined>;
  user?: AuthenticatedUser;
}

/** The unlock token of a request, if it sent one. */
export function unlockTokenOf(request: {
  headers: Record<string, string | string[] | undefined>;
}): string | undefined {
  const value = request.headers[UNLOCK_HEADER];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * F11.0p, enforced in the API — not only in the UI: a user with a PIN gets **423 Locked**
 * (`code: pinLocked`) for every data request without a valid unlock token
 * (`x-lazykoins-unlock`). A valid token is renewed by the request (sliding auto-lock). Runs after
 * `AccessTokenGuard` (it needs the user); anonymous and public requests pass untouched. Same for
 * the web app and the desktop app — there the API runs in-process, so every start begins locked.
 */
@Injectable()
export class PinLockGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly state: PinLockState,
    private readonly sessions: PinSessions,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<LockedRequest>();
    if (!request.user) return true;
    const allowed = this.reflector.getAllAndOverride<boolean>(
      ALLOW_WHILE_LOCKED_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (allowed) return true;
    const pin = await this.state.pinOf(request.user.userId);
    if (!pin) return true;
    if (this.sessions.touch(unlockTokenOf(request), request.user.userId)) {
      return true;
    }
    throw new HttpException(
      {
        statusCode: HttpStatus.LOCKED,
        error: 'Locked',
        message: 'The app is locked: unlock it with the PIN',
        code: 'pinLocked',
      },
      HttpStatus.LOCKED,
    );
  }
}
