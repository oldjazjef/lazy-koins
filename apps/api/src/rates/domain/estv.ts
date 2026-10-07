import type { RateEntry } from '@lazykoins/engine';

/**
 * The ESTV Kursliste (ICTax), downloaded automatically (F7.4a). Hand-written domain types and
 * the pure rules: which export to take, when an export is newer, the source label and how a
 * project's assets are matched to Kursliste entries. No network, no clock, no Prisma.
 */

/** What lazy-koins keeps of a Kursliste entry. */
export const ESTV_RATE_KINDS = ['crypto', 'currency', 'fx'] as const;
export type EstvRateKind = (typeof ESTV_RATE_KINDS)[number];

/** One year-end value: CHF per unit of `symbol`. */
export interface EstvRate {
  readonly kind: EstvRateKind;
  /** The ICTax entity id; `null` for exchange rates. */
  readonly ictaxId: string | null;
  /** The ticker (`securityAppendix`, e.g. BTC) or the ISO currency (USD). */
  readonly symbol: string;
  /** e.g. "Bitcoin"; the ISO code for exchange rates. */
  readonly name: string;
  readonly valorNumber: string | null;
  readonly isin: string | null;
  /** Decimal string, CHF per unit (already divided by the denomination). */
  readonly value: string;
}

/** One export as the ICTax API lists it (`xmls.json`). */
export interface EstvExport {
  /** e.g. `THIRD.INIT.220` (full list, schema 2.2.0) or `THIRD.DELTA.220`. */
  readonly exportType: string;
  /** ISO 8601. */
  readonly exportDate: string;
  readonly fileId: string;
  readonly fileHash: string;
  readonly fileName: string;
  /** Bytes of the ZIP, when the API says so. */
  readonly fileSize: number | null;
}

/** The stored version of one tax year (`estv_kursliste`). */
export interface EstvVersion {
  readonly year: number;
  readonly exportType: string;
  readonly exportDate: string;
  readonly fileHash: string;
  readonly fileName: string;
  /** XML namespace version, e.g. `2.2.0`. */
  readonly schemaVersion: string;
  readonly downloadedAt: string;
  readonly entryCount: number;
  readonly cryptoCount: number;
}

export const ESTV_CHECK_OUTCOMES = ['updated', 'current', 'failed'] as const;
export type EstvCheckOutcome = (typeof ESTV_CHECK_OUTCOMES)[number];

/** The last check for a newer version of one tax year (`estv_check`). */
export interface EstvCheck {
  readonly year: number;
  readonly checkedAt: string;
  readonly outcome: EstvCheckOutcome;
  readonly error: string | null;
}

const INIT_PREFIX = 'THIRD.INIT.';

function initVersion(exportType: string): number {
  if (!exportType.startsWith(INIT_PREFIX)) return -1;
  const suffix = exportType.slice(INIT_PREFIX.length);
  return /^\d+$/.test(suffix) ? Number(suffix) : -1;
}

/**
 * The export to download: a full list (`THIRD.INIT.<n>`, never a delta), the highest `<n>` (the
 * newest schema), and among those the newest `exportDate`. `undefined` when there is none.
 */
export function selectLatestInitialExport(
  exports: readonly EstvExport[],
): EstvExport | undefined {
  const full = exports.filter((e) => initVersion(e.exportType) >= 0);
  if (full.length === 0) return undefined;
  const highest = Math.max(...full.map((e) => initVersion(e.exportType)));
  return full
    .filter((e) => initVersion(e.exportType) === highest)
    .sort((a, b) =>
      a.exportDate < b.exportDate
        ? 1
        : a.exportDate > b.exportDate
          ? -1
          : a.fileHash < b.fileHash
            ? -1
            : 1,
    )[0];
}

/**
 * Whether `candidate` should replace the stored version: nothing stored yet, or another file that
 * is not older (the ESTV republishes the list after 31.03. too). The same file hash is current.
 */
export function isNewerExport(
  stored: Pick<EstvVersion, 'exportDate' | 'fileHash' | 'exportType'> | null,
  candidate: EstvExport,
): boolean {
  if (!stored) return true;
  if (stored.fileHash === candidate.fileHash) return false;
  if (initVersion(candidate.exportType) < initVersion(stored.exportType))
    return false;
  return candidate.exportDate >= stored.exportDate;
}

