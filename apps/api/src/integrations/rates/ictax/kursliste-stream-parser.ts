import { StringDecoder } from 'node:string_decoder';
import { tryParseDecimal } from '@lazykoins/engine';
import { SaxesParser, type SaxesTagPlain } from 'saxes';
import type { EstvRate, EstvRateKind } from '../../../rates/domain/estv';
import {
  EstvSourceError,
  type ParsedKursliste,
} from '../../../rates/ports/estv.port';

/**
 * Streaming reader of the ESTV Kursliste XML (ICTax, schema 2.0.0 and 2.2.0 — namespace
 * `http://xmlns.estv.admin.ch/ictax/<v>/kursliste`). The full list is hundreds of MB, so it is fed
 * chunk by chunk to a SAX parser (saxes) and keeps only the year-end values lazy-koins needs:
 *
 * - `<currencyNote securityType="CURRNOTE.TOKEN" securityAppendix="BTC" securityName="Bitcoin"
 *   valorNumber=… denomination="1"><yearend taxValueCHF="…"/></currencyNote>` — cryptocurrencies
 *   (and `CURRNOTE.CURRENCY` currency notes) at 31.12., CHF per `denomination` units;
 * - `<exchangeRateYearEnd currency="USD" year="2025" value="0.79225" denomination="1"/>` — the
 *   year-end exchange rates, CHF per `denomination` units.
 *
 * Elements are matched by their **local name** (any prefix, both namespace versions); deleted
 * entities and values marked `undefined` are skipped. The file is ISO-8859-1 (the declaration
 * says so) or UTF-8. Numbers stay decimal strings (divided with decimal.js).
 */

const NAMESPACE =
  /^http:\/\/xmlns\.estv\.admin\.ch\/ictax\/(\d+\.\d+\.\d+)\/kursliste$/;

function localName(name: string): string {
  const colon = name.indexOf(':');
  return colon < 0 ? name : name.slice(colon + 1);
}

function attr(tag: SaxesTagPlain, name: string): string | undefined {
  const value = tag.attributes[name];
  return typeof value === 'string' && value.trim() !== ''
    ? value.trim()
    : undefined;
}

function isTrue(value: string | undefined): boolean {
  return value === '1' || value === 'true';
}

/** CHF per unit: `value / denomination`, as a plain decimal string; `undefined` if unreadable. */
function perUnit(
  value: string | undefined,
  denomination: string | undefined,
): string | undefined {
  if (value === undefined) return undefined;
  const parsed = tryParseDecimal(value);
  if (!parsed || parsed.isNegative() || parsed.isZero()) return undefined;
  const divisor = tryParseDecimal(denomination ?? '1');
  if (!divisor || divisor.isZero() || divisor.isNegative()) return undefined;
  return parsed.div(divisor).toFixed();
}

interface OpenNote {
  readonly kind: EstvRateKind;
  readonly ictaxId: string | null;
  readonly symbol: string;
  readonly name: string;
  readonly valorNumber: string | null;
  readonly isin: string | null;
  readonly denomination: string | undefined;
  value?: string;
}

export class KurslisteStreamParser {
  private readonly parser = new SaxesParser({ xmlns: false });
  private decoder: StringDecoder | 'latin1' | undefined;
  private head = Buffer.alloc(0);
  private readonly found: EstvRate[] = [];
  private note: OpenNote | undefined;
  private year: number | undefined;
  private schemaVersion: string | undefined;
  private rootSeen = false;
  private failure: Error | undefined;
  /** XML bytes fed so far. */
  bytes = 0;

  constructor() {
    this.parser.on('error', (error) => {
      this.failure ??= error;
    });
    this.parser.on('opentag', (tag) => this.open(tag));
    this.parser.on('closetag', (tag) => this.close(tag));
  }

  /** Year-end values found so far. */
  get entries(): number {
    return this.found.length;
  }

  write(chunk: Buffer): void {
    this.bytes += chunk.length;
    if (this.decoder === undefined) {
      // The encoding comes from the XML declaration in the first bytes.
      this.head = Buffer.concat([this.head, chunk]);
      if (this.head.length < 256) return;
      this.startDecoding();
      return;
    }
    this.feed(chunk);
  }

  end(): ParsedKursliste {
    if (this.decoder === undefined) this.startDecoding();
    if (this.decoder instanceof StringDecoder) {
      const rest = this.decoder.end();
      if (rest) this.parser.write(rest);
    }
    this.parser.close();
    this.throwIfFailed();
    if (!this.rootSeen || this.year === undefined || !this.schemaVersion) {
      throw new EstvSourceError(
        'badXml',
        'Keine ESTV-Kursliste (Wurzelelement kursliste fehlt)',
      );
    }
    return {
      year: this.year,
      schemaVersion: this.schemaVersion,
      rates: this.found,
    };
  }

