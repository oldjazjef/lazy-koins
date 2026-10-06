import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { AuthenticatedUser } from './authenticated-user';

/** The principal on a `@Public()` route, or `undefined` for an anonymous caller. */
export const OptionalUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedUser | undefined =>
    context.switchToHttp().getRequest<{ user?: AuthenticatedUser }>().user,
);
