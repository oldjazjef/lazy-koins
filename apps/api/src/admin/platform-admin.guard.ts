import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AuthenticatedUser } from '../auth/authenticated-user';
import type { Env } from '../config/env';

/**
 * The management pages: platform admins only (403 `adminOnly`). On the desktop
 * (`AUTH_MODE=local`, one local user) they do not exist — 404 before anything else.
 */
@Injectable()
export class PlatformAdminGuard implements CanActivate {
  constructor(private readonly config: ConfigService<Env, true>) {}

  canActivate(context: ExecutionContext): boolean {
    if (this.config.get('AUTH_MODE', { infer: true }) === 'local') {
      throw new NotFoundException();
    }
    const user = context
      .switchToHttp()
      .getRequest<{ user?: AuthenticatedUser }>().user;
    if (!user?.isPlatformAdmin) {
      throw new ForbiddenException({
        statusCode: 403,
        error: 'Forbidden',
        message: 'Platform admins only',
        code: 'adminOnly',
      });
    }
    return true;
  }
}
