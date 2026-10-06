import type { Booking, Holding } from '../bookings/booking';
import { toDecimalString } from '../money/decimal';
import type { RecordSummary } from './types';

/** F7.5: what a figure's record looks like in a drill-down (file SHA-256 + row, raw row). */
export function bookingSummary(booking: Booking): RecordSummary {
  return {
    id: booking.id,
    type: 'booking',
    sourceFileId: booking.sourceFileId,
    row: booking.row,
    platform: booking.platform,
    accountId: booking.accountId,
    asset: booking.asset,
    quantity: toDecimalString(booking.quantity),
    at: booking.timestamp,
    kind: booking.kind,
    fee: booking.fee ? toDecimalString(booking.fee) : null,
    feeAsset: booking.fee ? (booking.feeAsset ?? booking.asset) : null,
    rawType: booking.rawType,
    raw: booking.raw ?? null,
  };
}

export function holdingSummary(holding: Holding): RecordSummary {
  return {
    id: holding.id,
    type: 'holding',
    sourceFileId: holding.sourceFileId,
    row: holding.row,
    platform: holding.platform,
    accountId: holding.accountId,
    asset: holding.asset,
    quantity: toDecimalString(holding.quantity),
    at: holding.asOf,
    kind: null,
    fee: null,
    feeAsset: null,
    rawType: holding.evidence ?? null,
    raw: holding.raw ?? null,
  };
}
