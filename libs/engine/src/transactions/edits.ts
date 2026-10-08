import { z } from 'zod';
import {
  BOOKING_KINDS,
  type Booking,
  type BookingKind,
} from '../bookings/booking';

/**
 * F9.8 global transaction edits — "one truth per transaction" (decided 08.10.2026): a change
 * hangs on the transaction itself, not on a project, and applies in every project (and the
 * dashboard) that reads it. Like corrections (F9.4) they are data on top of the imported
 * bookings, which never change; applying them is pure.
 *
 * A transaction is addressed by a **stable key** (`transactionKeys`):
 * - a booking read from a file: its id `<file SHA-256>:<row>[…]` — the bytes never change (F5.3);
 * - a booking of a wallet fetch: `wallet:<wallet id>:<network>:<tx hash>:<n>` (n = its position
 *   within the transaction) — a new fetch writes new bytes with other rows, the key stays.
 */

/** Longest stable key (mirrored by a CHECK). */
export const TRANSACTION_KEY_MAX = 300;
export const TRANSACTION_NOTE_MAX = 500;

const key = z.string().min(1).max(TRANSACTION_KEY_MAX);

/** What one edit changes; absent = unchanged. `linkedKey: null` removes a link. */
export const TransactionChangesSchema = z
  .object({
    /** Another kind (F9.2 umklassieren): income, transfer, spam, loss … */
    kind: z.enum(BOOKING_KINDS).optional(),
    /** The asset the booking really is (a wrong symbol in the export). */
    asset: z
      .string()
      .trim()
      .min(1)
      .max(40)
      .transform((value) => value.toUpperCase())
      .optional(),
    note: z.string().max(TRANSACTION_NOTE_MAX).optional(),
    /** Left out of every calculation (a duplicate, spam, a row that does not belong). */
    hidden: z.boolean().optional(),
    /**
     * Moved between own accounts: linked with its counter-booking — both count as `transfer`.
     */
    linkedKey: key.nullable().optional(),
  })
  .strict()
  .refine((changes) => Object.keys(changes).length > 0, {
    message: 'nothing to change',
  });
export type TransactionChanges = z.infer<typeof TransactionChangesSchema>;

export interface TransactionEdit {
  readonly id: string;
  readonly key: string;
  /** ISO timestamp — edits apply in creation order (then id). */
  readonly createdAt: string;
  readonly reason: string;
  readonly changes: TransactionChanges;
}

/** The fields an edit can change, before and after. */
export interface TransactionFields {
  readonly kind: BookingKind;
  readonly asset: string;
  readonly note: string | null;
}

/** What the active edits did to one booking. */
export interface TransactionEffect {
  readonly key: string;
  /** The edits of this transaction in the order they applied. */
  readonly editIds: readonly string[];
  readonly before: TransactionFields;
  readonly after: TransactionFields;
  readonly hidden: boolean;
  /** The counter-booking it is linked with (either side of the link). */
  readonly linkedKey: string | null;
}

export interface EditedBookings {
  /** The bookings the calculation uses (hidden ones left out). */
  readonly bookings: readonly Booking[];
  /** Hidden bookings, as imported. */
  readonly hidden: readonly Booking[];
  /** Booking id → what changed; only bookings an edit touched. */
  readonly effects: ReadonlyMap<string, TransactionEffect>;
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** The wallet prefix of a key (`wallet:<id>:`) — whose project it belongs to without reading. */
export function walletKeyPrefix(walletId: string): string {
  return `wallet:${walletId}:`;
}

/** The file prefix of a key (`<sha256>:`). */
export function fileKeyPrefix(sha256: string): string {
  return `${sha256}:`;
}

/**
 * The stable key of every booking of one file (see above). `walletId`: the file is a wallet
 * fetch (`wallet:<id>` source), else null.
 */
export function transactionKeys(
  bookings: readonly Booking[],
  walletId: string | null,
): Map<string, string> {
  const keys = new Map<string, string>();
  if (!walletId) {
    for (const booking of bookings) keys.set(booking.id, booking.id);
    return keys;
  }
  const seen = new Map<string, number>();
  const ordered = [...bookings].sort(
    (a, b) => a.row - b.row || compareText(a.id, b.id),
  );
  for (const booking of ordered) {
    const base = `${walletKeyPrefix(walletId)}${booking.accountId}:${booking.group ?? `row${booking.row}`}`;
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    keys.set(booking.id, `${base}:${n}`);
  }
  return keys;
}

interface State {
  editIds: string[];
  kind?: BookingKind;
  asset?: string;
  note?: string;
  hidden?: boolean;
  linkedKey?: string | null;
}

/** The edits folded per key: a later edit overrides the fields it sets. */
export function foldEdits(
  edits: readonly TransactionEdit[],
): Map<string, State> {
  const states = new Map<string, State>();
  const ordered = [...edits].sort(
    (a, b) => compareText(a.createdAt, b.createdAt) || compareText(a.id, b.id),
  );
  for (const edit of ordered) {
    const state = states.get(edit.key) ?? { editIds: [] };
    state.editIds.push(edit.id);
    const c = edit.changes;
    if (c.kind !== undefined) state.kind = c.kind;
    if (c.asset !== undefined) state.asset = c.asset;
    if (c.note !== undefined) state.note = c.note;
    if (c.hidden !== undefined) state.hidden = c.hidden;
    if (c.linkedKey !== undefined) state.linkedKey = c.linkedKey;
    states.set(edit.key, state);
  }
  return states;
}

/**
 * Applies the active edits to the bookings (pure; nothing is changed in place). `keyOf` gives a
 * booking's stable key (`transactionKeys`). A link makes both sides `transfer` — also the
 * counter-booking, which may sit in another file.
 */
export function applyTransactionEdits(
  bookings: readonly Booking[],
  keyOf: (booking: Booking) => string,
  edits: readonly TransactionEdit[],
): EditedBookings {
  if (edits.length === 0) {
    return { bookings, hidden: [], effects: new Map() };
  }
  const states = foldEdits(edits);
  /** key → the key it is linked with (both directions). */
  const links = new Map<string, string>();
  for (const [from, state] of [...states.entries()].sort(([a], [b]) =>
    compareText(a, b),
  )) {
    if (state.linkedKey) {
      links.set(from, state.linkedKey);
      if (!links.has(state.linkedKey)) links.set(state.linkedKey, from);
    }
  }
  const out: Booking[] = [];
  const hidden: Booking[] = [];
  const effects = new Map<string, TransactionEffect>();
  for (const booking of bookings) {
    const key = keyOf(booking);
    const state = states.get(key);
    const linkedKey = links.get(key) ?? null;
    if (!state && !linkedKey) {
      out.push(booking);
      continue;
    }
    const before: TransactionFields = {
      kind: booking.kind,
      asset: booking.asset,
      note: booking.note ?? null,
    };
    const after: TransactionFields = {
      kind: linkedKey ? 'transfer' : (state?.kind ?? booking.kind),
      asset: state?.asset ?? booking.asset,
      note: state?.note ?? booking.note ?? null,
    };
    const isHidden = state?.hidden === true;
    effects.set(booking.id, {
      key,
      editIds: state?.editIds ?? [],
      before,
      after,
      hidden: isHidden,
      linkedKey,
    });
    if (isHidden) {
      hidden.push(booking);
      continue;
    }
    out.push({
      ...booking,
      kind: after.kind,
      asset: after.asset,
      feeAsset: booking.feeAsset === after.asset ? undefined : booking.feeAsset,
      note: after.note ?? undefined,
    });
  }
  return { bookings: out, hidden, effects };
}
