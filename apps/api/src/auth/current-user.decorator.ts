import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { AuthenticatedUser } from './authenticated-user';

/**
 * The request principal. Non-nullable by contract on protected routes (the global guard ran
 * first); on a `@Public()` route use `@OptionalUser()` instead.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedUser =>
    context.switchToHttp().getRequest<{ user: AuthenticatedUser }>().user,
);
