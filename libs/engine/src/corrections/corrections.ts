import { z } from 'zod';
import {
  BOOKING_KINDS,
  type Booking,
  type BookingKind,
  type Holding,
} from '../bookings/booking';
import { parseDecimal, toDecimalString } from '../money/decimal';
import type { RateEntry } from '../rates/rate-table';

/**
 * Corrections are data, not edits (F9.4): each one is applied on top of the imported records,
 * which never change. Applying them is pure; every application reports what it changed
 * (before/after) so the history can show it, and an undone correction is simply left out.
 *
 * - `price_override` (F9.1): the price of an asset on a day in the project's tax currency
 *   (`priceChf` — the name predates F4.1a; a position at 31.12., an income booking's day) — it
 *   becomes a `manual` rate and wins over every other source.
 * - `reclassify` (F9.2): another kind for one booking (income / no income / spam / loss /
 *   transfer …).
 * - `manual_booking`, `manual_holding` (F9.3): a forgotten platform, a hard fork, a loss, a
 *   balance with its evidence (F6.5). A manual holding replaces the account's balance of that
 *   asset at that date.
 */

const decimalText = z
  .string()
  .trim()
  .regex(/^[+-]?(\d+(\.\d*)?|\.\d+)$/, 'decimal')
  .describe('A plain decimal number as text, `.` as the decimal point.');
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'isoDate');
const isoTimestamp = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?Z$/, 'isoUtc');
const name = z.string().trim().min(1).max(80);
const asset = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .transform((value) => value.toUpperCase());

export const CorrectionDataSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('price_override'),
    asset,
    date: isoDate,
    priceChf: decimalText,
  }),
  z.object({
    type: z.literal('reclassify'),
    bookingId: z.string().min(1).max(200),
    kind: z.enum(BOOKING_KINDS),
  }),
  z.object({
    type: z.literal('manual_booking'),
    booking: z.object({
      platform: name,
      accountId: name.default('main'),
      timestamp: isoTimestamp,
      asset,
      quantity: decimalText,
      kind: z.enum(BOOKING_KINDS),
      fee: decimalText.optional(),
      feeAsset: asset.optional(),
      priceChf: decimalText.optional(),
      priceUsd: decimalText.optional(),
      note: z.string().max(500).optional(),
    }),
  }),
  z.object({
    type: z.literal('manual_holding'),
    holding: z.object({
      platform: name,
      accountId: name.default('main'),
      asset,
      quantity: decimalText,
      asOf: isoDate,
      priceChf: decimalText.optional(),
      evidence: z.string().max(500).optional(),
    }),
  }),
]);
export type CorrectionData = z.infer<typeof CorrectionDataSchema>;
export type CorrectionType = CorrectionData['type'];
export const CORRECTION_TYPES = [
  'price_override',
  'reclassify',
  'manual_booking',
  'manual_holding',
] as const satisfies readonly CorrectionType[];

export interface Correction {
  readonly id: string;
  /** ISO timestamp — corrections apply in creation order (then id). */
  readonly createdAt: string;
  readonly reason: string;
  readonly data: CorrectionData;
}

/** A JSON-friendly picture of what a correction touched. */
export type CorrectionSide = Readonly<Record<string, string | null>> | null;

export interface AppliedCorrection {
  readonly correctionId: string;
  readonly type: CorrectionType;
  /** `targetMissing`: the booking to reclassify is not (any more) in the project's files. */
  readonly status: 'applied' | 'targetMissing';
  readonly before: CorrectionSide;
  readonly after: CorrectionSide;
}

export interface CorrectedRecords {
  readonly bookings: readonly Booking[];
  readonly holdings: readonly Holding[];
  /** Price overrides as `manual` rates. */
  readonly rates: readonly RateEntry[];
  readonly applied: readonly AppliedCorrection[];
}

/** The `sourceFileId` of records a correction created (F7.5: they trace to the correction). */
export const CORRECTION_SOURCE_PREFIX = 'correction:';

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Validates a correction body; `issues` are zod paths + messages. */
export function validateCorrectionData(
  input: unknown,
):
  | { ok: true; data: CorrectionData }
  | { ok: false; issues: { path: string; message: string }[] } {
  const parsed = CorrectionDataSchema.safeParse(input);
  if (parsed.success) return { ok: true, data: parsed.data };
  return {
    ok: false,
    issues: parsed.error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    })),
  };
}

