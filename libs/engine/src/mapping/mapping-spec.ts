import { z } from 'zod';
import { BOOKING_KINDS } from '../bookings/booking';
import { DATE_FORMATS, isKnownZone } from '../importers/text/timestamps';

/**
 * A **mapping spec**: declarative JSON that turns any tabular export (CSV/XLSX) into records of
 * the standard format "lazy-koins Buchungen v1". There is no per-platform code — a platform is
 * supported by a spec, written by hand or (next phase) by an LLM from the file's header and a
 * few rows. Every field carries a description so `MAPPING_JSON_SCHEMA` can go into a prompt.
 *
 * Applied deterministically by `applyMapping` (pure). Versioned by `version`; a new version gets
 * its own schema and a migration, old specs stay readable.
 */
export const MAPPING_FORMAT = 'lazy-koins-mapping';
export const MAPPING_VERSION = 1;

const MAX_PATTERN = 500;

const column = z
  .string()
  .min(1)
  .max(200)
  .describe(
    'A column header exactly as it appears in the file. Compared loosely: case, spaces, "_" and "-" are ignored.',
  );

const regex = z
  .string()
  .min(1)
  .max(MAX_PATTERN)
  .refine(isValidRegex, { message: 'invalid regular expression' })
  .describe(
    'A JavaScript regular expression, without slashes; matched case-insensitively.',
  );

function isValidRegex(pattern: string): boolean {
  try {
    new RegExp(pattern, 'i');
    return true;
  } catch {
    return false;
  }
}

const kind = z
  .enum(BOOKING_KINDS)
  .describe(
    "Standard booking kind. trade = one leg of a buy/sell/convert; deposit/withdrawal = in from/out to outside the platform; fee = a fee on its own row; transfer = between the user's own accounts (not income); income_* = income of the year by category; loss; spam; unknown = not classified.",
  );

const timeZone = z
  .string()
  .min(1)
  .max(64)
  .refine(isKnownZone, { message: 'unknown time zone' })
  .describe(
    '"UTC", a fixed offset like "+02:00", or an IANA zone like "Europe/Zurich".',
  );

/** A value taken from a column, or a constant. */
const valueSource = z
  .object({
    column: column.optional().describe('Take the value from this column.'),
    value: z
      .string()
      .max(200)
      .optional()
      .describe(
        'A constant value, used when there is no column or the cell is empty.',
      ),
  })
  .refine((v) => v.column !== undefined || v.value !== undefined, {
    message: 'column or value is required',
  });

const columnOnly = z.object({ column });

const quantity = z
  .discriminatedUnion('mode', [
    z
      .object({
        mode: z.literal('signed'),
        column: column.describe(
          'Signed amount: positive arrives, negative leaves.',
        ),
      })
      .describe('One signed amount column.'),
    z
      .object({
        mode: z.literal('inOut'),
        inColumn: column.describe('Amount arriving (unsigned).'),
        outColumn: column.describe('Amount leaving (unsigned).'),
      })
      .describe(
        'Separate columns for incoming and outgoing amounts; quantity = in − out.',
      ),
    z
      .object({
        mode: z.literal('side'),
        column: column.describe('Unsigned amount.'),
        sideColumn: column.describe(
          'Column naming the direction (e.g. "Type").',
        ),
        outValues: z
          .array(z.string().min(1))
          .min(1)
          .describe(
            'Values of sideColumn that mean the asset LEAVES the account (e.g. ["Sell", "Send"]); every other value means it arrives.',
          ),
      })
      .describe('Unsigned amount plus a side/direction column.'),
  ])
  .describe('How the signed quantity is read.');

const timestamp = z
  .object({
    column,
    format: z
      .enum(DATE_FORMATS)
      .describe(
        'iso/ymd = 2025-03-01 12:00:00 (also 25-03-01, T separator, fractions); dmy = 01-03-2025 or 01.03.2025; mdy = 3/1/2025 1:00:00 PM; named = Jan 5, 2024, 10:12:13 AM; unix = seconds; unixMs = milliseconds. A zone written in the cell (Z, +01:00) always wins.',
      ),
    timeZone: timeZone
      .default('UTC')
      .describe('Zone of the wall-clock times when the cell names none.'),
    timeZoneFromFileName: regex
      .optional()
      .describe(
        'Regex with ONE capture group that extracts the UTC offset from the file name, e.g. "_UTC_?([+-]?\\d{1,2})_" for "..._UTC_2_..." (= UTC+2). The captured hours (or "+02:00") override timeZone; if the name does not match, timeZone is used and a note is recorded.',
      ),
  })
  .describe('The timestamp of each row, converted to UTC.');

