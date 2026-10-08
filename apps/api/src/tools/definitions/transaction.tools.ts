import { z } from 'zod';
import { BOOKING_KINDS, TransactionChangesSchema } from '@lazykoins/engine';
import type { TransactionView } from '../../transactions/application/transactions.handlers';
import type { TransactionsService } from '../../transactions/transactions.service';
import { type AnyTool, defineTool, type ToolChange } from '../domain/tool';
import { enumText, previewText, yesNo } from '../domain/preview-texts';
import { id, isoDate, limit, reason } from './common';

/** The stable transaction key (F9.8) — from search_transactions / list_transactions. */
const key = z
  .string()
  .trim()
  .min(1)
  .max(300)
  .describe(
    'The stable transaction key (from search_transactions or list_transactions).',
  );

const transactionOut = z.object({
  key: z.string(),
  timestamp: z.string(),
  platform: z.string(),
  accountId: z.string(),
  kind: z.string(),
  originalKind: z.string().nullable(),
  asset: z.string(),
  originalAsset: z.string().nullable(),
  quantity: z.string(),
  fee: z.string().nullable(),
  feeAsset: z.string().nullable(),
  value: z.string().nullable(),
  group: z.string().nullable(),
  note: z.string().nullable(),
  rawType: z.string(),
  fileName: z.string(),
  row: z.number(),
  status: z.string(),
  hidden: z.boolean(),
  linkedKey: z.string().nullable(),
  /** Closed projects that use it (F9.9: unlock them to change it). */
  lockedBy: z.array(z.string()),
  projects: z.array(z.string()),
  link: z.string(),
});

function transactionOf(t: TransactionView): z.infer<typeof transactionOut> {
  return {
    key: t.key,
    timestamp: t.timestamp,
    platform: t.platform,
    accountId: t.accountId,
    kind: t.kind,
    originalKind: t.originalKind,
    asset: t.asset,
    originalAsset: t.originalAsset,
    quantity: t.quantity,
    fee: t.fee,
    feeAsset: t.feeAsset,
    value: t.value,
    group: t.group,
    note: t.note,
    rawType: t.rawType,
    fileName: t.source.fileName,
    row: t.source.row,
    status: t.status,
    hidden: t.hidden,
    linkedKey: t.linkedKey,
    lockedBy: t.lockedBy.map((p) => `${p.name} ${p.taxYear}`),
    projects: t.projects.map((p) => `${p.name} ${p.taxYear}`),
    link: `/app/transactions?key=${encodeURIComponent(t.key)}`,
  };
}

const editOut = z.object({
  edited: z.number(),
  projectIds: z.array(z.string()),
});

const changes = TransactionChangesSchema.describe(
  `What to change (global: every project that uses the transaction): kind (${BOOKING_KINDS.join(', ')}), asset, note, hidden (true = left out of every calculation, false = back in), linkedKey (the counter-booking of a move between own accounts — both become transfers; null = unlink).`,
);

/**
 * F9.12: the global transaction list and its edits (F9.5–F9.9) for the chat and MCP — strictly
 * the user's own (the services take the user from the context).
 */
