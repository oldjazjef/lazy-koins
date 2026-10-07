import {
  BadGatewayException,
  HttpException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  RemoteLibraryError,
  type RemoteLibraryErrorCode,
  RemoteLibraryPort,
} from '../../integrations/library/remote-library.port';
import { conflict } from '../../common/http/api-errors';
import { defaultSettings } from '../../settings/domain/user-settings';
import { UserSettingsRepositoryPort } from '../../settings/ports/user-settings.repository.port';
import {
  defaultRemoteLibrarySettings,
  type LibraryStatus,
  type RemoteLibrarySettings,
} from '../domain/remote-library';
import { RemoteLibrarySettingsRepositoryPort } from '../ports/remote-library-settings.repository.port';
import { LibraryRuntime } from './library-runtime';

/** The app's codes for a failed call to the linked server (502 `code`, `errors.api.<code>`). */
const CALL_CODES: Record<
  Exclude<RemoteLibraryErrorCode, 'notFound' | 'offline'>,
  string
> = {
  network: 'libraryNetwork',
  timeout: 'libraryTimeout',
  badResponse: 'libraryBadResponse',
  disabled: 'libraryDisabled',
  rateLimited: 'libraryRateLimited',
};

/**
 * F5.18, desktop: every call to the linked web deployment passes here. The gate decides whether
 * the app may go online for the library at all — an address saved, the link switched on, and
 * F11.3 (the user's online switch and `RATES_ONLINE`) — and turns the adapter's errors into
 * coded answers: 409 `libraryNotConfigured` / `offline`, 404 for an entry that is gone, 502
 * `libraryNetwork | libraryTimeout | libraryBadResponse | libraryDisabled | libraryRateLimited`
 * with a one-line technical `detail` (status or system cause, never a response body).
 */
@Injectable()
export class RemoteLibraryGate {
  constructor(
    private readonly settings: RemoteLibrarySettingsRepositoryPort,
    private readonly userSettings: UserSettingsRepositoryPort,
    readonly remote: RemoteLibraryPort,
    private readonly runtime: LibraryRuntime,
  ) {}

  async settingsOf(userId: string): Promise<RemoteLibrarySettings> {
    return (
      (await this.settings.find(userId)) ?? defaultRemoteLibrarySettings(userId)
    );
  }

  /** F11.3: the operator's switch and the user's. */
  async online(userId: string): Promise<boolean> {
    if (!this.runtime.online) return false;
    const stored = await this.userSettings.find(userId);
    return (stored ?? defaultSettings(userId)).onlineRates;
  }

  /** What the app shows (nav entry, route, files tab, settings page). */
  async status(userId: string): Promise<LibraryStatus> {
    if (!this.runtime.remote) {
      return {
        mode: 'web',
        available: true,
        readOnly: false,
        server: null,
        suggestions: true,
        reason: null,
      };
    }
    const settings = await this.settingsOf(userId);
    const linked = settings.url !== '' && settings.enabled;
    const online = await this.online(userId);
    const available = linked && online;
    return {
      mode: 'remote',
      available,
      readOnly: true,
      server: settings.url === '' ? null : settings.url,
      suggestions: available && settings.suggestions,
      reason: !linked ? 'libraryNotConfigured' : !online ? 'offline' : null,
    };
  }

  /**
   * The linked server's address — or 409 when the app must not go online for the library.
   * `url` = the unsaved form value of "Verbindung testen" (still needs the online switch).
   */
  async server(userId: string, url?: string): Promise<string> {
    const settings = await this.settingsOf(userId);
    const target = url ?? (settings.enabled ? settings.url : '');
    if (target === '') {
      throw conflict(
        'libraryNotConfigured',
        'No mapping library is linked (Einstellungen › Bibliothek)',
      );
    }
    if (!(await this.online(userId))) {
      throw conflict(
        'offline',
        this.runtime.online
          ? 'Online lookups are switched off in the settings'
          : 'Online lookups are switched off (RATES_ONLINE=false)',
      );
    }
    return target;
  }

  /** Runs one call to the server and maps its failure to the app's codes. */
  async call<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      throw remoteFailure(error);
    }
  }
}

/** A failed remote call as the HTTP answer of this API. */
export function remoteFailure(error: unknown): unknown {
  if (!(error instanceof RemoteLibraryError)) return error;
  if (error.code === 'notFound') {
    return new NotFoundException('No such library mapping on the server');
  }
  if (error.code === 'offline') {
    return conflict('offline', 'Online lookups are switched off');
  }
  return new BadGatewayException({
    statusCode: 502,
    error: 'Bad Gateway',
    message: 'The linked mapping library could not be read',
    code: CALL_CODES[error.code],
    ...(error.detail ? { detail: error.detail } : {}),
  });
}

/** 422 `incompatibleSpec`: the entry needs a newer app (unknown keys or a newer spec version). */
export function incompatibleSpec(paths: readonly string[]): HttpException {
  return new UnprocessableEntityException({
    statusCode: 422,
    error: 'Unprocessable Entity',
    message:
      'This library mapping needs a newer version of the app (unknown parts of the mapping format)',
    code: 'incompatibleSpec',
    paths: paths.slice(0, 20),
  });
}
