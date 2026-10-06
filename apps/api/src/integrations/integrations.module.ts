import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IdentityTokenVerifierPort } from '../auth/ports/identity-token-verifier.port';
import type { Env } from '../config/env';
import { PdfRendererPort } from '../exports/ports/project-export.repository.port';
import {
  ChfPriceSourcePort,
  FxRateSourcePort,
  UsdPriceSourcePort,
} from '../rates/ports/rate-source.port';
import { AiCompletionPort } from './ai/ai-completion.port';
import { ProviderSwitchingAiCompletion } from './ai/provider-switching.adapter';
import { DevIdentityTokenVerifier } from './dev-identity-token.verifier';
import { FirebaseIdentityTokenVerifier } from './firebase/firebase-identity-token.verifier';
import { LocalIdentityVerifier } from './local-identity.verifier';
import { PlaywrightPdfRenderer } from './pdf/playwright-pdf.renderer';
import { BinanceKlinesSource } from './rates/binance-klines.source';
import { CoinGeckoSource } from './rates/coingecko.source';
import { FrankfurterFxSource } from './rates/frankfurter-fx.source';

/**
 * External services behind ports, the counterpart of `PersistenceModule` for everything that is
 * not the database. The only place that decides *which* adapter backs a port — and the only code
 * that imports firebase-admin. The AI plugin's `AiCompletionPort` (F5.13) dispatches per call to
 * the OpenAI-compatible or the Anthropic adapter, from the user's settings. Rate sources
 * (Binance, CoinGecko, ECB/Frankfurter) and the PDF renderer (Chromium) live here too. Later: one
 * `ChainDataPort` adapter per wallet network.
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
    {
      provide: UsdPriceSourcePort,
      useFactory: () => new BinanceKlinesSource(),
    },
    { provide: ChfPriceSourcePort, useFactory: () => new CoinGeckoSource() },
    { provide: FxRateSourcePort, useFactory: () => new FrankfurterFxSource() },
    {
      provide: PdfRendererPort,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        new PlaywrightPdfRenderer(
          config.get('PDF_CHROMIUM_PATH', { infer: true }) ?? '',
        ),
    },
    {
      provide: AiCompletionPort,
      useFactory: () => new ProviderSwitchingAiCompletion(),
    },
  ],
  exports: [
    IdentityTokenVerifierPort,
    AiCompletionPort,
    UsdPriceSourcePort,
    ChfPriceSourcePort,
    FxRateSourcePort,
    PdfRendererPort,
  ],
})
export class IntegrationsModule {}
