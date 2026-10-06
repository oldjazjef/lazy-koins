import { z } from 'zod';
import type { RatesView } from '../../rates/application/rates.handlers';
import type { ProjectRate } from '../../rates/domain/project-rate';
import { type AnyTool, defineTool } from '../domain/tool';
import {
  capped,
  limit,
  link,
  projectId,
  projectLink,
  type ToolServices,
} from './common';

const rateOut = z.object({
  kind: z.string(),
  asset: z.string(),
  currency: z.string(),
  date: z.string(),
  value: z.string(),
  source: z.string(),
  note: z.string().nullable(),
});

function rateOf(rate: ProjectRate) {
  return {
    kind: rate.kind,
    asset: rate.asset,
    currency: rate.currency,
    date: rate.date,
    value: rate.value,
    source: rate.source,
    note: rate.note,
  };
}

/** Stored rates of a project (F7.4, F7.4a). */
export function rateTools(s: ToolServices): AnyTool[] {
  return [
    defineTool({
      name: 'list_rates',
      title: 'Kurse',
      description:
        "Stored rates of a project. With `asset`: that asset's prices (nearest to 31.12. first) with source (manual = override, estv, binance, coingecko, ecb …). Without: a summary — online lookups on/off, the series per asset with the year-end value, overrides/ESTV rows and the ESTV Kursliste status. An asset without any series has no price.",
      area: 'rates',
      effect: 'readOnly',
      input: z.object({
        projectId,
        asset: z.string().trim().min(1).max(40).optional(),
        limit: limit(30, 200),
      }),
      output: z.object({
        online: z.boolean().nullable(),
        taxYear: z.number().nullable(),
        series: z.array(
          z.object({
            kind: z.string(),
            asset: z.string(),
            currency: z.string(),
            source: z.string(),
            points: z.number(),
            from: z.string(),
            to: z.string(),
            yearEnd: z
              .object({ date: z.string(), value: z.string() })
              .nullable(),
          }),
        ),
        rates: z.array(rateOut),
        total: z.number(),
        estv: z
          .object({
            available: z.string().nullable(),
            applied: z.string().nullable(),
            outdated: z.boolean(),
          })
          .nullable(),
        link,
      }),
      async run(ctx, input) {
        const answer = await s.rates.list(
          ctx.userId,
          input.projectId,
          input.asset?.toUpperCase(),
        );
        const tab = projectLink(input.projectId, 'rates');
        if (Array.isArray(answer)) {
          const rates = answer as ProjectRate[];
          const sorted = [...rates].sort((a, b) =>
            a.date === b.date ? 0 : a.date < b.date ? 1 : -1,
          );
          const list = capped(sorted, input.limit);
          return {
            online: null,
            taxYear: null,
            series: [],
            rates: list.items.map(rateOf),
            total: list.total,
            estv: null,
            link: tab,
          };
        }
        const view = answer as RatesView;
        const manual = capped(view.manual, input.limit);
        return {
          online: view.online,
          taxYear: view.taxYear,
          series: view.series.map((series) => ({
            kind: series.kind,
            asset: series.asset,
            currency: series.currency,
            source: series.source,
            points: series.points,
            from: series.from,
            to: series.to,
            yearEnd: series.yearEnd,
          })),
          rates: manual.items.map(rateOf),
          total: manual.total,
          estv: {
            available: view.estv.available,
            applied: view.estv.applied,
            outdated: view.estv.outdated,
          },
          link: tab,
        };
      },
    }),
    defineTool({
      name: 'refresh_rates',
      title: 'Kurse aktualisieren',
      description:
        'Applies the stored ESTV Kursliste, then fetches missing prices and exchange rates from the internet (refused when online lookups are off). Can take a while.',
      area: 'rates',
      effect: 'write',
      input: z.object({ projectId, force: z.boolean().default(false) }),
      output: z.object({
        fx: z.number(),
        assets: z.array(
          z.object({
            asset: z.string(),
            status: z.string(),
            source: z.string().nullable(),
            points: z.number(),
          }),
        ),
      }),
      async run(ctx, input) {
        const summary = await s.rates.refresh(
          ctx.userId,
          input.projectId,
          input.force,
        );
        return {
          fx: summary.fx,
          assets: summary.assets.map((a) => ({ ...a })),
        };
      },
    }),
    defineTool({
      name: 'apply_estv_rates',
      title: 'ESTV-Kurse übernehmen',
      description:
        'Applies the stored ESTV Kursliste of the tax year to the project (no internet needed).',
      area: 'rates',
      effect: 'write',
      input: z.object({ projectId }),
      output: z.object({
        label: z.string().nullable(),
        matched: z.number(),
      }),
      async run(ctx, input) {
        const summary = await s.rates.applyEstv(ctx.userId, input.projectId);
        return { label: summary.label, matched: summary.matched.length };
      },
    }),
  ];
}
