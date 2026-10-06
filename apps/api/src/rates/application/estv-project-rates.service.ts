import { Injectable } from '@nestjs/common';
import {
  assetsNeedingPrices,
  calculate,
  type CalculationResult,
  type CountryRules,
} from '@lazykoins/engine';
import { CalculationInputService } from '../../calculation/application/calculation-input.service';
import type { Project } from '../../projects/domain/project';
import {
  ESTV_LABEL_PREFIX,
  type EstvCandidate,
  estvProjectRates,
  estvSourceLabel,
  matchEstvAssets,
} from '../domain/estv';
import { COINGECKO_IDS, RATE_ALIASES } from '../domain/project-rate';
import { EstvKurslisteRepositoryPort } from '../ports/estv.port';
import { ProjectRateRepositoryPort } from '../ports/project-rate.repository.port';

/** What applying the stored Kursliste to a project did (shown after "Kurse aktualisieren"). */
export interface EstvApplySummary {
  readonly year: number;
  /** `ESTV-Kursliste 2025, Stand 02.10.2026`; `null` when no list of that year is stored. */
  readonly label: string | null;
  readonly matched: readonly {
    readonly asset: string;
    readonly symbol: string;
    readonly name: string;
    readonly value: string;
  }[];
  /** Several Kursliste entries fit: no value, set an override (open item suggestion). */
  readonly ambiguous: readonly {
    readonly asset: string;
    readonly candidates: readonly EstvCandidate[];
  }[];
  /** Year-end exchange rates taken (USD, EUR). */
  readonly fx: readonly string[];
}

/** The assets of a calculation the Kursliste can value: priced assets and stablecoins. */
export function estvAssetsOf(
  result: CalculationResult,
  rules: CountryRules,
): string[] {
  const assets = new Set(assetsNeedingPrices(result, rules));
  for (const position of result.positions) {
    if (position.status !== 'spam' && rules.usdPegged.includes(position.asset))
      assets.add(position.asset);
  }
  return [...assets].sort();
}

/**
 * Writes the stored Kursliste of the project's tax year into its rates (F7.4a): every matched
 * asset's value at 31.12. and the year-end USD/EUR rates, as `estv` with the version's label.
 * Automatic rows of an older version that no longer match are removed; a newer version simply
 * changes the values — the snapshot turns stale through the input hash. Local data only: no
 * network, so it works with rate lookups off too.
 */
@Injectable()
export class EstvProjectRatesService {
  constructor(
    private readonly store: EstvKurslisteRepositoryPort,
    private readonly rates: ProjectRateRepositoryPort,
    private readonly inputs: CalculationInputService,
  ) {}

  /** Applies the list; `assets` defaults to the project's own (one calculation). */
  async apply(
    project: Project,
    options: {
      readonly assets?: readonly string[];
      readonly coingeckoIds?: Readonly<Record<string, string>>;
    } = {},
  ): Promise<EstvApplySummary> {
    const year = project.taxYear;
    const version = await this.store.findVersion(year);
    const existing = (await this.rates.listByProject(project.id)).filter(
      (r) => r.source === 'estv' && r.note?.startsWith(ESTV_LABEL_PREFIX),
    );
    if (!version) {
      return { year, label: null, matched: [], ambiguous: [], fx: [] };
    }
    let assets = options.assets;
    if (!assets) {
      const assembled = await this.inputs.build(project);
      assets = estvAssetsOf(calculate(assembled.input), assembled.input.rules);
    }
    const list = await this.store.listRates(year);
    const knownNames = { ...COINGECKO_IDS, ...(options.coingeckoIds ?? {}) };
    const match = matchEstvAssets(assets, list, {
      knownNames,
      extraAliases: RATE_ALIASES,
    });
    const entries = estvProjectRates(year, version, match.matched, list);
    const keyOf = (r: {
      kind: string;
      asset: string;
      currency: string;
      date: string;
    }) => `${r.kind}|${r.asset}|${r.currency}|${r.date}`;
    const keep = new Set(entries.map(keyOf));
    for (const old of existing) {
      if (!keep.has(keyOf(old))) {
        await this.rates.delete(project.id, {
          kind: old.kind,
          asset: old.asset,
          currency: old.currency,
          date: old.date,
          source: 'estv',
        });
      }
    }
    await this.rates.upsertMany(project.id, entries);
    return {
      year,
      label: estvSourceLabel(year, version.exportDate),
      matched: match.matched.map(({ asset, rate }) => ({
        asset,
        symbol: rate.symbol,
        name: rate.name,
        value: rate.value,
      })),
      ambiguous: match.ambiguous,
      fx: entries.filter((e) => e.kind === 'fx').map((e) => e.asset),
    };
  }
}
