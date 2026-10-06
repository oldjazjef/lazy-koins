import { z } from 'zod';
import { BOOKING_KINDS, CorrectionDataSchema } from '@lazykoins/engine';
import type { ResultView } from '../../calculation/application/calculation.handlers';
import { type AnyTool, defineTool, type ToolPreview } from '../domain/tool';
import {
  capped,
  decimalText,
  figureLink,
  fileLink,
  id,
  isoDate,
  limit,
  link,
  projectId,
  projectLink,
  reason,
  type ToolServices,
} from './common';

const snapshotOut = z
  .object({ calculatedAt: z.string(), stale: z.boolean() })
  .nullable();

function snapshotOf(view: ResultView) {
  return view.snapshot
    ? { calculatedAt: view.snapshot.createdAt, stale: view.stale }
    : null;
}

const positionOut = z.object({
  figureId: z.string(),
  platform: z.string(),
  accountId: z.string(),
  asset: z.string(),
  quantity: z.string(),
  quantitySource: z.string(),
  priceChf: z.string().nullable(),
  priceOrigin: z.string().nullable(),
  priceSource: z.string().nullable(),
  priceDate: z.string().nullable(),
  valueChf: z.string().nullable(),
  status: z.string(),
  link,
});

const incomeOut = z.object({
  figureId: z.string(),
  date: z.string(),
  platform: z.string(),
  kind: z.string(),
  category: z.string(),
  asset: z.string(),
  quantityNet: z.string(),
  priceChf: z.string().nullable(),
  valueChf: z.string().nullable(),
  priceSource: z.string().nullable(),
  status: z.string(),
  link,
});

const correctionOut = z.object({
  id: z.string(),
  type: z.string(),
  reason: z.string(),
  createdAt: z.string(),
  undone: z.boolean(),
  data: z.record(z.string(), z.unknown()),
});

function correctionOf(correction: {
  id: string;
  type: string;
  reason: string;
  createdAt: string;
  undoneAt: string | null;
  data: unknown;
}) {
  return {
    id: correction.id,
    type: correction.type,
    reason: correction.reason,
    createdAt: correction.createdAt,
    undone: correction.undoneAt !== null,
    data: correction.data as Record<string, unknown>,
  };
}

