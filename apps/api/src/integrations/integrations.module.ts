import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IdentityTokenVerifierPort } from '../auth/ports/identity-token-verifier.port';
import type { Env } from '../config/env';
import { PdfRendererPort } from '../exports/ports/project-export.repository.port';
import {
  FiatPriceSourcePort,
  FxRateSourcePort,
  UsdPriceSourcePort,
} from '../rates/ports/rate-source.port';
import { ChainDataSourcesPort } from '../wallets/ports/chain-data.port';
import { EstvKurslisteSourcePort } from '../rates/ports/estv.port';
import { AiCompletionPort } from './ai/ai-completion.port';
import { ChainSources } from './chains/chain-sources';
import { ProviderSwitchingAiCompletion } from './ai/provider-switching.adapter';
import { DevIdentityTokenVerifier } from './dev-identity-token.verifier';
import { FirebaseIdentityTokenVerifier } from './firebase/firebase-identity-token.verifier';
import { HttpRemoteLibrary } from './library/http-remote-library.adapter';
import { RemoteLibraryPort } from './library/remote-library.port';
import { LocalIdentityVerifier } from './local-identity.verifier';
import { MailTransportPort } from './mail/mail-transport.port';
import { NodemailerTransport } from './mail/nodemailer.transport';
import { registeredHostPdfPrinter } from './pdf/host-pdf.renderer';
import { selectPdfRenderer } from './pdf/select-pdf-renderer';
import { BinanceKlinesSource } from './rates/binance-klines.source';
import { CoinGeckoSource } from './rates/coingecko.source';
import { FrankfurterFxSource } from './rates/frankfurter-fx.source';
import { IctaxKurslisteSource } from './rates/ictax/ictax-kursliste.source';
import { PriceHistorySourcesPort } from './rates/price-history/price-history-source.port';
import { PriceHistorySources } from './rates/price-history/price-history-sources';

/**
 * External services behind ports, the counterpart of `PersistenceModule` for everything that is
 * not the database. The only place that decides *which* adapter backs a port — and the only code
 * that imports firebase-admin. The AI plugin's `AiCompletionPort` (F5.13) dispatches per call to
 * the OpenAI-compatible or the Anthropic adapter, from the user's settings. Rate sources
 * (Binance, CoinGecko, ECB/Frankfurter; the selectable price-history adapters behind
 * `PriceHistorySourcesPort`, not wired yet) and the PDF renderer (Chromium) live here too, and so does
 * the mailer (`MailTransportPort` → nodemailer, F11.10). Later: one `ChainDataPort` adapter per
 * wallet network.
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
    { provide: FiatPriceSourcePort, useFactory: () => new CoinGeckoSource() },
    { provide: FxRateSourcePort, useFactory: () => new FrankfurterFxSource() },
    {
      // Price sources phase 1: the adapters exist and are injectable; no handler uses them yet.
      provide: PriceHistorySourcesPort,
      useFactory: () => PriceHistorySources.real(),
    },
    {
      provide: EstvKurslisteSourcePort,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        new IctaxKurslisteSource({
          baseUrl:
            config.get('ESTV_BASE_URL', { infer: true }) ??
            'https://www.ictax.admin.ch',
        }),
    },
    {
      provide: PdfRendererPort,
      inject: [ConfigService],
      // Desktop: Electron's printToPDF (registered by bootstrap); server: Playwright Chromium.
      useFactory: (config: ConfigService<Env, true>) =>
        selectPdfRenderer({
          hostPrinter: registeredHostPdfPrinter(),
          chromiumPath: config.get('PDF_CHROMIUM_PATH', { infer: true }) ?? '',
        }),
    },
    {
      provide: AiCompletionPort,
      useFactory: () => new ProviderSwitchingAiCompletion(),
    },
    {
      // F6.3/F6.4: one adapter per network family; synthetic chains with LK_CHAINS_FAKE=1.
      provide: ChainDataSourcesPort,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        config.get('LK_CHAINS_FAKE', { infer: true }) === '1'
          ? ChainSources.fake()
          : ChainSources.real(),
    },
    { provide: MailTransportPort, useFactory: () => new NodemailerTransport() },
    // F5.18: a web deployment's public mapping library, read by the desktop app. `useFactory`:
    // the adapter's defaulted `fetchImpl` parameter cannot be resolved by DI.
    { provide: RemoteLibraryPort, useFactory: () => new HttpRemoteLibrary() },
  ],
  exports: [
    IdentityTokenVerifierPort,
    AiCompletionPort,
    UsdPriceSourcePort,
    FiatPriceSourcePort,
    FxRateSourcePort,
    PriceHistorySourcesPort,
    EstvKurslisteSourcePort,
    PdfRendererPort,
    ChainDataSourcesPort,
    MailTransportPort,
    RemoteLibraryPort,
  ],
})
export class IntegrationsModule {}