const kindRule = z
  .object({
    equals: z
      .array(z.string())
      .optional()
      .describe(
        'One value per kind column, compared case-insensitively; "*" matches anything, "" matches an empty cell.',
      ),
    pattern: regex
      .optional()
      .describe(
        'Alternatively a regex tested against the kind columns\' values joined by "|".',
      ),
    kind,
  })
  .refine((rule) => rule.equals !== undefined || rule.pattern !== undefined, {
    message: 'equals or pattern is required',
  });

const bookings = z
  .object({
    timestamp,
    account: valueSource
      .optional()
      .describe(
        'Account/wallet on the platform (e.g. column "wallet"); default "main".',
      ),
    asset: columnOnly.describe(
      'Column with the asset symbol (normalised by "assets").',
    ),
    quantity,
    fee: z
      .object({
        column: column.describe('Fee amount; its absolute value is taken.'),
        assetColumn: column
          .optional()
          .describe(
            "Column with the fee asset; when absent or empty the booking's asset.",
          ),
      })
      .optional()
      .describe(
        'Fee charged with the row (leaves the account in addition to the quantity).',
      ),
    kind: z
      .object({
        columns: z
          .array(column)
          .min(1)
          .describe(
            'Source columns that decide the kind (e.g. ["type", "subtype"] or ["Operation"]).',
          ),
        rules: z
          .array(kindRule)
          .describe('Checked in order; the first matching rule decides.'),
        default: kind
          .default('unknown')
          .describe('Kind when no rule matches. Rows are never dropped.'),
      })
      .describe('Kind of each booking from a lookup on source columns.'),
    group: columnOnly
      .optional()
      .describe('Column linking the legs of one trade (e.g. Kraken "refid").'),
    note: columnOnly.optional(),
    priceChf: columnOnly
      .optional()
      .describe('Price of one unit in CHF, if the export has it.'),
    priceUsd: columnOnly
      .optional()
      .describe('Price of one unit in USD, if the export has it.'),
  })
  .describe('How rows become Buchungen.');

const holdings = z
  .object({
    mode: z
      .enum(['rows', 'lastPerAsset'])
      .describe(
        'rows = every row is a balance (a statement export); lastPerAsset = a running-balance column: the latest row per account+asset becomes the balance at that row\'s date (needs "bookings.timestamp").',
      ),
    asset: columnOnly,
    quantity: columnOnly.describe('Balance column (signed decimal).'),
    account: valueSource.optional(),
    asOf: z
      .object({
        column: column.optional(),
        format: z.enum(DATE_FORMATS).default('ymd'),
        value: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional()
          .describe('A fixed ISO date.'),
      })
      .optional()
      .describe(
        'The date of a balance in mode "rows". Not used by lastPerAsset.',
      ),
    evidence: valueSource
      .optional()
      .describe('Evidence text for each balance.'),
  })
  .describe('Optional: rows → Bestände (balances at a date).');

