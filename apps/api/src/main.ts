import 'reflect-metadata';

import { Logger, ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app/app.module';
import { apiDocsEnabled, type Env, LOCAL_HOST } from './config/env';
import { OPENAPI_REFERENCE_PATH, setupOpenApi } from './openapi/setup-openapi';

const GLOBAL_PREFIX = 'api';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const config = app.get(ConfigService<Env, true>);
  const logger = new Logger('Bootstrap');

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
  app.enableShutdownHooks();

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

  const port = config.get('PORT', { infer: true });
  const authMode = config.get('AUTH_MODE', { infer: true });
  // AUTH_MODE=local trusts every request, so it must never be reachable from another machine:
  // loopback only. Every other mode listens on all interfaces (containers need that).
  if (authMode === 'local') {
    await app.listen(port, LOCAL_HOST);
  } else {
    await app.listen(port);
  }

  logger.log(`API listening on http://localhost:${port}/${GLOBAL_PREFIX}`);
  if (docs) {
    logger.log(
      `API reference on http://localhost:${port}/${OPENAPI_REFERENCE_PATH}`,
    );
  }
  logger.log(`Auth mode: ${authMode}`);
}

void bootstrap();
