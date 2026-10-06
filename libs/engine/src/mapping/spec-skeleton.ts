import { normaliseHeader } from '../importers/table';
import type { DateFormat } from '../importers/text/timestamps';
import {
  MAPPING_FORMAT,
  MAPPING_VERSION,
  type MappingSpecInput,
} from './mapping-spec';
import type { MappingSample } from './sample';

/**
 * "Vorlage aus Datei": a mapping spec **skeleton** from a sample file — the header row as the
 * fingerprint, the columns that look like timestamp / asset / quantity / fee / kind / account
 * pre-selected, and one kind rule per distinct value of the kind column, every one `unknown` for
 * the user to classify. A starting point, never a finished mapping: a role without a fitting
 * column stays `""`, so validation names exactly what is still missing. Pure and deterministic
 * (header names and a few cell texts in, JSON out) — no platform knowledge.
 */

/** The parts of a spec the skeleton pre-selects a column for. */
export const SKELETON_ROLES = [
  'timestamp',
  'asset',
  'quantity',
  'inColumn',
  'outColumn',
  'fee',
  'feeAsset',
  'kind',
  'account',
  'group',
  'note',
] as const;
export type SkeletonRole = (typeof SKELETON_ROLES)[number];

/** Role → the header as written in the file (absent = no fitting column found). */
export type ColumnSuggestions = Partial<Record<SkeletonRole, string>>;

export interface SkeletonSource {
  readonly fileName: string;
  readonly fileKind: 'csv' | 'xlsx';
  /** XLSX: the sheet the header is on. */
  readonly sheet?: string;
  /** CSV: the delimiter (fixed in the spec — a preamble can fool the detection). */
  readonly delimiter?: string;
  /** The header row's cells as written. */
  readonly headers: readonly string[];
  /** A few data rows below the header, aligned with `headers` (format guesses only). */
  readonly rows: readonly (readonly string[])[];
  /** Category-like columns and their values (`MappingSample.distinctValues`). */
  readonly distinctValues: MappingSample['distinctValues'];
}

/** Normalised header fragments per role, most specific first. */
const ROLE_PATTERNS: Readonly<Record<SkeletonRole, readonly RegExp[]>> = {
  timestamp: [
    /^(utc)?(time|date|datetime|timestamp|zeitpunkt|datum|zeit)(utc)?$/,
    /(timestamp|datetime|zeitpunkt)/,
    /(date|time|datum|zeit)/,
  ],
  asset: [
    /^(asset|coin|currency|symbol|token|ccy|waehrung|währung)$/,
    /(asset|coin|currency|symbol|token|waehrung|währung)/,
  ],
  quantity: [
    /^(amount|quantity|change|qty|menge|betrag|anzahl|volume)$/,
    /(amount|quantity|change|qty|menge|betrag|anzahl)/,
  ],
  inColumn: [
    /^(in|incoming|received|receivedquantity|receivedamount|credit|eingang|gutschrift)$/,
  ],
  outColumn: [
    /^(out|outgoing|sent|sentquantity|sentamount|debit|ausgang|belastung)$/,
  ],
  fee: [
    /^(fee|fees|gebühr|gebühren|gebuehr|gebuehren|commission)$/,
    /(fee|gebühr|gebuehr)/,
  ],
  feeAsset: [
    /(fee|gebühr|gebuehr)(asset|currency|coin|symbol|ccy|waehrung|währung)/,
  ],
  kind: [
    /^(type|operation|kind|transactiontype|txtype|art|typ|action|category|kategorie|side)$/,
    /(type|operation|kategorie|category)$/,
    /^(description|beschreibung)$/,
  ],
  account: [
    /^(account|wallet|konto|subaccount|portfolio)$/,
    /(wallet|account|konto)$/,
  ],
  group: [/^(refid|reference|referenz|orderid|tradeid|groupid)$/],
  note: [/^(remark|note|notes|notiz|comment|kommentar|memo)$/],
};

/** Words that disqualify a header from a role (a USD value is not the quantity). */
const ROLE_EXCLUDES: Partial<Record<SkeletonRole, RegExp>> = {
  asset: /(fee|gebühr|gebuehr|quote|base|price)/,
  quantity:
    /(fee|gebühr|gebuehr|usd|eur|chf|price|preis|value|wert|balance|saldo|total)/,
  fee: /(asset|currency|coin|symbol|ccy|waehrung|währung|usd|eur|value|wert)/,
  timestamp: /(update|expir)/,
};