  private startDecoding(): void {
    const declaration = this.head.subarray(0, 256).toString('latin1');
    const encoding = /encoding\s*=\s*["']([^"']+)["']/i
      .exec(declaration)?.[1]
      ?.toLowerCase();
    this.decoder =
      encoding &&
      /^(iso-8859-1|latin-?1|iso_8859-1|windows-1252|cp1252)$/.test(encoding)
        ? 'latin1'
        : new StringDecoder('utf8');
    const head = this.head;
    this.head = Buffer.alloc(0);
    this.feed(head);
  }

  private feed(chunk: Buffer): void {
    const text =
      this.decoder === 'latin1'
        ? chunk.toString('latin1')
        : (this.decoder as StringDecoder).write(chunk);
    if (text) this.parser.write(text);
    this.throwIfFailed();
  }

  private throwIfFailed(): void {
    if (this.failure) {
      const failure = this.failure;
      if (failure instanceof EstvSourceError) throw failure;
      throw new EstvSourceError(
        'badXml',
        `Die Kursliste ist kein gültiges XML (${failure.message.slice(0, 120)})`,
      );
    }
  }

  private open(tag: SaxesTagPlain): void {
    const name = localName(tag.name);
    if (!this.rootSeen) {
      this.rootSeen = true;
      if (name !== 'kursliste') {
        this.failure = new EstvSourceError(
          'badXml',
          `Keine ESTV-Kursliste (Wurzelelement ${name.slice(0, 40)})`,
        );
        return;
      }
      const namespace = Object.entries(tag.attributes)
        .filter(([key]) => key === 'xmlns' || key.startsWith('xmlns:'))
        .map(([, value]) => NAMESPACE.exec(String(value))?.[1])
        .find((v) => v !== undefined);
      if (!namespace) {
        this.failure = new EstvSourceError(
          'badXml',
          'Unbekannter Namensraum der Kursliste',
        );
        return;
      }
      this.schemaVersion = namespace;
      const year = attr(tag, 'year');
      this.year = year && /^\d{4}$/.test(year) ? Number(year) : undefined;
      return;
    }
    switch (name) {
      case 'currencyNote': {
        if (isTrue(attr(tag, 'deleted'))) return;
        const type = attr(tag, 'securityType') ?? '';
        const symbol =
          attr(tag, 'securityAppendix') ?? attr(tag, 'currency') ?? '';
        if (symbol === '' || type === 'CURRNOTE.CURRYEAR') return;
        this.note = {
          kind: type === 'CURRNOTE.TOKEN' ? 'crypto' : 'currency',
          ictaxId: attr(tag, 'id') ?? null,
          symbol: symbol.toUpperCase(),
          name: attr(tag, 'securityName') ?? symbol,
          valorNumber: attr(tag, 'valorNumber') ?? null,
          isin: attr(tag, 'isin') ?? null,
          denomination: attr(tag, 'denomination'),
        };
        return;
      }
      case 'yearend': {
        const note = this.note;
        if (!note || note.value !== undefined) return;
        if (isTrue(attr(tag, 'undefined')) || isTrue(attr(tag, 'deleted')))
          return;
        note.value = perUnit(attr(tag, 'taxValueCHF'), note.denomination);
        return;
      }
      case 'exchangeRateYearEnd': {
        if (isTrue(attr(tag, 'deleted'))) return;
        const currency = attr(tag, 'currency');
        const value = perUnit(attr(tag, 'value'), attr(tag, 'denomination'));
        if (!currency || value === undefined) return;
        this.found.push({
          kind: 'fx',
          ictaxId: null,
          symbol: currency.toUpperCase(),
          name: currency.toUpperCase(),
          valorNumber: null,
          isin: null,
          value,
        });
        return;
      }
      default:
        return;
    }
  }

  private close(tag: SaxesTagPlain): void {
    if (localName(tag.name) !== 'currencyNote') return;
    const note = this.note;
    this.note = undefined;
    if (!note || note.value === undefined) return;
    this.found.push({
      kind: note.kind,
      ictaxId: note.ictaxId,
      symbol: note.symbol,
      name: note.name,
      valorNumber: note.valorNumber,
      isin: note.isin,
      value: note.value,
    });
  }
}

/** Reads a whole Kursliste from a byte stream (the XML entry of the ZIP). */
export async function parseKurslisteStream(
  source: AsyncIterable<Buffer | Uint8Array | string>,
  onChunk?: (parser: KurslisteStreamParser) => void,
): Promise<ParsedKursliste> {
  const parser = new KurslisteStreamParser();
  for await (const chunk of source) {
    parser.write(
      typeof chunk === 'string'
        ? Buffer.from(chunk, 'utf8')
        : Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength),
    );
    onChunk?.(parser);
  }
  return parser.end();
}
