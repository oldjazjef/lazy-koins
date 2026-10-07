import { NotFoundException } from '@nestjs/common';

export interface LibraryRuntimeOptions {
  /**
   * F5.18: the public, read-only endpoint (`/api/public/library…`) on the web
   * (`LIBRARY_PUBLIC`, default on). Never on the desktop.
   */
  readonly publicEndpoint?: boolean;
  /** `RATES_ONLINE=false` keeps the API offline for every user (F11.3) — also for the library. */
  readonly online?: boolean;
}

/**
 * Whether the mapping library exists in this deployment, in which form, and its clock (F5.15).
 *
 * The library is shared by every user of one deployment — that only makes sense on the **web**
 * (`AUTH_MODE=firebase|dev`): `enabled`, mode `web`. The desktop app (`AUTH_MODE=local`) has one
 * user and no shared database: mode `remote` (F5.18) — it may be linked to a web deployment's
 * public library and then searches, shows and takes from it, read-only. Publishing, reviews,
 * ratings and deletions stay 404 there, and only the three reading/taking tools are registered.
 */
export class LibraryRuntime {
  constructor(
    readonly enabled: boolean,
    private readonly clock: () => Date = () => new Date(),
    private readonly options: LibraryRuntimeOptions = {},
  ) {}

  get mode(): 'web' | 'remote' {
    return this.enabled ? 'web' : 'remote';
  }

  /** The desktop: reads go to a linked web deployment. */
  get remote(): boolean {
    return !this.enabled;
  }

  /** F5.18: the public endpoint answers (web + `LIBRARY_PUBLIC` not `false`). */
  get publicEnabled(): boolean {
    return this.enabled && (this.options.publicEndpoint ?? true);
  }

  /** `RATES_ONLINE` (F11.3). */
  get online(): boolean {
    return this.options.online ?? true;
  }

  /** 404 when this deployment has no library of its own — the answer of a missing route. */
  assertEnabled(): void {
    if (!this.enabled) {
      throw new NotFoundException(
        'The mapping library exists only in the web app',
      );
    }
  }

  /** 404 unless this is the desktop (remote mode). */
  assertRemote(): void {
    if (this.enabled) {
      throw new NotFoundException('Not found');
    }
  }

  /** 404 unless the public endpoint is on. */
  assertPublic(): void {
    if (!this.publicEnabled) {
      throw new NotFoundException('Not found');
    }
  }

  now(): Date {
    return this.clock();
  }
}
