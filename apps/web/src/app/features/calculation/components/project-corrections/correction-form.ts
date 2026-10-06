import { z } from 'zod';
import { BOOKING_KINDS } from '../../../../core/api/api.types';
import type { CorrectionType } from '../../../../core/api/calculation.types';

/**
 * The correction form's values (all text, as typed) → the API body (F9). Validated with Zod;
 * messages are i18n keys. Amounts stay strings; the API validates them again with the engine's
 * schema.
 */
export interface CorrectionFormValue {
  type: CorrectionType;
  reason: string;
  asset: string;
  date: string;
  priceChf: string;
  bookingId: string;
  kind: string;
  platform: string;
  accountId: string;
  timestamp: string;
  quantity: string;
  fee: string;
  evidence: string;
}

const decimal = z
  .string()
  .trim()
  .regex(/^-?\d+(\.\d+)?$/, 'corrections.errors.decimal');
const positive = z
  .string()
  .trim()
  .regex(/^\d+(\.\d+)?$/, 'corrections.errors.positive');
const required = z.string().trim().min(1, 'corrections.errors.required');
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'corrections.errors.date');
const kind = z.enum(BOOKING_KINDS, { message: 'corrections.errors.kind' });

const reason = z
  .string()
  .trim()
  .min(1, 'corrections.errors.reason')
  .max(1000, 'corrections.errors.reasonTooLong');

/** `2025-08-01T12:00` (datetime-local, read as UTC) → `2025-08-01T12:00:00Z`. */
export function toUtcTimestamp(local: string): string {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local) ? `${local}:00Z` : local;
}

export type CorrectionBody =
  | { ok: true; body: { reason: string; data: Record<string, unknown> } }
  | { ok: false; error: string };

export function correctionBody(value: CorrectionFormValue): CorrectionBody {
  const why = reason.safeParse(value.reason);
  if (!why.success) return fail(why.error);
  let data: z.ZodSafeParseResult<Record<string, unknown>>;
  switch (value.type) {
    case 'price_override':
      data = z
        .object({
          type: z.literal('price_override'),
          asset: required,
          date: isoDate,
          priceChf: positive,
        })
        .safeParse(value);
      break;
    case 'reclassify':
      data = z
        .object({ type: z.literal('reclassify'), bookingId: required, kind })
        .safeParse(value);
      break;
    case 'manual_booking': {
      const parsed = z
        .object({
          platform: required,
          accountId: required,
          timestamp: required,
          asset: required,
          quantity: decimal,
          kind,
          fee: z.union([z.literal(''), positive]),
          priceChf: z.union([z.literal(''), positive]),
        })
        .safeParse(value);
      data = parsed.success
        ? {
            success: true,
            data: {
              type: 'manual_booking',
              booking: {
                platform: parsed.data.platform,
                accountId: parsed.data.accountId,
                timestamp: toUtcTimestamp(parsed.data.timestamp),
                asset: parsed.data.asset,
                quantity: parsed.data.quantity,
                kind: parsed.data.kind,
                ...(parsed.data.fee ? { fee: parsed.data.fee } : {}),
                ...(parsed.data.priceChf
                  ? { priceChf: parsed.data.priceChf }
                  : {}),
              },
            },
          }
        : parsed;
      break;
    }
    case 'manual_holding': {
      const parsed = z
        .object({
          platform: required,
          accountId: required,
          asset: required,
          quantity: decimal,
          date: isoDate,
          priceChf: z.union([z.literal(''), positive]),
          evidence: z.string().max(500, 'corrections.errors.tooLong'),
        })
        .safeParse(value);
      data = parsed.success
        ? {
            success: true,
            data: {
              type: 'manual_holding',
              holding: {
                platform: parsed.data.platform,
                accountId: parsed.data.accountId,
                asset: parsed.data.asset,
                quantity: parsed.data.quantity,
                asOf: parsed.data.date,
                ...(parsed.data.priceChf
                  ? { priceChf: parsed.data.priceChf }
                  : {}),
                ...(parsed.data.evidence
                  ? { evidence: parsed.data.evidence }
                  : {}),
              },
            },
          }
        : parsed;
      break;
    }
  }
  if (!data.success) return fail(data.error);
  return { ok: true, body: { reason: why.data, data: data.data } };
}

function fail(error: z.ZodError): CorrectionBody {
  return {
    ok: false,
    error: error.issues[0]?.message ?? 'corrections.errors.required',
  };
}
