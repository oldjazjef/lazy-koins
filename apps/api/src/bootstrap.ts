import 'reflect-metadata';

import { timingSafeEqual } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import {
  type INestApplication,
  Logger,
  type LoggerService,
  type LogLevel,
  ValidationPipe,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import { AppModule } from './app/app.module';
import { apiDocsEnabled, type Env, LOCAL_HOST } from './config/env';
import { OPENAPI_REFERENCE_PATH, setupOpenApi } from './openapi/setup-openapi';

const GLOBAL_PREFIX = 'api';

/** The header the desktop shell adds to every request when it passes `accessToken`. */
export const DESKTOP_ACCESS_HEADER = 'x-lazykoins-desktop';

/**
 * Overrides for one process. The server (`main.ts`) passes none and gets exactly the behaviour
 * the environment describes; the desktop app (`apps/desktop`) runs the API in its own process
 * and needs a few knobs the environment cannot express.
 */
export interface BootstrapOptions {
  /** Port to listen on instead of `PORT`. `0` = a free port chosen by the OS (desktop). */
  port?: number;
  /**
   * Register Nest's SIGTERM/SIGINT hooks (default `true`). The desktop app closes the API itself
   * on quit; Nest's hooks would re-raise the signal and kill Electron's main process.
   */
  shutdownHooks?: boolean;
  /**
   * When set, every request must carry this value in `x-lazykoins-desktop`, or it gets a 403.
   * `AUTH_MODE=local` trusts every request, and loopback is reachable by every other program
   * and every web page on the machine — this per-launch secret, known only to the desktop
   * shell that proxies the window's requests, closes that door.
   */
  accessToken?: string;
  /** Nest logger setting (default: Nest's console logger). */
  logger?: LoggerService | LogLevel[] | false;
}

export interface RunningApi {
  app: INestApplication;
  /** The port actually bound (the OS's choice when `port: 0`). */
  port: number;
  /** The address it listens on (`127.0.0.1` in local mode). */
  host: string;
}

/**
 * Creates, configures and starts the API. Shared by the server entry point (`main.ts`) and the
 * desktop app, which imports this from its own bundle (`apps/api/webpack.desktop.config.js`).
 */
export async function bootstrap(
  options: BootstrapOptions = {},
): Promise<RunningApi> {
  const app = await NestFactory.create<NestExpressApplication>(
    AppModule,
    options.logger === undefined ? {} : { logger: options.logger },
  );
  const config = app.get(ConfigService<Env, true>);
  const logger = new Logger('Bootstrap');

  if (options.accessToken !== undefined) {
    app.use(requireAccessToken(options.accessToken));
  }

  app.setGlobalPrefix(GLOBAL_PREFIX);

  const docs = apiDocsEnabled({
    API_DOCS: config.get('API_DOCS', { infer: true }),
    NODE_ENV: config.get('NODE_ENV', { infer: true }),
  });
  // Security headers on every API response. The Scalar reference loads its script from a CDN,
  // which a strict CSP would block — so the CSP is on whenever the reference is off (production).
  app.use(helmet({ contentSecurityPolicy: docs ? false : undefined }));

  // Without this, `onApplicationShutdown` never runs and the database file stays open past
  // SIGTERM.
  if (options.shutdownHooks ?? true) app.enableShutdownHooks();

  app.useGlobalPipes(
    new ValidationPipe({
      // Reject unknown properties rather than strip them: a client sending a field this version
      // does not know most likely has a bug or a stale contract.
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.enableCors({
    origin: config
      .get('CORS_ORIGINS', { infer: true })
      .split(',')
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0),
    credentials: false,
  });

  // How many reverse proxies sit in front of this process. Express then takes the client address
  // from X-Forwarded-For, so the rate limiter keys on visitors instead of on the proxy — with the
  // wrong number, everybody shares one bucket (too few) or clients can forge their address (too
  // many). A count, never `true`.
  const proxyHops = config.get('TRUST_PROXY_HOPS', { infer: true });
  if (proxyHops > 0) {
    app.getHttpAdapter().getInstance().set('trust proxy', proxyHops);
  }

  // Off in production unless API_DOCS=true: the reference runs third-party script on the API's
  // origin, and the document is a map of every endpoint.
  if (docs) setupOpenApi(app, config);

  const port: number = options.port ?? config.get('PORT', { infer: true });
  const authMode = config.get('AUTH_MODE', { infer: true });
  // AUTH_MODE=local trusts every request, so it must never be reachable from another machine:
  // loopback only. Every other mode listens on all interfaces (containers need that).
  if (authMode === 'local') {
    await app.listen(port, LOCAL_HOST);
  } else {
    await app.listen(port);
  }

  const address = app.getHttpServer().address() as AddressInfo;
  logger.log(
    `API listening on http://localhost:${address.port}/${GLOBAL_PREFIX}`,
  );
  if (docs) {
    logger.log(
      `API reference on http://localhost:${address.port}/${OPENAPI_REFERENCE_PATH}`,
    );
  }
  logger.log(`Auth mode: ${authMode}`);

  return { app, port: address.port, host: address.address };
}

/** Express middleware: 403 unless the request carries the expected desktop access token. */
export function requireAccessToken(
  expected: string,
): (request: Request, response: Response, next: NextFunction) => void {
  const expectedBytes = Buffer.from(expected, 'utf8');
  return (request, response, next) => {
    const given = request.headers[DESKTOP_ACCESS_HEADER];
    const givenBytes = Buffer.from(
      typeof given === 'string' ? given : '',
      'utf8',
    );
    if (
      givenBytes.length === expectedBytes.length &&
      timingSafeEqual(givenBytes, expectedBytes)
    ) {
      next();
      return;
    }
    response.status(403).json({ statusCode: 403, message: 'Forbidden' });
  };
}