/** `02.10.2026` from an ISO timestamp (the day in UTC). */
export function swissDate(iso: string): string {
  const [year, month, day] = iso.slice(0, 10).split('-');
  return `${day}.${month}.${year}`;
}

/** The source label of an automatic ESTV value (F7.4a): `ESTV-Kursliste 2025, Stand 02.10.2026`. */
export function estvSourceLabel(year: number, exportDate: string): string {
  return `ESTV-Kursliste ${year}, Stand ${swissDate(exportDate)}`;
}

/** Labels written by the automatic import start with this (manual imports carry none). */
export const ESTV_LABEL_PREFIX = 'ESTV-Kursliste ';

/**
 * Project asset → Kursliste ticker where the ESTV uses another symbol than the exchanges, or
 * a renamed asset (FACHREGELN, Kurse). Tried after the asset's own symbol.
 */
export const ESTV_SYMBOL_ALIASES: Readonly<Record<string, readonly string[]>> =
  {
    IOTA: ['IOT'],
    MIOTA: ['IOT'],
    POL: ['MATIC'],
    MATIC: ['POL'],
    LUNA2: ['LUNA'],
    ETH2: ['ETH'],
  };

function normaliseName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]/g, '');
}

export interface EstvCandidate {
  readonly symbol: string;
  readonly name: string;
  readonly valorNumber: string | null;
}

/**
 * Why an asset got no ESTV value although the Kursliste has entries for its ticker:
 * `several` = several equally good entries; `coinMismatch` = the user chose a coin for the ticker
 * and no entry carries that coin's name; `ambiguousSymbol` = the ticker stands for several coins
 * (`AMBIGUOUS_SYMBOLS`) and no coin is chosen yet.
 */
export type EstvAmbiguity = 'several' | 'coinMismatch' | 'ambiguousSymbol';

export interface EstvMatchResult {
  /** Asset → the Kursliste entry it takes its 31.12. value from. */
  readonly matched: readonly { asset: string; rate: EstvRate }[];
  /** Assets with entries but no safe pick: no value, the user decides (coin / override). */
  readonly ambiguous: readonly {
    asset: string;
    reason: EstvAmbiguity;
    candidates: readonly EstvCandidate[];
  }[];
  /** Assets without an entry: the other sources apply (F7.4). */
  readonly unmatched: readonly string[];
}

/**
 * Matches a project's assets to the Kursliste's cryptocurrencies (and currency notes):
 *
 * 1. entries whose ticker is the asset (case-insensitive), then its aliases
 *    (`ESTV_SYMBOL_ALIASES`, then `extraAliases` such as the rate aliases);
 * 2. several entries for one ticker → the one whose name is the asset's known name
 *    (`knownNames`, e.g. the CoinGecko id `bitcoin` → "Bitcoin"); still not exactly one → ambiguous;
 * 3. no ticker → an entry whose name is the asset (`POLKADOT` → "Polkadot"), if exactly one.
 *
 * A coin the user chose (`requiredNames`: asset → the chosen coin's name) is binding: an entry —
 * also a single ticker hit — is only taken when its name is that coin's (normalised compare),
 * else `coinMismatch`. A ticker in `unresolved` (several coins, none chosen) takes nothing
 * (`ambiguousSymbol`).
 *
 * Ambiguous assets get **no** value — a wrong Steuerwert is worse than none (open item).
 */
