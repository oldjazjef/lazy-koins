import { Global, Module } from '@nestjs/common';
import { AccessTokenGuard } from './access-token.guard';
import { PrincipalService } from './principal.service';

/**
 * Authentication. `AccessTokenGuard` is bound globally in `app.module.ts` (so the guard order
 * lives in one place); `IdentityTokenVerifierPort` comes from `IntegrationsModule`.
 */
@Global()
@Module({
  providers: [PrincipalService, AccessTokenGuard],
  exports: [PrincipalService, AccessTokenGuard],
})
export class AuthModule {}