/** Order in which roles claim columns: a column serves one role only. */
const CLAIM_ORDER: readonly SkeletonRole[] = [
  'feeAsset',
  'fee',
  'timestamp',
  'asset',
  'inColumn',
  'outColumn',
  'quantity',
  'account',
  'group',
  'kind',
  'note',
];

/** The column best fitting each role, from the header names (and which columns are categories). */
export function suggestColumns(
  headers: readonly string[],
  distinctValues: MappingSample['distinctValues'] = [],
): ColumnSuggestions {
  const cells = headers
    .map((header) => header.trim())
    .filter((header) => header !== '');
  const categories = new Set(
    distinctValues.map((entry) => normaliseHeader(entry.column)),
  );
  const taken = new Set<string>();
  const suggestions: ColumnSuggestions = {};
  for (const role of CLAIM_ORDER) {
    const column = bestColumn(role, cells, taken, categories);
    if (column !== undefined) {
      suggestions[role] = column;
      taken.add(column);
    }
  }
  return suggestions;
}

function bestColumn(
  role: SkeletonRole,
  cells: readonly string[],
  taken: ReadonlySet<string>,
  categories: ReadonlySet<string>,
): string | undefined {
  const exclude = ROLE_EXCLUDES[role];
  const patterns = ROLE_PATTERNS[role];
  for (const [index, pattern] of patterns.entries()) {
    const fitting = cells.filter((cell) => {
      if (taken.has(cell)) return false;
      const name = normaliseHeader(cell);
      return pattern.test(name) && !(exclude?.test(name) ?? false);
    });
    if (fitting.length === 0) continue;
    if (role !== 'kind') return fitting[0];
    // The kind decides on categories: a column with a short list of values wins; a free-text
    // column (the last pattern, "Description") only when its values repeat.
    const category = fitting.find((cell) =>
      categories.has(normaliseHeader(cell)),
    );
    if (category !== undefined) return category;
    if (index < patterns.length - 1) return fitting[0];
  }
  return undefined;
}

/** The date format of a column from a few of its cells; `ymd` when nothing decides. */
export function guessDateFormat(values: readonly string[]): DateFormat {
  const cells = values.map((value) => value.trim()).filter((v) => v !== '');
  if (cells.length === 0) return 'ymd';
  if (cells.every((cell) => /^\d{13}$/.test(cell))) return 'unixMs';
  if (cells.every((cell) => /^\d{9,10}(\.\d+)?$/.test(cell))) return 'unix';
  if (cells.every((cell) => /^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}/.test(cell))) {
    return 'ymd';
  }
  if (cells.every((cell) => /^[A-Za-z]{3,}\.? \d{1,2},? \d{4}/.test(cell))) {
    return 'named';
  }
  const dayFirst = cells.map((cell) =>
    /^(\d{1,2})([./-])(\d{1,2})\2\d{2,4}/.exec(cell),
  );
  if (dayFirst.every((match) => match !== null)) {
    const slashes = dayFirst.every((match) => match?.[2] === '/');
    if (dayFirst.some((match) => Number(match?.[1]) > 12)) return 'dmy';
    if (dayFirst.some((match) => Number(match?.[3]) > 12)) return 'mdy';
    // `3/1/2025 1:00:00 PM` is the US export; dots and dashes are European.
    if (slashes && cells.some((cell) => /\b[AP]M\b/i.test(cell))) return 'mdy';
    return 'dmy';
  }
  return 'ymd';
}