export function transactionTools(t: TransactionsService): AnyTool[] {
  async function editPreview(
    userId: string,
    keys: readonly string[],
    input: z.output<typeof TransactionChangesSchema>,
    why: string,
  ) {
    const first = keys[0]
      ? (await t.detail(userId, keys[0])).transaction
      : undefined;
    const lines: ToolChange[] = [];
    if (input.kind !== undefined) {
      lines.push({
        label: previewText('chat.preview.label.kind'),
        before:
          first && keys.length === 1
            ? enumText('bookingKind', first.kind)
            : null,
        after: enumText('bookingKind', input.kind),
      });
    }
    if (input.asset !== undefined) {
      lines.push({
        label: previewText('chat.preview.label.asset'),
        before: first && keys.length === 1 ? first.asset : null,
        after: input.asset,
      });
    }
    if (input.note !== undefined) {
      lines.push({
        label: previewText('chat.preview.label.note'),
        before: first && keys.length === 1 ? first.note : null,
        after: input.note,
      });
    }
    if (input.hidden !== undefined) {
      lines.push({
        label: previewText('chat.preview.label.hidden'),
        before: first && keys.length === 1 ? yesNo(first.hidden) : null,
        after: yesNo(input.hidden),
      });
    }
    if (input.linkedKey !== undefined) {
      lines.push({
        label: previewText('chat.preview.label.link'),
        before: first && keys.length === 1 ? first.linkedKey : null,
        after: input.linkedKey,
      });
    }
    lines.push({
      label: previewText('chat.preview.label.reason'),
      before: null,
      after: why,
    });
    return {
      summary: previewText('chat.preview.editTransactions', {
        count: keys.length,
      }),
      changes: lines,
    };
  }

  return [
    defineTool({
      name: 'search_transactions',
      title: 'Transaktionen suchen',
      description:
        'Every transaction of the user across all files and wallets (F9.5), newest first: kind, asset, signed quantity, value in the tax currency, platform type, source file + row, status original | changed | aiSuggested, hidden, the projects using it and the closed ones that lock it. Filter by period, platform, account, asset, kind, changed only, review (unknown / AI-suggested), wallet and words (asset, reference, note, platform type).',
      area: 'results',
      effect: 'readOnly',
      input: z.object({
        from: isoDate.optional(),
        to: isoDate.optional(),
        platform: z.string().trim().max(80).optional(),
        account: z.string().trim().max(80).optional(),
        asset: z.string().trim().max(40).optional(),
        kind: z.enum(BOOKING_KINDS).optional(),
        changed: z.boolean().optional(),
        review: z.boolean().optional(),
        walletId: id('wallet').optional(),
        q: z.string().trim().max(200).optional(),
        limit: limit(25, 100),
      }),
      output: z.object({
        currency: z.string(),
        total: z.number(),
        truncated: z.boolean(),
        transactions: z.array(transactionOut),
      }),
      async run(ctx, input) {
        const { limit: size, ...filter } = input;
        const view = await t.list(ctx.userId, { ...filter, limit: size });
        return {
          currency: view.currency,
          total: view.total,
          truncated: view.total > view.rows.length,
          transactions: view.rows.map(transactionOf),
        };
      },
    }),
    defineTool({
      name: 'get_transaction',
      title: 'Transaktion anzeigen',
      description:
        'One transaction with its original file row (F7.5) and the history of its global edits (reason, source user | ai | migrated, status active | undone | superseded).',
      area: 'results',
      effect: 'readOnly',
      input: z.object({ key }),
      output: z.object({
        transaction: transactionOut,
        raw: z.record(z.string(), z.string()).nullable(),
        history: z.array(
          z.object({
            id: z.string(),
            changes: z.record(z.string(), z.unknown()),
            reason: z.string(),
            source: z.string(),
            status: z.string(),
            origin: z.string().nullable(),
            createdAt: z.string(),
          }),
        ),
        linked: transactionOut.nullable(),
      }),
      async run(ctx, input) {
        const detail = await t.detail(ctx.userId, input.key);
        return {
          transaction: transactionOf(detail.transaction),
          raw: detail.raw ? { ...detail.raw } : null,
          history: detail.history.map((h) => ({
            id: h.id,
            changes: { ...h.changes },
            reason: h.reason,
            source: h.source,
            status: h.status,
            origin: h.origin,
            createdAt: h.createdAt,
          })),
          linked: detail.linked ? transactionOf(detail.linked) : null,
        };
      },
    }),
    defineTool({
      name: 'edit_transactions',
      title: 'Transaktionen ändern',
      description:
        'F9.8: changes one or several transactions globally (every project that uses them; the files stay untouched) — kind, asset, note, hide, link with the counter-booking — with a reason, undoable. Refused while a closed project uses one (F9.9).',
      area: 'corrections',
      effect: 'write',
      input: z.object({
        keys: z.array(key).min(1).max(100),
        changes,
        reason,
      }),
      output: editOut,
      async run(ctx, input) {
        const result = await t.edit(
          ctx.userId,
          input.keys,
          input.changes,
          input.reason,
        );
        return { edited: result.edited, projectIds: [...result.projectIds] };
      },
      async preview(ctx, input) {
        return editPreview(ctx.userId, input.keys, input.changes, input.reason);
      },
    }),
    defineTool({
      name: 'reclassify_booking',
      title: 'Buchung umklassieren',
      description: `F9.2/F9.8: gives one transaction another kind (${BOOKING_KINDS.join(', ')}) — globally, in every project that uses it. The key comes from list_transactions or search_transactions.`,
      area: 'corrections',
      effect: 'write',
      input: z.object({ key, kind: z.enum(BOOKING_KINDS), reason }),
      output: editOut,
      async run(ctx, input) {
        const result = await t.edit(
          ctx.userId,
          [input.key],
          { kind: input.kind },
          input.reason,
        );
        return { edited: result.edited, projectIds: [...result.projectIds] };
      },
      async preview(ctx, input) {
        return editPreview(
          ctx.userId,
          [input.key],
          { kind: input.kind },
          input.reason,
        );
      },
    }),
    defineTool({
      name: 'exclude_booking',
      title: 'Buchung ausblenden',
      description:
        'Leaves one transaction out of every calculation (a duplicate, a test transfer, a row that does not belong to the user) — a global edit with a reason, undoable with undo_transaction_edit; the file is not changed. The key comes from list_transactions or search_transactions.',
      area: 'corrections',
      effect: 'write',
      input: z.object({ key, reason }),
      output: editOut,
      async run(ctx, input) {
        const result = await t.edit(
          ctx.userId,
          [input.key],
          { hidden: true },
          input.reason,
        );
        return { edited: result.edited, projectIds: [...result.projectIds] };
      },
      async preview(ctx, input) {
        return editPreview(
          ctx.userId,
          [input.key],
          { hidden: true },
          input.reason,
        );
      },
    }),
    defineTool({
      name: 'undo_transaction_edit',
      title: 'Transaktions-Änderung rückgängig',
      description:
        'Undoes a global transaction edit (its id from get_transaction), or redoes it with undo = false — also a superseded one from the move of project corrections.',
      area: 'corrections',
      effect: 'write',
      input: z.object({ editId: id('edit'), undo: z.boolean().default(true) }),
      output: z.object({ id: z.string(), status: z.string() }),
      async run(ctx, input) {
        const edit = await t.setUndone(ctx.userId, input.editId, input.undo);
        return { id: edit.id, status: edit.status };
      },
    }),
  ];
}
