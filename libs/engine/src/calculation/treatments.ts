import type { BookingKind } from '../bookings/booking';
import {
  applyCorrections,
  CORRECTION_SOURCE_PREFIX,
  isCorrectionRecord,
} from '../corrections/corrections';
import { toDecimalString } from '../money/decimal';
import type { IncomeCategory } from '../rules/country-rules';
import type { CalculationInput, CalculationResult } from './types';

/**
 * "Transaktionen": every booking of the project and how it counts in the tax calculation —
 * pure, from the same input and result the calculation used (F7.5, F7.6).
 *
 * - `income`: income of the year, valued at arrival (in the income total).
 * - `oneOff`: a loss (or another F7.3 event without an income line), listed separately.
 * - `balance`: changes a ledger balance — it decides the position at 31.12. (wealth); a trade
 *   in itself is not taxable (private capital gains, CH).
 * - `checkOnly`: the account is valued from a statement (or a manual balance) at 31.12.; the
 *   booking is only checked against it.
 * - `transfer`: between the user's own accounts — neutral.
 * - `spam`: spam / scam tokens, neither wealth nor income.
 * - `unknown`: not classified yet — counted in the balance, an open item until reclassified.
 * - `afterYear`: after 31.12. of the tax year — not counted.
 * - `excluded`: left out by an `exclude_booking` correction (with its reason).
 */
export const BOOKING_TREATMENTS = [
  'income',
  'oneOff',
  'balance',
  'checkOnly',
  'transfer',
  'spam',
  'unknown',
  'afterYear',
  'excluded',
] as const;
export type BookingTreatment = (typeof BOOKING_TREATMENTS)[number];