export const MappingSpecSchema = z
  .object({
    format: z.literal(MAPPING_FORMAT).describe('Always "lazy-koins-mapping".'),
    version: z.literal(MAPPING_VERSION).describe('Spec version, currently 1.'),
    name: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .describe('Human name, e.g. "Kraken Ledger (2024+)".'),
    platform: z
      .string()
      .regex(/^[a-z0-9][a-z0-9._-]{0,39}$/)
      .describe(
        'Constant platform name for every record, lower-case (kraken, binance, revolut).',
      ),
    description: z.string().max(2000).optional(),
    match: z
      .object({
        headers: z
          .array(column)
          .min(1)
          .max(60)
          .describe(
            'Columns the header row must contain. Fingerprint for recognising the file automatically, and how the header row is found below any preamble.',
          ),
        fileName: regex
          .optional()
          .describe('Optional regex the file name must also match.'),
      })
      .describe('How a file is recognised as this export.'),
    source: z
      .object({
        sheet: z
          .union([z.string().min(1), z.number().int().min(0)])
          .optional()
          .describe(
            'XLSX only: sheet name or 0-based index; default = first sheet with the headers.',
          ),
        headerRow: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe(
            'Fixed 1-based header row; default = first row (within 50) containing match.headers.',
          ),
        delimiter: z
          .enum([',', ';', '\t', '|'])
          .optional()
          .describe('CSV delimiter; default = detected.'),
        encoding: z
          .enum(['auto', 'utf-8', 'utf-16le', 'utf-16be', 'windows-1252'])
          .default('auto')
          .describe('CSV text encoding; default = detected from BOM/bytes.'),
      })
      .default({ encoding: 'auto' }),
    numbers: z
      .object({
        decimal: z.enum(['.', ',']).default('.'),
        thousands: z
          .array(z.string().min(1).max(1))
          .default([])
          .describe('Grouping characters to remove, e.g. [",", "\'"].'),
        stripText: z
          .boolean()
          .default(false)
          .describe(
            'Remove currency codes/symbols around numbers ("CHF 1,234.56").',
          ),
      })
      .default({ decimal: '.', thousands: [], stripText: false })
      .describe(
        'How numbers are written. Digits are never converted through floating point.',
      ),
    filters: z
      .array(
        z
          .object({
            column,
            equals: z
              .array(z.string())
              .optional()
              .describe(
                'Exclude when the cell equals one of these (case-insensitive).',
              ),
            pattern: regex
              .optional()
              .describe('Exclude when the cell matches.'),
            empty: z
              .boolean()
              .optional()
              .describe('true = exclude when the cell is empty.'),
          })
          .refine(
            (f) =>
              f.equals !== undefined ||
              f.pattern !== undefined ||
              f.empty !== undefined,
            {
              message: 'equals, pattern or empty is required',
            },
          ),
      )
      .default([])
      .describe(
        "Rows to EXCLUDE (e.g. Kraken's pending duplicates with an empty txid). A row is skipped when any filter matches; skipped rows are listed as notes.",
      ),
    assets: z
      .object({
        rewrites: z
          .array(z.object({ pattern: regex, replace: z.string().max(50) }))
          .default([])
          .describe(
            'Regex rewrites applied in order, e.g. {"pattern": "\\\\.(S|F|B|M|P|HOLD)$", "replace": ""}.',
          ),
        aliases: z
          .record(z.string(), z.string().min(1))
          .default({})
          .describe(
            'After rewrites: exact renames, e.g. {"XXBT": "BTC", "ETH2": "ETH"}. Assets are upper-cased.',
          ),
      })
      .default({ rewrites: [], aliases: {} })
      .describe(
        'Asset normalisation; the original name is kept on the record.',
      ),
    bookings: bookings.optional(),
    holdings: holdings.optional(),
  })
  .refine(
    (spec) => spec.bookings !== undefined || spec.holdings !== undefined,
    {
      message: 'bookings or holdings is required',
    },
  )
  .refine(
    (spec) =>
      spec.holdings?.mode !== 'lastPerAsset' || spec.bookings !== undefined,
    { message: 'holdings.mode "lastPerAsset" needs bookings.timestamp' },
  )
  .describe(
    'lazy-koins mapping spec v1: turns a tabular export into standard Buchungen/Bestände.',
  );

/** A spec as written (defaults optional). */
export type MappingSpecInput = z.input<typeof MappingSpecSchema>;
/** A validated spec with defaults filled in. */
export type MappingSpec = z.output<typeof MappingSpecSchema>;

export type MappingValidation =
  | { readonly ok: true; readonly spec: MappingSpec }
  | {
      readonly ok: false;
      readonly issues: readonly {
        readonly path: string;
        readonly message: string;
      }[];
    };

/** Validates untrusted JSON (an upload, an editor, an LLM answer) into a spec. */
export function validateMappingSpec(input: unknown): MappingValidation {
  const parsed = MappingSpecSchema.safeParse(input);
  if (parsed.success) return { ok: true, spec: parsed.data };
  return {
    ok: false,
    issues: parsed.error.issues.map((issue) => ({
      path: issue.path.map(String).join('.'),
      message: issue.message,
    })),
  };
}

/** The spec's JSON Schema (draft 2020-12) — for the editor and for an LLM prompt. */
export function mappingJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(MappingSpecSchema, { io: 'input' }) as Record<
    string,
    unknown
  >;
}