/** How the numbers of a column are written, from a few of its cells. */
export function guessNumbers(values: readonly string[]): {
  decimal: '.' | ',';
  thousands: string[];
  stripText: boolean;
} {
  const cells = values.map((value) => value.trim()).filter((v) => v !== '');
  const stripText = cells.some((cell) => /[A-Za-z$€£]/.test(cell));
  const digits = cells.map((cell) => cell.replace(/[^\d.,'’]/g, ''));
  let comma = 0;
  let dot = 0;
  for (const cell of digits) {
    const lastComma = cell.lastIndexOf(',');
    const lastDot = cell.lastIndexOf('.');
    if (lastComma >= 0 && lastDot >= 0) {
      if (lastComma > lastDot) comma += 1;
      else dot += 1;
    } else if (lastComma >= 0) {
      // `1,234` reads as a thousands group; `0,5` and `0,00500000` as a decimal comma.
      if (!/^\d{1,3}(,\d{3})+$/.test(cell)) comma += 1;
    } else if (lastDot >= 0) {
      if (!/^\d{1,3}(\.\d{3}){2,}$/.test(cell)) dot += 1;
    }
  }
  const decimal = comma > dot ? ',' : '.';
  const group = decimal === '.' ? ',' : '.';
  const thousands = digits.some((cell) => cell.includes(group)) ? [group] : [];
  for (const mark of ["'", '’']) {
    if (digits.some((cell) => cell.includes(mark))) thousands.push(mark);
  }
  return { decimal, thousands, stripText };
}
/** A platform name the schema accepts, from the first word of the file name (may be empty). */
export function platformFromFileName(fileName: string): string {
  const first = fileName
    .replace(/\.[^.]+$/, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .find((part) => /^[a-z]/.test(part));
  return (first ?? '').slice(0, 40);
}

function columnValues(
  source: SkeletonSource,
  column: string | undefined,
): string[] {
  if (column === undefined) return [];
  const index = source.headers.findIndex((header) => header.trim() === column);
  if (index < 0) return [];
  return source.rows.map((row) => row[index] ?? '').slice(0, 20);
}

/**
 * The skeleton for a sample file. Every kind value becomes a rule with kind `unknown`: the user
 * decides what a "Staking Reward" is (F7.2), the skeleton never guesses tax meaning.
 */
export function specSkeleton(source: SkeletonSource): MappingSpecInput {
  const headers = [
    ...new Set(
      source.headers.map((header) => header.trim()).filter((h) => h !== ''),
    ),
  ];
  const columns = suggestColumns(headers, source.distinctValues);
  const kindValues =
    source.distinctValues.find((entry) => entry.column === columns.kind)
      ?.values ?? [];

  const amountColumn = columns.quantity ?? columns.inColumn;
  const numbers = guessNumbers([
    ...columnValues(source, amountColumn),
    ...columnValues(source, columns.fee),
  ]);
  const quantity: NonNullable<MappingSpecInput['bookings']>['quantity'] =
    columns.quantity === undefined &&
    columns.inColumn !== undefined &&
    columns.outColumn !== undefined
      ? {
          mode: 'inOut',
          inColumn: columns.inColumn,
          outColumn: columns.outColumn,
        }
      : { mode: 'signed', column: columns.quantity ?? '' };

  const name = source.fileName.replace(/\.[^.]+$/, '').trim();
  return {
    format: MAPPING_FORMAT,
    version: MAPPING_VERSION,
    name: name === '' ? 'Neues Mapping' : name.slice(0, 120),
    platform: platformFromFileName(source.fileName),
    match: { headers },
    source:
      source.fileKind === 'csv'
        ? {
            encoding: 'auto',
            ...(isDelimiter(source.delimiter)
              ? { delimiter: source.delimiter }
              : {}),
          }
        : {
            encoding: 'auto',
            ...(source.sheet !== undefined ? { sheet: source.sheet } : {}),
          },
    ...(numbers.decimal !== '.' ||
    numbers.thousands.length > 0 ||
    numbers.stripText
      ? { numbers }
      : {}),
    bookings: {
      timestamp: {
        column: columns.timestamp ?? '',
        format: guessDateFormat(columnValues(source, columns.timestamp)),
        timeZone: 'UTC',
      },
      account:
        columns.account !== undefined
          ? { column: columns.account, value: 'main' }
          : { value: 'main' },
      asset: { column: columns.asset ?? '' },
      quantity,
      ...(columns.fee !== undefined
        ? {
            fee: {
              column: columns.fee,
              ...(columns.feeAsset !== undefined
                ? { assetColumn: columns.feeAsset }
                : {}),
            },
          }
        : {}),
      kind: {
        columns: [columns.kind ?? ''],
        rules: kindValues.map((value) => ({
          equals: [value],
          kind: 'unknown' as const,
        })),
        default: 'unknown',
      },
      ...(columns.group !== undefined
        ? { group: { column: columns.group } }
        : {}),
      ...(columns.note !== undefined ? { note: { column: columns.note } } : {}),
    },
  };
}

function isDelimiter(
  value: string | undefined,
): value is ',' | ';' | '\t' | '|' {
  return value === ',' || value === ';' || value === '\t' || value === '|';
}
