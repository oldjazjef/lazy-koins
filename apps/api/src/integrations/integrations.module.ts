import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IdentityTokenVerifierPort } from '../auth/ports/identity-token-verifier.port';
import type { Env } from '../config/env';
import { DevIdentityTokenVerifier } from './dev-identity-token.verifier';
import { FirebaseIdentityTokenVerifier } from './firebase/firebase-identity-token.verifier';
import { LocalIdentityVerifier } from './local-identity.verifier';

/**
 * External services behind ports, the counterpart of `PersistenceModule` for everything that is
 * not the database. The only place that decides *which* adapter backs a port — and the only code
 * that imports firebase-admin. Later: rate sources (ESTV, CoinGecko) and one `ChainDataPort`
 * adapter per wallet network.
 */
@Global()
@Module({
  providers: [
    {
      provide: IdentityTokenVerifierPort,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => {
        switch (config.get('AUTH_MODE', { infer: true })) {
          case 'dev':
            return new DevIdentityTokenVerifier();
          case 'local':
            return new LocalIdentityVerifier(
              config.get('LOCAL_USER_EMAIL', { infer: true }),
            );
          default:
            return new FirebaseIdentityTokenVerifier(config);
        }
      },
    },
  ],
  exports: [IdentityTokenVerifierPort],
})
export class IntegrationsModule {}
