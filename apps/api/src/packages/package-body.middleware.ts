import {
  BadRequestException,
  Injectable,
  type NestMiddleware,
  PayloadTooLargeException,
} from '@nestjs/common';
import { raw, type NextFunction, type Request, type Response } from 'express';
import { PACKAGE_LIMITS } from './domain/package-format';

const parse = raw({ type: () => true, limit: PACKAGE_LIMITS.maxPackageBytes });

/** Reads a package import as raw bytes (`req.body: Buffer`), up to the package limit. */
@Injectable()
export class PackageBodyMiddleware implements NestMiddleware {
  use(request: Request, response: Response, next: NextFunction): void {
    parse(request, response, (error?: unknown) => {
      if (!error) return next();
      const status = (error as { status?: number }).status;
      if (status === 413) {
        return next(
          new PayloadTooLargeException(
            `The package is larger than ${PACKAGE_LIMITS.maxPackageBytes / 1024 / 1024} MB`,
          ),
        );
      }
      return next(new BadRequestException('The package could not be read'));
    });
  }
}
