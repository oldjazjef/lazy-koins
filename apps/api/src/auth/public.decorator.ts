import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'auth:isPublic';

/**
 * Marks a route as reachable without a token. Authentication is global, so a new endpoint is
 * protected by default and opting out is the explicit, greppable act.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
