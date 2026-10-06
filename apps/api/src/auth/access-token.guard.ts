import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthenticatedUser } from './authenticated-user';
import { IdentityTokenVerifierPort } from './ports/identity-token-verifier.port';
import { PrincipalService } from './principal.service';
import { IS_PUBLIC_KEY } from './public.decorator';

interface GuardedRequest {
  headers: { authorization?: string };
  user?: AuthenticatedUser;
}

/**
 * Global guard: every route requires a valid bearer token unless it is `@Public()`.
 *
 * On a public route a token is still honoured when present, but a missing or invalid one is not
 * an error there. A request without a token gets the verifier's ambient identity — none, except
 * in `AUTH_MODE=local` (the desktop app), where it is the machine's single user.
 *
 * The API is a resource server only: it never issues tokens. The web app signs in with Firebase
 * and sends the Firebase ID token; `IdentityTokenVerifierPort` checks it.
 */
@Injectable()
export class AccessTokenGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly verifier: IdentityTokenVerifierPort,
    private readonly principals: PrincipalService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const request = context.switchToHttp().getRequest<GuardedRequest>();
    const token = bearerToken(request.headers.authorization);

    const identity = token
      ? await this.verifier.verify(token)
      : this.verifier.ambient();
    if (!identity) {
      if (isPublic) return true;
      throw new UnauthorizedException(
        token
          ? 'Invalid or expired token'
          : 'Missing or invalid Authorization header',
      );
    }

    request.user = await this.principals.resolve(identity);
    return true;
  }
}

function bearerToken(header: string | undefined): string | undefined {
  const [scheme, token, ...rest] = (header ?? '').split(' ');
  return scheme === 'Bearer' && token && rest.length === 0 ? token : undefined;
}