/** The result, checks and corrections of a project (F7, F8, F9). */
export function calculationTools(s: ToolServices): AnyTool[] {
  /** The price a position at `date` uses today — the "before" of an override. */
  async function priceBefore(
    userId: string,
    project: string,
    asset: string,
  ): Promise<string | null> {
    const view = await s.calculation.result(userId, project);
    const position = view.result?.positions.find(
      (p) => p.asset.toUpperCase() === asset.toUpperCase(),
    );
    if (!position) return null;
    return position.priceChf
      ? `${position.priceChf} CHF (${position.priceSource ?? position.priceOrigin ?? '–'})`
      : 'kein Kurs';
  }

  async function correctionPreview(
    userId: string,
    project: string,
    data: z.output<typeof CorrectionDataSchema>,
    why: string,
  ): Promise<ToolPreview> {
    const reasonLine = { label: 'Begründung', before: null, after: why };
    switch (data.type) {
      case 'price_override':
        return {
          summary: `Kurs von ${data.asset} am ${data.date} überschreiben`,
          changes: [
            {
              label: `Kurs ${data.asset} (CHF)`,
              before: await priceBefore(userId, project, data.asset),
              after: `${data.priceChf} CHF (Override)`,
            },
            reasonLine,
          ],
          projectId: project,
        };
      case 'reclassify':
        return {
          summary: `Buchung ${data.bookingId} umklassieren`,
          changes: [
            { label: 'Art', before: null, after: data.kind },
            reasonLine,
          ],
          projectId: project,
        };
      case 'manual_booking':
        return {
          summary: `Manuelle Buchung ${data.booking.asset} auf ${data.booking.platform}`,
          changes: [
            {
              label: 'Buchung',
              before: null,
              after: `${data.booking.timestamp} ${data.booking.kind} ${data.booking.quantity} ${data.booking.asset}`,
            },
            reasonLine,
          ],
          projectId: project,
        };
      case 'manual_holding':
        return {
          summary: `Manueller Bestand ${data.holding.asset} auf ${data.holding.platform}`,
          changes: [
            {
              label: `Bestand per ${data.holding.asOf}`,
              before: null,
              after: `${data.holding.quantity} ${data.holding.asset}`,
            },
            reasonLine,
          ],
          projectId: project,
        };
    }
  }

  return [
    defineTool({
      name: 'calculate_project',
      title: 'Neu berechnen',
      description:
        'Recalculates a project from its files, corrections and stored rates and stores the result. Needed when get_result says stale.',
      area: 'results',
      effect: 'write',
      input: z.object({ projectId }),
      output: z.object({
        wealthChf: z.string(),
        incomeChf: z.string(),
        positions: z.number(),
        missingPrices: z.number(),
        openItems: z.number(),
        link,
      }),
      async run(ctx, input) {
        const view = await s.calculation.calculate(ctx.userId, input.projectId);
        const totals = view.result?.totals;
        return {
          wealthChf: totals?.wealthChf ?? '0',
          incomeChf: totals?.incomeChf ?? '0',
          positions: totals?.positions ?? 0,
          missingPrices: totals?.missingPrices ?? 0,
          openItems: totals?.openItems ?? 0,
          link: projectLink(input.projectId, 'result'),
        };
      },
    }),
    defineTool({
      name: 'get_result',
      title: 'Ergebnis',
      description:
        'The latest result of a project: wealth at 31.12. and income in CHF, totals per platform and income category, counts of missing prices and open items, the USD/CHF and EUR/CHF used, and whether it is stale (data changed since). Use list_positions / list_income for details.',
      area: 'results',
      effect: 'readOnly',
      input: z.object({ projectId }),
      output: z.object({
        snapshot: snapshotOut,
        taxYear: z.number().nullable(),
        wealthChf: z.string().nullable(),
        incomeChf: z.string().nullable(),
        positions: z.number(),
        missingPrices: z.number(),
        openItems: z.number(),
        usdChf: z.string().nullable(),
        eurChf: z.string().nullable(),
        platforms: z.array(
          z.object({
            figureId: z.string(),
            platform: z.string(),
            valueChf: z.string(),
            missingPrices: z.number(),
          }),
        ),
        categories: z.array(
          z.object({
            figureId: z.string(),
            category: z.string(),
            valueChf: z.string(),
            missingPrices: z.number(),
          }),
        ),
        link,
      }),
      async run(ctx, input) {
        const view = await s.calculation.result(ctx.userId, input.projectId);
        const result = view.result;
        return {
          snapshot: snapshotOf(view),
          taxYear: result?.taxYear ?? null,
          wealthChf: result?.totals.wealthChf ?? null,
          incomeChf: result?.totals.incomeChf ?? null,
          positions: result?.totals.positions ?? 0,
          missingPrices: result?.totals.missingPrices ?? 0,
          openItems: result?.totals.openItems ?? 0,
          usdChf: result?.parameters.usdChf ?? null,
          eurChf: result?.parameters.eurChf ?? null,
          platforms: (result?.platforms ?? []).map((p) => ({
            figureId: p.id,
            platform: p.platform,
            valueChf: p.valueChf,
            missingPrices: p.missingPrices,
          })),
          categories: (result?.categories ?? []).map((c) => ({
            figureId: c.id,
            category: c.category,
            valueChf: c.valueChf,
            missingPrices: c.missingPrices,
          })),
          link: projectLink(input.projectId, 'result'),
        };
      },
    }),
    defineTool({
      name: 'list_positions',
      title: 'Positionen per 31.12.',
      description:
        'Positions at 31.12. of the latest result, filtered by asset / platform / status (ok | missingPrice | spam | negative): quantity, CHF price used with its origin and source, value. Each has a figureId for get_figure_records and a link.',
      area: 'results',
      effect: 'readOnly',
      input: z.object({
        projectId,
        asset: z.string().trim().max(40).optional(),
        platform: z.string().trim().max(80).optional(),
        status: z.enum(['ok', 'missingPrice', 'spam', 'negative']).optional(),
        limit: limit(25, 100),
      }),
      output: z.object({
        snapshot: snapshotOut,
        total: z.number(),
        truncated: z.boolean(),
        positions: z.array(positionOut),
      }),
      async run(ctx, input) {
        const view = await s.calculation.result(ctx.userId, input.projectId);
        const rows = (view.result?.positions ?? []).filter(
          (p) =>
            (!input.asset ||
              p.asset.toUpperCase() === input.asset.toUpperCase()) &&
            (!input.platform ||
              p.platform.toLowerCase() === input.platform.toLowerCase()) &&
            (!input.status || p.status === input.status),
        );
        const list = capped(rows, input.limit);
        return {
          snapshot: snapshotOf(view),
          total: list.total,
          truncated: list.truncated,
          positions: list.items.map((p) => ({
            figureId: p.id,
            platform: p.platform,
            accountId: p.accountId,
            asset: p.asset,
            quantity: p.quantity,
            quantitySource: p.quantitySource,
            priceChf: p.priceChf,
            priceOrigin: p.priceOrigin,
            priceSource: p.priceSource,
            priceDate: p.priceDate,
            valueChf: p.valueChf,
            status: p.status,
            link: figureLink(input.projectId, p.id),
          })),
        };
      },
    }),
    defineTool({
      name: 'list_income',
      title: 'Erträge',
      description:
        'Income lines of the latest result (staking, lending, airdrops …), filtered by asset / category / status: date, net quantity, CHF value and price source. Each has a figureId and a link.',
      area: 'results',
      effect: 'readOnly',
      input: z.object({
        projectId,
        asset: z.string().trim().max(40).optional(),
        category: z.string().trim().max(40).optional(),
        status: z.enum(['ok', 'missingPrice', 'spam']).optional(),
        limit: limit(25, 100),
      }),
      output: z.object({
        snapshot: snapshotOut,
        total: z.number(),
        truncated: z.boolean(),
        income: z.array(incomeOut),
      }),
      async run(ctx, input) {
        const view = await s.calculation.result(ctx.userId, input.projectId);
        const rows = (view.result?.income ?? []).filter(
          (l) =>
            (!input.asset ||
              l.asset.toUpperCase() === input.asset.toUpperCase()) &&
            (!input.category || l.category === input.category) &&
            (!input.status || l.status === input.status),
        );
        const list = capped(rows, input.limit);
        return {
          snapshot: snapshotOf(view),
          total: list.total,
          truncated: list.truncated,
          income: list.items.map((l) => ({
            figureId: l.id,
            date: l.date,
            platform: l.platform,
            kind: l.kind,
            category: l.category,
            asset: l.asset,
            quantityNet: l.quantityNet,
            priceChf: l.priceChf,
            valueChf: l.valueChf,
            priceSource: l.priceSource,
            status: l.status,
            link: figureLink(input.projectId, l.id),
          })),
        };
      },
    }),
    defineTool({
      name: 'get_figure_records',
      title: 'Rückverfolgung',
      description:
        'F7.5 drill-down: the bookings/holdings behind a figure (figureId from list_positions, list_income, get_result, or an open item key) with file name, row number and a link to the file. `includeRaw` adds the original row (only when needed).',
      area: 'results',
      effect: 'readOnly',
      input: z.object({
        projectId,
        figureId: z.string().min(1).max(400),
        limit: limit(20, 100),
        includeRaw: z.boolean().default(false),
      }),
      output: z.object({
        figureId: z.string(),
        total: z.number(),
        records: z.array(
          z.object({
            id: z.string(),
            type: z.string(),
            fileName: z.string().nullable(),
            row: z.number(),
            platform: z.string(),
            accountId: z.string(),
            asset: z.string(),
            quantity: z.string(),
            at: z.string(),
            kind: z.string().nullable(),
            rawType: z.string().nullable(),
            correctionId: z.string().nullable(),
            raw: z.record(z.string(), z.string()).nullable(),
            link: link.nullable(),
          }),
        ),
        link,
      }),
      async run(ctx, input) {
        const found = await s.calculation.figureRecords(
          ctx.userId,
          input.projectId,
          input.figureId,
        );
        return {
          figureId: found.figureId,
          total: found.total,
          records: found.records.slice(0, input.limit).map((r) => ({
            id: r.id,
            type: r.type,
            fileName: r.fileName,
            row: r.row,
            platform: r.platform,
            accountId: r.accountId,
            asset: r.asset,
            quantity: r.quantity,
            at: r.at,
            kind: r.kind,
            rawType: r.rawType,
            correctionId: r.correctionId,
            raw: input.includeRaw && r.raw ? { ...r.raw } : null,
            link: r.projectFileId
              ? fileLink(input.projectId, r.projectFileId)
              : null,
          })),
          link: figureLink(input.projectId, input.figureId),
        };
      },
    }),
    defineTool({
      name: 'get_checks',
      title: 'Prüfungen',
      description:
        'F8: the checks with their traffic light (green | yellow | red | grey) and the open items (key, reason, platform/asset/date, params, CHF impact, done + note). Reasons like positionWithoutPrice explain a missing price.',
      area: 'checks',
      effect: 'readOnly',
      input: z.object({ projectId, limit: limit(30, 200) }),
      output: z.object({
        calculated: z.boolean(),
        checks: z.array(
          z.object({
            kind: z.string(),
            light: z.string(),
            items: z.number(),
            impactChf: z.string(),
          }),
        ),
        total: z.number(),
        items: z.array(
          z.object({
            key: z.string(),
            check: z.string(),
            reason: z.string(),
            light: z.string(),
            platform: z.string().nullable(),
            accountId: z.string().nullable(),
            asset: z.string().nullable(),
            date: z.string().nullable(),
            params: z.record(z.string(), z.string()),
            impactChf: z.string().nullable(),
            done: z.boolean(),
            note: z.string(),
          }),
        ),
        link,
      }),
      async run(ctx, input) {
        const view = await s.calculation.checks(ctx.userId, input.projectId);
        const list = capped(view.items, input.limit);
        return {
          calculated: view.snapshot !== null,
          checks: view.checks.map((c) => ({ ...c })),
          total: list.total,
          items: list.items.map((item) => ({
            key: item.key,
            check: item.check,
            reason: item.reason,
            light: item.light,
            platform: item.platform,
            accountId: item.accountId,
            asset: item.asset,
            date: item.date,
            params: { ...item.params },
            impactChf: item.impactChf,
            done: item.done,
            note: item.note,
          })),
          link: projectLink(input.projectId, 'checks'),
        };
      },
    }),
    defineTool({
      name: 'update_open_item',
      title: 'Offenen Punkt abhaken',
      description:
        'Ticks an open item (key from get_checks) as done or not, with an optional note.',
      area: 'checks',
      effect: 'write',
      input: z.object({
        projectId,
        key: z.string().min(1).max(600),
        done: z.boolean().optional(),
        note: z.string().max(2000).optional(),
      }),
      output: z.object({
        key: z.string(),
        done: z.boolean(),
        note: z.string(),
      }),
      async run(ctx, input) {
        const state = await s.calculation.updateOpenItem(
          ctx.userId,
          input.projectId,
          input.key,
          { done: input.done, note: input.note },
        );
        return { key: state.itemKey, done: state.done, note: state.note };
      },
      async preview(ctx, input) {
        const view = await s.calculation.checks(ctx.userId, input.projectId);
        const item = view.items.find((i) => i.key === input.key);
        return {
          summary: `Offenen Punkt ${item?.reason ?? input.key} bearbeiten`,
          changes: [
            ...(input.done !== undefined
              ? [
                  {
                    label: 'Erledigt',
                    before: item ? String(item.done) : null,
                    after: String(input.done),
                  },
                ]
              : []),
            ...(input.note !== undefined
              ? [
                  {
                    label: 'Notiz',
                    before: item?.note || null,
                    after: input.note,
                  },
                ]
              : []),
          ],
          projectId: input.projectId,
        };
      },
    }),
    defineTool({
      name: 'list_corrections',
      title: 'Korrekturen',
      description:
        'F9: the corrections of a project (price overrides, reclassifications, manual bookings/holdings) with reason, date and whether they are undone.',
      area: 'corrections',
      effect: 'readOnly',
      input: z.object({ projectId }),
      output: z.object({ corrections: z.array(correctionOut), link }),
      async run(ctx, input) {
        const list = await s.calculation.corrections(
          ctx.userId,
          input.projectId,
        );
        return {
          corrections: list.map(correctionOf),
          link: projectLink(input.projectId, 'corrections'),
        };
      },
    }),
    defineTool({
      name: 'set_price_override',
      title: 'Kurs überschreiben',
      description:
        'F9.1: overrides the CHF price of an asset on a day (a position at 31.12. → the date 31.12. of the tax year; an income day → that day). Stored as a correction with a reason; recalculate afterwards.',
      area: 'corrections',
      effect: 'write',
      input: z.object({
        projectId,
        asset: z.string().trim().min(1).max(40),
        date: isoDate,
        priceChf: decimalText,
        reason,
      }),
      output: correctionOut,
      async run(ctx, input) {
        return correctionOf(
          await s.calculation.createCorrection(
            ctx.userId,
            input.projectId,
            {
              type: 'price_override',
              asset: input.asset,
              date: input.date,
              priceChf: input.priceChf,
            },
            input.reason,
          ),
        );
      },
      async preview(ctx, input) {
        return correctionPreview(
          ctx.userId,
          input.projectId,
          {
            type: 'price_override',
            asset: input.asset.toUpperCase(),
            date: input.date,
            priceChf: input.priceChf,
          },
          input.reason,
        );
      },
    }),
    defineTool({
      name: 'reclassify_booking',
      title: 'Buchung umklassieren',
      description: `F9.2: gives one booking (its record id from get_figure_records) another kind: ${BOOKING_KINDS.join(', ')}.`,
      area: 'corrections',
      effect: 'write',
      input: z.object({
        projectId,
        bookingId: z.string().min(1).max(200),
        kind: z.enum(BOOKING_KINDS),
        reason,
      }),
      output: correctionOut,
      async run(ctx, input) {
        return correctionOf(
          await s.calculation.createCorrection(
            ctx.userId,
            input.projectId,
            {
              type: 'reclassify',
              bookingId: input.bookingId,
              kind: input.kind,
            },
            input.reason,
          ),
        );
      },
      async preview(ctx, input) {
        return correctionPreview(
          ctx.userId,
          input.projectId,
          { type: 'reclassify', bookingId: input.bookingId, kind: input.kind },
          input.reason,
        );
      },
    }),
    defineTool({
      name: 'create_correction',
      title: 'Korrektur erfassen',
      description:
        'F9.3: any correction — manual_booking (a forgotten booking, hard fork, loss) or manual_holding (a balance at a date with its evidence), also price_override / reclassify. `correction` follows the correction schema.',
      area: 'corrections',
      effect: 'write',
      input: z.object({ projectId, correction: CorrectionDataSchema, reason }),
      output: correctionOut,
      async run(ctx, input) {
        return correctionOf(
          await s.calculation.createCorrection(
            ctx.userId,
            input.projectId,
            input.correction,
            input.reason,
          ),
        );
      },
      async preview(ctx, input) {
        return correctionPreview(
          ctx.userId,
          input.projectId,
          input.correction,
          input.reason,
        );
      },
    }),
    defineTool({
      name: 'undo_correction',
      title: 'Korrektur rückgängig',
      description:
        'Undoes a correction (or redoes it with undo = false). The history stays.',
      area: 'corrections',
      effect: 'write',
      input: z.object({
        projectId,
        correctionId: id('correction'),
        undo: z.boolean().default(true),
      }),
      output: correctionOut,
      async run(ctx, input) {
        return correctionOf(
          await s.calculation.setUndone(
            ctx.userId,
            input.projectId,
            input.correctionId,
            input.undo,
          ),
        );
      },
    }),
  ];
}
