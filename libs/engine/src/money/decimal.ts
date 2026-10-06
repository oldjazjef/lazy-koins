import DecimalJs from 'decimal.js';

/**
 * Every quantity, rate and CHF amount in lazy-koins is a `Decimal` (CLAUDE.md, Numbers): crypto
 * quantities have up to 18 decimals, and a JS `number` silently loses them (`0.1 + 0.2`).
 *
 * The engine's own Decimal constructor, isolated from decimal.js's global configuration so no
 * other code can change the precision under it:
 *
 * - `precision: 60` significant digits for the results of `times` / `div` — far beyond 18
 *   decimals on a large integer part, so arithmetic itself never rounds in practice.
 * - `rounding: ROUND_HALF_EVEN` only applies when an operation exceeds that precision. Rounding
 *   for presentation always names its mode explicitly (`roundTo`, `formatFixed`).
 * - `toExpNeg` / `toExpPos` wide, so `toString()` never switches to exponent notation for any
 *   value we handle (`1e-18` prints as `0.000000000000000001`).
 *
 * Build values with `parseDecimal` (from the original string) — there is deliberately no way to
 * make one from a `number`.
 */
export const EngineDecimal = DecimalJs.clone({
  precision: 60,
  rounding: DecimalJs.ROUND_HALF_EVEN,
  toExpNeg: -100,
  toExpPos: 100,
});

export type Decimal = InstanceType<typeof EngineDecimal>;

/** Rounding modes, named for what they do. Every rounding call picks one explicitly. */
export const ROUNDING_MODES = {
  /** Commercial rounding: 0.005 → 0.01, -0.005 → -0.01 (away from zero on a tie). */
  halfUp: DecimalJs.ROUND_HALF_UP,
  /** Banker's rounding: a tie goes to the even neighbour (0.125 → 0.12, 0.135 → 0.14). */
  halfEven: DecimalJs.ROUND_HALF_EVEN,
  /** Truncate towards zero (1.239 → 1.23, -1.239 → -1.23). */
  down: DecimalJs.ROUND_DOWN,
  /** Away from zero (1.231 → 1.24, -1.231 → -1.24). */
  up: DecimalJs.ROUND_UP,
  /** Towards −∞. */
  floor: DecimalJs.ROUND_FLOOR,
  /** Towards +∞. */
  ceil: DecimalJs.ROUND_CEIL,
} as const;
export type RoundingMode = keyof typeof ROUNDING_MODES;

/**
 * A plain decimal as it appears in an export: optional sign, digits, optional fraction, optional
 * exponent (`1.5E-8`, which some exchanges write). No thousands separators, no comma decimals, no
 * currency symbols — an importer normalises its platform's format first, explicitly, because only
 * it knows whether `1,234` means one thousand or one point two.
 */
const DECIMAL_PATTERN = /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/;

export class DecimalParseError extends Error {
  constructor(readonly input: string) {
    // Only a prefix of the input: it comes from a user's file, and an error message ends up in
    // logs (CLAUDE.md, Private data).
    super(`Not a decimal number: ${JSON.stringify(input.slice(0, 32))}`);
    this.name = 'DecimalParseError';
  }
}

/**
 * The one way into a `Decimal`: from the original string, exactly as written. Surrounding
 * whitespace is ignored; anything else that is not a plain decimal throws `DecimalParseError`.
 *
 * Takes a `string` only — a `number` has already lost precision by the time it got here, which
 * is why `fromNumber` does not exist and a number argument throws at run time too.
 */
export function parseDecimal(input: string): Decimal {
  if (typeof input !== 'string') {
    throw new TypeError(
      'parseDecimal takes the original string — never a number',
    );
  }
  const trimmed = input.trim();
  if (!DECIMAL_PATTERN.test(trimmed)) throw new DecimalParseError(input);
  const value = new EngineDecimal(trimmed);
  // `-0` is a legitimate input ("-0.00" in a fee column) but must not print as "-0".
  return value.isZero() ? new EngineDecimal(0) : value;
}

/** `parseDecimal`, or `undefined` instead of an exception — for detection and optional cells. */
export function tryParseDecimal(input: string): Decimal | undefined {
  try {
    return parseDecimal(input);
  } catch {
    return undefined;
  }
}

export const ZERO: Decimal = new EngineDecimal(0);

export function isDecimal(value: unknown): value is Decimal {
  return EngineDecimal.isDecimal(value);
}

/** Exact sum; the empty sum is zero. */
export function sum(values: Iterable<Decimal>): Decimal {
  let total = ZERO;
  for (const value of values) total = total.plus(value);
  return total;
}

function checkPlaces(places: number): void {
  if (!Number.isInteger(places) || places < 0 || places > 30) {
    throw new RangeError(`places must be an integer 0–30, got ${places}`);
  }
}

/** Rounds to `places` decimals with an explicit mode. Only for presenting and exporting. */
export function roundTo(
  value: Decimal,
  places: number,
  mode: RoundingMode,
): Decimal {
  checkPlaces(places);
  const rounded = value.toDecimalPlaces(places, ROUNDING_MODES[mode]);
  return rounded.isZero() ? ZERO : rounded;
}

/**
 * Fixed-point text with exactly `places` decimals, `.` as the decimal point and no grouping —
 * the machine form for CSV/Excel cells and the API. `-0.00` never appears.
 */
export function formatFixed(
  value: Decimal,
  places: number,
  mode: RoundingMode,
): string {
  return roundTo(value, places, mode).toFixed(places);
}

/**
 * Human form for statements: Swiss grouping by default (`1’234’567.89`, F11.2), with an explicit
 * rounding mode. The grouping character is a parameter so other conventions stay possible.
 */
export function formatGrouped(
  value: Decimal,
  places: number,
  mode: RoundingMode,
  groupSeparator = '’',
): string {
  const fixed = formatFixed(value, places, mode);
  const negative = fixed.startsWith('-');
  const [integer = '', fraction] = (negative ? fixed.slice(1) : fixed).split(
    '.',
  );
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, groupSeparator);
  return `${negative ? '-' : ''}${grouped}${fraction === undefined ? '' : `.${fraction}`}`;
}

/** CHF amounts are presented with 2 decimals, commercially rounded. */
export function formatChf(value: Decimal, groupSeparator = '’'): string {
  return formatGrouped(value, 2, 'halfUp', groupSeparator);
}

/**
 * The canonical storage form — the TEXT column and the API's JSON string: every significant
 * digit, never an exponent, no trailing zeros, no `-0`. `parseDecimal(toDecimalString(x))`
 * equals `x`.
 */
export function toDecimalString(value: Decimal): string {
  return value.isZero() ? '0' : value.toFixed();
}