export interface BookingTreatmentRow {
  readonly id: string;
  readonly timestamp: string;
  readonly platform: string;
  readonly accountId: string;
  readonly asset: string;
  /** Signed decimal string. */
  readonly quantity: string;
  /** The kind the calculation uses (after a reclassification). */
  readonly kind: BookingKind;
  /** The imported kind when a correction reclassified the booking, else null. */
  readonly importedKind: BookingKind | null;
  readonly fee: string | null;
  readonly feeAsset: string | null;
  readonly rawType: string;
  readonly note: string | null;
  readonly group: string | null;
  /** F7.5: the file (SHA-256) and 1-based row — `correction:<id>` / 0 for a manual booking. */
  readonly sourceFileId: string;
  readonly row: number;
  readonly manual: boolean;
  readonly treatment: BookingTreatment;
  /** Income / one-off value in the tax currency; null = none or no price. */
  readonly valueChf: string | null;
  readonly incomeCategory: IncomeCategory | null;
  /** The result's figures this booking is part of (`pos:`, `inc:`, `gap:`, `evt:`). */
  readonly figureIds: readonly string[];
  /** The correction that excluded, reclassified or created this booking. */
  readonly correctionId: string | null;
  readonly correctionReason: string | null;
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Every booking (imported and manual) with its treatment, newest first (then id). */
export function bookingTreatments(
  input: CalculationInput,
  result: CalculationResult,
): BookingTreatmentRow[] {
  const cutoffTs = `${input.taxYear + 1}-01-01T00:00:00.000Z`;
  const corrected = applyCorrections(
    input.bookings,
    input.holdings,
    input.corrections,
    input.rules.homeCurrency,
  );
  const reasonOf = new Map(input.corrections.map((c) => [c.id, c.reason]));
  const excludedBy = new Map<string, string>();
  const reclassifiedBy = new Map<string, string>();
  for (const applied of corrected.applied) {
    const bookingId = applied.before?.['bookingId'];
    if (applied.status !== 'applied' || !bookingId) continue;
    if (applied.type === 'exclude_booking') {
      excludedBy.set(bookingId, applied.correctionId);
    } else if (applied.type === 'reclassify') {
      // The last reclassification wins (corrections apply in order).
      reclassifiedBy.set(bookingId, applied.correctionId);
    }
  }

  const figuresOf = new Map<string, string[]>();
  const addFigure = (figureId: string, recordIds: readonly string[]) => {
    for (const recordId of recordIds) {
      const list = figuresOf.get(recordId);
      if (list) {
        if (!list.includes(figureId)) list.push(figureId);
      } else {
        figuresOf.set(recordId, [figureId]);
      }
    }
  };
  for (const p of result.positions) addFigure(p.id, p.recordIds);
  for (const line of result.income) addFigure(line.id, line.recordIds);
  for (const gap of result.earnGaps) addFigure(gap.id, gap.recordIds);
  for (const event of result.oneOffEvents) addFigure(event.id, event.recordIds);

  const positionById = new Map(result.positions.map((p) => [p.id, p] as const));
  const incomeById = new Map(result.income.map((l) => [l.id, l] as const));
  const eventById = new Map(result.oneOffEvents.map((e) => [e.id, e] as const));
  const effective = new Map(corrected.bookings.map((b) => [b.id, b] as const));

  const rows: BookingTreatmentRow[] = [];
  const all = [
    ...input.bookings,
    ...corrected.bookings.filter((b) => isCorrectionRecord(b.sourceFileId)),
  ];
  for (const imported of all) {
    const manual = isCorrectionRecord(imported.sourceFileId);
    const current = effective.get(imported.id);
    const b = current ?? imported;
    const excludeId = excludedBy.get(imported.id);
    const reclassifyId = reclassifiedBy.get(imported.id);
    const position = positionById.get(
      `pos:${b.platform}|${b.accountId}|${b.asset}`,
    );
    const income = incomeById.get(`inc:${b.id}`);
    const event = eventById.get(`evt:${b.id}`);

    let treatment: BookingTreatment;
    let valueChf: string | null = null;
    if (excludeId !== undefined || !current) treatment = 'excluded';
    else if (b.timestamp >= cutoffTs) treatment = 'afterYear';
    else if (income && income.status !== 'spam') {
      treatment = 'income';
      valueChf = income.valueChf;
    } else if (event && !event.incomeLineId) {
      treatment = 'oneOff';
      valueChf = event.valueChf;
    } else if (
      b.kind === 'spam' ||
      income?.status === 'spam' ||
      position?.status === 'spam'
    ) {
      treatment = 'spam';
    } else if (b.kind === 'transfer') treatment = 'transfer';
    else if (b.kind === 'unknown') treatment = 'unknown';
    else if (position && position.quantitySource !== 'ledger') {
      treatment = 'checkOnly';
    } else treatment = 'balance';

    const correctionId =
      excludeId ??
      reclassifyId ??
      (manual ? b.id.slice(CORRECTION_SOURCE_PREFIX.length) : null);
    rows.push({
      id: b.id,
      timestamp: b.timestamp,
      platform: b.platform,
      accountId: b.accountId,
      asset: b.asset,
      quantity: toDecimalString(b.quantity),
      kind: b.kind,
      importedKind:
        reclassifyId !== undefined && imported.kind !== b.kind
          ? imported.kind
          : null,
      fee: b.fee === undefined ? null : toDecimalString(b.fee),
      feeAsset: b.fee === undefined ? null : (b.feeAsset ?? b.asset),
      rawType: b.rawType,
      note: b.note ?? null,
      group: b.group ?? null,
      sourceFileId: b.sourceFileId,
      row: b.row,
      manual,
      treatment,
      valueChf,
      incomeCategory: treatment === 'income' && income ? income.category : null,
      figureIds: treatment === 'excluded' ? [] : (figuresOf.get(b.id) ?? []),
      correctionId,
      correctionReason:
        correctionId === null ? null : (reasonOf.get(correctionId) ?? null),
    });
  }
  return rows.sort(
    (a, b) => compareText(b.timestamp, a.timestamp) || compareText(a.id, b.id),
  );
}
