import { createWriteStream } from 'node:fs';
import { mkdtemp, open, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { EstvExport } from '../../../rates/domain/estv';
import {
  EstvKurslisteSourcePort,
  type EstvProgress,
  EstvSourceError,
  type ParsedKursliste,
} from '../../../rates/ports/estv.port';
import { type Fetcher, parseJsonKeepingNumbers } from '../http-rate-client';
import { parseKurslisteStream } from './kursliste-stream-parser';
import { listZipEntries, openZipEntry } from './zip-entry';

/**
 * The ESTV Kursliste from the ICTax API (F7.4a) — the official XML export, no scraping:
 *
 * 1. `GET /extern/api/authentication/session.json` → `data.csrfToken` (sent as `X-CSRF-TOKEN`)
 *    and the session cookies (sent back as `Cookie`);
 * 2. `POST /extern/api/xml/xmls.json` `{from:0,size:100,sort:[],year}` → the exports of the year
 *    (`exportType.shortName`, `exportDate` in ms, `exportFile {id, fileHash, fileName, fileSize}`);
 * 3. `GET /extern/api/download/<id>/<fileHash>/<fileName>` → a ZIP with `kursliste_<year>.xml`.
 *
 * The ZIP is **streamed** to a temporary file (size limit, overall timeout), the XML entry is
 * streamed out of it and **stream-parsed** (`KurslisteStreamParser`) — never held in memory. The
 * temporary directory is removed afterwards. Requests are retried with exponential backoff on
 * network errors, timeouts, 429 and 5xx. Errors carry a code and a message without URLs or
 * tokens. Specs run against a local fake server — never the real API.
 */

export interface IctaxOptions {
  /** `https://www.ictax.admin.ch` (`ESTV_BASE_URL`); a fake server in specs and live checks. */
  readonly baseUrl: string;
  readonly fetcher?: Fetcher;
  /** Largest ZIP accepted (default 250 MB; the 2025 list is ≈ 42 MB). */
  readonly maxZipBytes?: number;
  /** Largest XML accepted (default 2 GB; the 2025 list is ≈ 410 MB). */
  readonly maxXmlBytes?: number;
  /** Per metadata request (default 30 s). */
  readonly requestTimeoutMs?: number;
  /** For the whole download (default 15 min). */
  readonly downloadTimeoutMs?: number;
  /** Attempts per request (default 3) and the first backoff (default 2 s, doubled each time). */
  readonly attempts?: number;
  readonly backoffMs?: number;
  /** Where the temporary ZIP goes (default the OS temp directory). */
  readonly tmpDir?: string;
}

interface Session {
  readonly headers: Record<string, string>;
}

class RetryableError extends EstvSourceError {}

function retryable(status: number): boolean {
  return status === 429 || status >= 500;
}

function toIso(value: unknown): string | undefined {
  if (typeof value === 'string' && /^\d+$/.test(value)) {
    return new Date(Number(value)).toISOString();
  }
  if (typeof value === 'number') return new Date(value).toISOString();
  if (typeof value === 'string' && !Number.isNaN(Date.parse(value))) {
    return new Date(value).toISOString();
  }
  return undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : {};
}

export class IctaxKurslisteSource extends EstvKurslisteSourcePort {
  private readonly fetcher: Fetcher;
  private readonly baseUrl: string;

  constructor(private readonly options: IctaxOptions) {
    super();
    this.fetcher = options.fetcher ?? ((url, init) => fetch(url, init));
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
  }

  async listExports(year: number): Promise<EstvExport[]> {
    const session = await this.session();
    const body = await this.retry(async () => {
      const response = await this.request(
        `${this.baseUrl}/extern/api/xml/xmls.json`,
        {
          method: 'POST',
          headers: {
            ...session.headers,
            accept: 'application/json',
            'content-type': 'application/json',
          },
          body: JSON.stringify({ from: 0, size: 100, sort: [], year }),
        },
      );
      return response.text();
    });
    let parsed: unknown;
    try {
      parsed = parseJsonKeepingNumbers(body);
    } catch {
      throw new EstvSourceError(
        'badResponse',
        'ICTax: unerwartete Antwort (kein JSON)',
      );
    }
    const root = record(parsed);
    if (root['status'] !== undefined && root['status'] !== 'SUCCESS') {
      throw new EstvSourceError(
        'badResponse',
        `ICTax: Status ${String(root['status']).slice(0, 40)}`,
      );
    }
    const data = Array.isArray(root['data']) ? root['data'] : [];
    const exports: EstvExport[] = [];
    for (const item of data) {
      const entry = record(item);
      const type = record(entry['exportType']);
      const file = record(entry['exportFile']);
      const exportType = text(type['shortName']);
      const exportDate = toIso(entry['exportDate']);
      const fileId = text(String(file['id'] ?? ''));
      const fileHash = text(file['fileHash']);
      const fileName = text(file['fileName']);
      if (entry['deleted'] === true || entry['deleted'] === 'true') continue;
      if (!exportType || !exportDate || !fileId || !fileHash || !fileName)
        continue;
      const size = Number(file['fileSize']);
      exports.push({
        exportType,
        exportDate,
        fileId,
        fileHash,
        fileName,
        fileSize: Number.isFinite(size) && size > 0 ? size : null,
      });
    }
    return exports;
  }

  async fetchKursliste(
    year: number,
    file: EstvExport,
    onProgress?: (progress: EstvProgress) => void,
  ): Promise<ParsedKursliste> {
    const maxZip = this.options.maxZipBytes ?? 250 * 1024 * 1024;
    if (file.fileSize !== null && file.fileSize > maxZip) {
      throw new EstvSourceError(
        'tooLarge',
        `Die Kursliste ist grösser als erlaubt (${file.fileSize} Bytes)`,
      );
    }
    const dir = await mkdtemp(
      join(this.options.tmpDir ?? tmpdir(), 'lk-estv-'),
    );
    try {
      const zipPath = join(dir, 'kursliste.zip');
      await this.retry(async () => {
        const session = await this.session();
        await this.download(file, zipPath, session, maxZip, onProgress);
      });
      return await this.readArchive(year, zipPath, onProgress);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  private async download(
    file: EstvExport,
    zipPath: string,
    session: Session,
    maxZip: number,
    onProgress?: (progress: EstvProgress) => void,
  ): Promise<void> {
    const url = `${this.baseUrl}/extern/api/download/${encodeURIComponent(
      file.fileId,
    )}/${encodeURIComponent(file.fileHash)}/${encodeURIComponent(file.fileName)}`;
    const response = await this.request(
      url,
      { headers: session.headers },
      this.options.downloadTimeoutMs ?? 15 * 60_000,
    );
    if (!response.body) {
      throw new RetryableError('badResponse', 'ICTax: leere Antwort');
    }
    const announced = Number(response.headers.get('content-length'));
    if (Number.isFinite(announced) && announced > maxZip) {
      throw new EstvSourceError(
        'tooLarge',
        `Die Kursliste ist grösser als erlaubt (${announced} Bytes)`,
      );
    }
    const total =
      Number.isFinite(announced) && announced > 0
        ? announced
        : (file.fileSize ?? null);
    let bytes = 0;
    const counter = new Transform({
      transform(chunk: Buffer, _encoding, done) {
        bytes += chunk.length;
        if (bytes > maxZip) {
          done(
            new EstvSourceError(
              'tooLarge',
              `Die Kursliste ist grösser als erlaubt (> ${maxZip} Bytes)`,
            ),
          );
          return;
        }
        onProgress?.({
          phase: 'download',
          bytes,
          totalBytes: total,
          entries: 0,
        });
        done(null, chunk);
      },
    });
    try {
      await pipeline(
        Readable.fromWeb(
          response.body as Parameters<typeof Readable.fromWeb>[0],
        ),
        counter,
        createWriteStream(zipPath),
      );
    } catch (error) {
      if (error instanceof EstvSourceError) throw error;
      if ((error as Error).name === 'TimeoutError') {
        throw new RetryableError(
          'timeout',
          'ICTax: Zeitüberschreitung beim Herunterladen',
        );
      }
      throw new RetryableError(
        'network',
        'ICTax: Verbindung beim Herunterladen abgebrochen',
      );
    }
    const handle = await open(zipPath, 'r');
    try {
      const magic = Buffer.alloc(2);
      await handle.read(magic, 0, 2, 0);
      if (magic.toString('latin1') !== 'PK') {
        throw new EstvSourceError(
          'badArchive',
          'ICTax: die Antwort ist kein ZIP-Archiv',
        );
      }
    } finally {
      await handle.close();
    }
  }

  private async readArchive(
    year: number,
    zipPath: string,
    onProgress?: (progress: EstvProgress) => void,
  ): Promise<ParsedKursliste> {
    const entries = await listZipEntries(zipPath);
    const xmls = entries.filter((e) => e.name.toLowerCase().endsWith('.xml'));
    const entry =
      xmls.find((e) => e.name.split('/').pop() === `kursliste_${year}.xml`) ??
      xmls[0];
    if (!entry) {
      throw new EstvSourceError(
        'badArchive',
        'Im Archiv ist keine Kursliste (XML)',
      );
    }
    const maxXml = this.options.maxXmlBytes ?? 2 * 1024 * 1024 * 1024;
    if (entry.size > maxXml) {
      throw new EstvSourceError(
        'tooLarge',
        `Die Kursliste ist grösser als erlaubt (${entry.size} Bytes)`,
      );
    }
    const stream = await openZipEntry(zipPath, entry);
    let reported = 0;
    const parsed = await parseKurslisteStream(stream, (parser) => {
      if (parser.bytes > maxXml) {
        stream.destroy();
        throw new EstvSourceError(
          'tooLarge',
          `Die Kursliste ist grösser als erlaubt (> ${maxXml} Bytes)`,
        );
      }
      if (
        parser.bytes - reported >= 1024 * 1024 ||
        parser.bytes === entry.size
      ) {
        reported = parser.bytes;
        onProgress?.({
          phase: 'parse',
          bytes: parser.bytes,
          totalBytes: entry.size || null,
          entries: parser.entries,
        });
      }
    }).catch((error: unknown) => {
      stream.destroy();
      if (error instanceof EstvSourceError) throw error;
      throw new EstvSourceError(
        'badArchive',
        'Die Kursliste konnte nicht entpackt werden',
      );
    });
    if (parsed.year !== year) {
      throw new EstvSourceError(
        'badXml',
        `Die Kursliste ist für ${parsed.year}, nicht ${year}`,
      );
    }
    return parsed;
  }

  /** A fresh ICTax session: the CSRF token and the cookies (continues without, like a browser). */
  private async session(): Promise<Session> {
    const response = await this.retry(() =>
      this.request(`${this.baseUrl}/extern/api/authentication/session.json`, {
        headers: { accept: 'application/json' },
      }),
    );
    const cookies = response.headers
      .getSetCookie()
      .map((c) => c.split(';')[0]?.trim() ?? '')
      .filter((c) => c.includes('='));
    let token: string | undefined;
    try {
      token = text(record(record(await response.json())['data'])['csrfToken']);
    } catch {
      token = undefined;
    }
    return {
      headers: {
        ...(token ? { 'X-CSRF-TOKEN': token } : {}),
        ...(cookies.length > 0 ? { cookie: cookies.join('; ') } : {}),
      },
    };
  }

  /** One request with a timeout; HTTP errors become `EstvSourceError` (retryable: 429/5xx). */
  private async request(
    url: string,
    init: RequestInit,
    timeoutMs = this.options.requestTimeoutMs ?? 30_000,
  ): Promise<Response> {
    let response: Response;
    try {
      response = await this.fetcher(url, {
        ...init,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      if ((error as Error).name === 'TimeoutError') {
        throw new RetryableError('timeout', 'ICTax: Zeitüberschreitung');
      }
      throw new RetryableError('network', 'ICTax: nicht erreichbar');
    }
    if (response.status === 404) {
      throw new EstvSourceError('notFound', 'ICTax: nicht gefunden (404)');
    }
    if (!response.ok) {
      const ErrorType = retryable(response.status)
        ? RetryableError
        : EstvSourceError;
      throw new ErrorType('http', `ICTax: HTTP ${response.status}`);
    }
    return response;
  }

  private async retry<T>(work: () => Promise<T>): Promise<T> {
    const attempts = Math.max(1, this.options.attempts ?? 3);
    let wait = this.options.backoffMs ?? 2_000;
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await work();
      } catch (error) {
        if (!(error instanceof RetryableError) || attempt >= attempts) {
          if (error instanceof RetryableError) {
            throw new EstvSourceError(error.code, error.message);
          }
          throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, wait));
        wait *= 2;
      }
    }
  }
}
