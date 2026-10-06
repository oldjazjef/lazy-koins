import type { INestApplication } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { apiReference } from '@scalar/nestjs-api-reference';
import type { Env } from '../config/env';
import { BEARER_SCHEME } from './security-schemes';

/** Machine-readable document. Also the input for generating frontend API types. */
export const OPENAPI_JSON_PATH = 'api/openapi.json';

/** Interactive reference, rendered by Scalar. */
export const OPENAPI_REFERENCE_PATH = 'api/reference';

interface JsonResponse {
  json(body: unknown): unknown;
}

/**
 * Builds the OpenAPI document and serves it as JSON and as the Scalar reference. No Swagger UI.
 *
 * Only a bearer scheme: tokens come from Firebase, which has no authorization-code endpoint
 * Scalar could drive. With `AUTH_MODE=dev`, paste `dev:anna@lazykoins.dev` as the token; with `AUTH_MODE=local` no
 * token is needed at all.
 */
export function setupOpenApi(
  app: INestApplication,
  config: ConfigService<Env, true>,
): void {
  const authMode = config.get('AUTH_MODE', { infer: true });

  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('lazy-koins API')
      .setDescription(
        [
          'Crypto tax statements for one tax year: projects, files, bookings, checks, exports.',
          '',
          'Quantities, rates and CHF amounts are decimal strings, never JSON numbers. Timestamps are ISO 8601 UTC.',
        ].join('\n'),
      )
      .setVersion('0.1.0')
      .addServer(config.get('PUBLIC_API_URL', { infer: true }))
      .addBearerAuth(
        {
          type: 'http',
          scheme: 'bearer',
          description:
            authMode === 'dev'
              ? 'AUTH_MODE=dev: use `dev:<email>`, e.g. `dev:anna@lazykoins.dev`.'
              : authMode === 'local'
                ? 'AUTH_MODE=local: no token needed, every request is the local user.'
                : 'A Firebase Authentication ID token.',
        },
        BEARER_SCHEME,
      )
      .build(),
    {
      operationIdFactory: (controllerKey, methodKey) =>
        `${controllerKey}_${methodKey}`,
    },
  );

  app.use(`/${OPENAPI_JSON_PATH}`, (_req: unknown, res: JsonResponse) => {
    res.json(document);
  });

  app.use(
    `/${OPENAPI_REFERENCE_PATH}`,
    apiReference({
      // Scalar renders client-side from jsDelivr; set `cdn` to a self-hosted copy if blocked.
      url: `/${OPENAPI_JSON_PATH}`,
      pageTitle: 'lazy-koins API',
      authentication: { preferredSecurityScheme: BEARER_SCHEME },
    }),
  );
}