/** Applies corrections in order (createdAt, id). Pure; the inputs are not changed. */
export function applyCorrections(
  bookings: readonly Booking[],
  holdings: readonly Holding[],
  corrections: readonly Correction[],
  /** The project's tax currency (F4.1a): a price override (`priceChf`) is a price in it. */
  taxCurrency = 'CHF',
): CorrectedRecords {
  const outBookings: Booking[] = [...bookings];
  const indexOf = new Map(outBookings.map((b, i) => [b.id, i] as const));
  const outHoldings: Holding[] = [...holdings];
  const rates: RateEntry[] = [];
  const applied: AppliedCorrection[] = [];

  const ordered = [...corrections].sort(
    (a, b) => compareText(a.createdAt, b.createdAt) || compareText(a.id, b.id),
  );
  for (const correction of ordered) {
    const { data } = correction;
    const source = `${CORRECTION_SOURCE_PREFIX}${correction.id}`;
    switch (data.type) {
      case 'price_override': {
        rates.push({
          kind: 'price',
          asset: data.asset,
          currency: taxCurrency,
          date: data.date,
          value: toDecimalString(parseDecimal(data.priceChf)),
          source: 'manual',
        });
        applied.push({
          correctionId: correction.id,
          type: data.type,
          status: 'applied',
          before: null,
          after: {
            asset: data.asset,
            date: data.date,
            priceChf: data.priceChf,
          },
        });
        break;
      }
      case 'reclassify': {
        const index = indexOf.get(data.bookingId);
        const current = index === undefined ? undefined : outBookings[index];
        if (index === undefined || !current) {
          applied.push({
            correctionId: correction.id,
            type: data.type,
            status: 'targetMissing',
            before: null,
            after: { bookingId: data.bookingId, kind: data.kind },
          });
          break;
        }
        outBookings[index] = { ...current, kind: data.kind as BookingKind };
        applied.push({
          correctionId: correction.id,
          type: data.type,
          status: 'applied',
          before: { bookingId: current.id, kind: current.kind },
          after: { bookingId: current.id, kind: data.kind },
        });
        break;
      }
      case 'manual_booking': {
        const b = data.booking;
        const booking: Booking = {
          id: source,
          sourceFileId: source,
          row: 0,
          platform: b.platform,
          accountId: b.accountId,
          timestamp: new Date(b.timestamp).toISOString(),
          asset: b.asset,
          quantity: parseDecimal(b.quantity),
          kind: b.kind,
          fee:
            b.fee === undefined || parseDecimal(b.fee).isZero()
              ? undefined
              : parseDecimal(b.fee).abs(),
          feeAsset: b.feeAsset === b.asset ? undefined : b.feeAsset,
          priceChf:
            b.priceChf === undefined ? undefined : parseDecimal(b.priceChf),
          priceUsd:
            b.priceUsd === undefined ? undefined : parseDecimal(b.priceUsd),
          note: b.note,
          rawType: 'manual',
        };
        outBookings.push(booking);
        applied.push({
          correctionId: correction.id,
          type: data.type,
          status: 'applied',
          before: null,
          after: {
            platform: b.platform,
            accountId: b.accountId,
            timestamp: booking.timestamp,
            asset: b.asset,
            quantity: b.quantity,
            kind: b.kind,
          },
        });
        break;
      }
      case 'manual_holding': {
        const h = data.holding;
        const holding: Holding = {
          id: source,
          sourceFileId: source,
          row: 0,
          platform: h.platform,
          accountId: h.accountId,
          asset: h.asset,
          quantity: parseDecimal(h.quantity),
          asOf: h.asOf,
          priceChf:
            h.priceChf === undefined ? undefined : parseDecimal(h.priceChf),
          evidence: h.evidence,
        };
        outHoldings.push(holding);
        applied.push({
          correctionId: correction.id,
          type: data.type,
          status: 'applied',
          before: null,
          after: {
            platform: h.platform,
            accountId: h.accountId,
            asset: h.asset,
            quantity: h.quantity,
            asOf: h.asOf,
          },
        });
        break;
      }
    }
  }
  return { bookings: outBookings, holdings: outHoldings, rates, applied };
}

/** Whether a record was created by a correction (manual booking/holding). */
export function isCorrectionRecord(sourceFileId: string): boolean {
  return sourceFileId.startsWith(CORRECTION_SOURCE_PREFIX);
}
