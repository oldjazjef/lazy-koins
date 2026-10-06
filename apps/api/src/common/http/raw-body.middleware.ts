import {
  BadRequestException,
  Injectable,
  type NestMiddleware,
  PayloadTooLargeException,
} from '@nestjs/common';
import { raw, type NextFunction, type Request, type Response } from 'express';
import { MAX_FILE_BYTES } from '../../files/domain/project-file';

const parse = raw({ type: () => true, limit: MAX_FILE_BYTES });

/**
 * Reads the request body as raw bytes (`req.body: Buffer`) for file uploads — one file per
 * request, its name in the query. Body-parser's own errors become Nest exceptions, so an
 * oversized upload is a 413 with the usual error body, not a 500.
 */
@Injectable()
export class RawBodyMiddleware implements NestMiddleware {
  use(request: Request, response: Response, next: NextFunction): void {
    parse(request, response, (error?: unknown) => {
      if (!error) return next();
      const status = (error as { status?: number }).status;
      if (status === 413) {
        return next(
          new PayloadTooLargeException(
            `The file is larger than ${MAX_FILE_BYTES / 1024 / 1024} MB`,
          ),
        );
      }
      return next(new BadRequestException('The upload could not be read'));
    });
  }
}

/** `attachment; filename="…"; filename*=UTF-8''…` — RFC 6266 with an ASCII fallback. */
export function contentDisposition(
  name: string,
  type: 'attachment' | 'inline' = 'attachment',
): string {
  const fallback = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  const encoded = encodeURIComponent(name).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `${type}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}
