import { NotFoundException } from '@nestjs/common';

/**
 * Whether the mapping library exists in this deployment, and its clock (F5.15).
 *
 * The library is shared by every user of one deployment — that only makes sense on the **web**
 * (`AUTH_MODE=firebase|dev`). The desktop app (`AUTH_MODE=local`) has one user and no shared
 * database: there every library route and tool answers 404, and the tools are not registered.
 */
export class LibraryRuntime {
  constructor(
    readonly enabled: boolean,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  /** 404 when the library is off — the same answer as a route that does not exist. */
  assertEnabled(): void {
    if (!this.enabled) {
      throw new NotFoundException(
        'The mapping library exists only in the web app',
      );
    }
  }

  now(): Date {
    return this.clock();
  }
}