export function matchEstvAssets(
  assets: readonly string[],
  rates: readonly EstvRate[],
  options: {
    readonly knownNames?: Readonly<Record<string, string>>;
    readonly extraAliases?: Readonly<Record<string, readonly string[]>>;
    readonly requiredNames?: Readonly<Record<string, string>>;
    readonly unresolved?: readonly string[];
  } = {},
): EstvMatchResult {
  const listed = rates.filter((r) => r.kind !== 'fx');
  const bySymbol = new Map<string, EstvRate[]>();
  const byName = new Map<string, EstvRate[]>();
  for (const rate of listed) {
    const symbol = rate.symbol.toUpperCase();
    bySymbol.set(symbol, [...(bySymbol.get(symbol) ?? []), rate]);
    const name = normaliseName(rate.name);
    if (name) byName.set(name, [...(byName.get(name) ?? []), rate]);
  }
  const matched: { asset: string; rate: EstvRate }[] = [];
  const ambiguous: {
    asset: string;
    reason: EstvAmbiguity;
    candidates: EstvCandidate[];
  }[] = [];
  const unresolved = new Set(
    (options.unresolved ?? []).map((a) => a.toUpperCase()),
  );
  const candidatesOf = (list: readonly EstvRate[]): EstvCandidate[] =>
    list
      .map((c) => ({
        symbol: c.symbol,
        name: c.name,
        valorNumber: c.valorNumber,
      }))
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const unmatched: string[] = [];
  const sortedAssets = [...new Set(assets.map((a) => a.toUpperCase()))].sort();
  for (const asset of sortedAssets) {
    const symbols = [
      asset,
      ...(ESTV_SYMBOL_ALIASES[asset] ?? []),
      ...(options.extraAliases?.[asset] ?? []),
    ];
    let candidates: EstvRate[] = [];
    for (const symbol of symbols) {
      candidates = bySymbol.get(symbol.toUpperCase()) ?? [];
      if (candidates.length > 0) break;
    }
    if (candidates.length === 0) {
      candidates = byName.get(normaliseName(asset)) ?? [];
    }
    const required = options.requiredNames?.[asset];
    if (candidates.length > 0 && required !== undefined) {
      // The chosen coin decides — also over a single ticker hit (another coin's Steuerwert).
      const fitting = candidates.filter(
        (c) => normaliseName(c.name) === normaliseName(required),
      );
      const distinct = new Set(
        fitting.map((c) => c.valorNumber ?? c.ictaxId ?? c.name),
      );
      const [first] = fitting;
      if (first && distinct.size === 1) {
        matched.push({ asset, rate: first });
      } else {
        ambiguous.push({
          asset,
          reason: fitting.length > 1 ? 'several' : 'coinMismatch',
          candidates: candidatesOf(candidates),
        });
      }
      continue;
    }
    if (candidates.length > 0 && unresolved.has(asset)) {
      ambiguous.push({
        asset,
        reason: 'ambiguousSymbol',
        candidates: candidatesOf(candidates),
      });
      continue;
    }
    if (candidates.length > 1) {
      const known = options.knownNames?.[asset];
      const byKnown = known
        ? candidates.filter(
            (c) => normaliseName(c.name) === normaliseName(known),
          )
        : [];
      // Several rows of the very same entry (same valor) are not ambiguous.
      const distinct = new Set(
        candidates.map((c) => c.valorNumber ?? c.ictaxId ?? c.name),
      );
      if (byKnown.length === 1) candidates = byKnown;
      else if (distinct.size === 1) candidates = candidates.slice(0, 1);
    }
    const [only] = candidates;
    if (candidates.length === 1 && only) {
      matched.push({ asset, rate: only });
    } else if (candidates.length > 1) {
      ambiguous.push({
        asset,
        reason: 'several',
        candidates: candidatesOf(candidates),
      });
    } else {
      unmatched.push(asset);
    }
  }
  return { matched, ambiguous, unmatched };
}

/** A project rate written from the Kursliste, with its label. */
export type LabelledRateEntry = RateEntry & { readonly note: string };

/**
 * The project rates for one Kursliste version: every matched asset's value at 31.12. (CHF) and
 * the year-end exchange rates of USD and EUR — all `estv`, labelled with the version's date.
 */
export function estvProjectRates(
  year: number,
  version: Pick<EstvVersion, 'exportDate'>,
  matched: EstvMatchResult['matched'],
  rates: readonly EstvRate[],
): LabelledRateEntry[] {
  const date = `${year}-12-31`;
  const note = estvSourceLabel(year, version.exportDate);
  const entries: LabelledRateEntry[] = matched.map(({ asset, rate }) => ({
    kind: 'price',
    asset,
    currency: 'CHF',
    date,
    value: rate.value,
    source: 'estv',
    note,
  }));
  for (const base of ['USD', 'EUR']) {
    const fx = rates.find((r) => r.kind === 'fx' && r.symbol === base);
    if (fx) {
      entries.push({
        kind: 'fx',
        asset: base,
        currency: 'CHF',
        date,
        value: fx.value,
        source: 'estv',
        note,
      });
    }
  }
  return entries;
}
