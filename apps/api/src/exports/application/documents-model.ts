import {
  type IncomeLine,
  parseDecimal,
  type Position,
  sum,
  toDecimalString,
} from '@lazykoins/engine';
import type { ExportData, RecordOrigin } from './export-data';
import type { ExportKit } from './export-texts';

/**
 * The rows of the further tax documents (F10.11–F10.13), computed once and rendered as PDF,
 * Excel and CSV alike — pure. Like every statement: only declared figures and how they were
 * computed; a figure without a price keeps its quantity, has no value and a neutral footnote.
 */

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** `<file>, Zeile n` / `Tx <hash>` / "Manuelle Erfassung". */
export function originText(
  k: ExportKit,
  origin: RecordOrigin | undefined,
): string {
  if (!origin) return '–';
  if (origin.manual) return k.t.documents.manualRecord;
  if (origin.tx) return k.t.documents.originTx(origin.tx);
  return k.t.documents.origin(origin.file, origin.row);
}

// ---------------------------------------------------------------- F10.11

export interface SecuritiesRow {
  readonly platform: string;
  readonly accountId: string;
  readonly asset: string;
  /** Holding at 31.12. (`0` when the asset only brought income). */
  readonly quantity: string;
  readonly price: string | null;
  readonly priceSource: string;
  /** Tax value; null = no price or not counted (spam, negative). */
  readonly value: string | null;
  /** Crypto income never bears withholding tax: always 0. */
  readonly incomeWith: string;
  readonly incomeWithout: string;
  readonly note: string | null;
}

export interface SecuritiesModel {
  readonly rows: readonly SecuritiesRow[];
  readonly totalValue: string;
  readonly totalIncome: string;
  readonly notes: readonly string[];
}

/** One line per platform/account/asset: holding at 31.12. and the year's income (F10.11). */
export function securitiesModel(
  data: ExportData,
  k: ExportKit,
): SecuritiesModel {
  const { result, rules } = data;
  const currency = rules.homeCurrency;
  const key = (p: string, a: string, s: string) => `${p}|${a}|${s}`;
  const income = new Map<string, string[]>();
  const add = (k2: string, value: string | null) => {
    if (value === null) return;
    income.set(k2, [...(income.get(k2) ?? []), value]);
  };
  for (const line of result.income) {
    if (line.status === 'spam') continue;
    add(key(line.platform, line.accountId, line.asset), line.valueChf);
  }
  for (const gap of result.earnGaps) {
    add(key(gap.platform, gap.accountId, gap.asset), gap.valueChf);
  }
  const positions = new Map<string, Position>(
    result.positions.map((p) => [key(p.platform, p.accountId, p.asset), p]),
  );
  const keys = [...new Set([...positions.keys(), ...income.keys()])].sort(
    compareText,
  );
  const notes: string[] = [];
  const rows = keys.map((id) => {
    const position = positions.get(id);
    const [platform = '', accountId = '', asset = ''] = id.split('|');
    const incomeTotal = toDecimalString(
      sum((income.get(id) ?? []).map(parseDecimal)),
    );
    const note = position
      ? k.statusNote(rules, position.status)
      : k.t.documents.securities.noHolding;
    if (position && note) notes.push(note);
    return {
      platform,
      accountId,
      asset,
      quantity: position?.quantity ?? '0',
      price: position?.status === 'ok' ? position.priceChf : null,
      priceSource: position
        ? k.priceSourceText(
            position.priceOrigin,
            position.priceSource,
            position.priceDate,
            currency,
          )
        : '–',
      value: position?.status === 'ok' ? position.valueChf : null,
      incomeWith: '0',
      incomeWithout: incomeTotal,
      note: position ? (position.status === 'ok' ? null : note) : note,
    };
  });
  return {
    rows,
    totalValue: result.totals.wealthChf,
    totalIncome: toDecimalString(
      sum(rows.map((r) => parseDecimal(r.incomeWithout))),
    ),
    notes: [...new Set(notes)],
  };
}

// ---------------------------------------------------------------- F10.12

export interface IncomeRow {
  readonly line: IncomeLine;
  readonly category: string;
  readonly priceSource: string;
  readonly origin: string;
  readonly note: string | null;
}

export interface IncomeListModel {
  readonly rows: readonly IncomeRow[];
  readonly byCategory: readonly {
    readonly category: string;
    readonly count: number;
    readonly value: string;
  }[];
  readonly byAsset: readonly {
    readonly asset: string;
    readonly quantity: string;
    readonly value: string;
  }[];
  readonly total: string;
}

/** Every taxable inflow with price, value and origin; sums per category and asset (F10.12). */
export function incomeListModel(
  data: ExportData,
  k: ExportKit,
): IncomeListModel {
  const { result, rules } = data;
  const origins = data.documents?.origins ?? {};
  const lines = result.income
    .filter((l) => l.status !== 'spam')
    .sort(
      (a, b) =>
        compareText(a.timestamp, b.timestamp) || compareText(a.id, b.id),
    );
  const rows = lines.map((line) => ({
    line,
    category: rules.labels.categories[line.category],
    priceSource: k.priceSourceText(
      line.priceOrigin,
      line.priceSource,
      line.date,
      rules.homeCurrency,
    ),
    origin: originText(k, origins[line.bookingId]),
    note: line.status === 'missingPrice' ? rules.labels.noPriceNote : null,
  }));
  const byCategory = result.categories
    .filter((c) => c.lines > 0 || c.valueChf !== '0')
    .map((c) => ({
      category: rules.labels.categories[c.category],
      count: c.lines,
      value: c.valueChf,
    }));
  const assets = new Map<string, IncomeLine[]>();
  for (const line of lines) {
    assets.set(line.asset, [...(assets.get(line.asset) ?? []), line]);
  }
  const byAsset = [...assets.entries()]
    .sort(([a], [b]) => compareText(a, b))
    .map(([asset, list]) => ({
      asset,
      quantity: toDecimalString(
        sum(list.map((l) => parseDecimal(l.quantityNet))),
      ),
      value: toDecimalString(
        sum(
          list.flatMap((l) => (l.valueChf ? [parseDecimal(l.valueChf)] : [])),
        ),
      ),
    }));
  return { rows, byCategory, byAsset, total: result.totals.incomeChf };
}

// ---------------------------------------------------------------- F10.13

export interface EvidenceTransaction {
  readonly timestamp: string;
  readonly platform: string;
  readonly accountId: string;
  readonly kind: string;
  readonly asset: string;
  readonly quantity: string;
  readonly fee: string;
  readonly value: string | null;
  readonly treatment: string;
  readonly change: string;
  readonly reason: string;
  readonly origin: string;
}

export interface EvidenceHolding {
  readonly position: Position;
  readonly price: string | null;
  readonly priceSource: string;
  readonly value: string | null;
  readonly evidence: string;
  readonly note: string | null;
}

export interface EvidenceModel {
  readonly transactions: readonly EvidenceTransaction[];
  readonly holdings: readonly EvidenceHolding[];
  readonly notes: readonly string[];
}

/** (a) the year's transactions with their changes, (b) the balances at 31.12. (F10.13). */
export function evidenceModel(data: ExportData, k: ExportKit): EvidenceModel {
  const { result, rules } = data;
  const d = k.t.documents;
  const ev = d.evidence;
  const origins = data.documents?.origins ?? {};
  const transactions = [...(data.documents?.transactions ?? [])]
    .sort(
      (a, b) =>
        compareText(a.timestamp, b.timestamp) || compareText(a.id, b.id),
    )
    .map((row) => {
      const changes = [
        row.importedKind
          ? ev.changeText(ev.kinds[row.importedKind], ev.kinds[row.kind])
          : null,
        row.importedAsset ? ev.changeText(row.importedAsset, row.asset) : null,
      ].filter((c): c is string => c !== null);
      return {
        timestamp: row.timestamp,
        platform: row.platform,
        accountId: row.accountId,
        kind: ev.kinds[row.kind],
        asset: row.asset,
        quantity: row.quantity,
        fee: row.fee
          ? `${k.quantity(row.fee)} ${row.feeAsset ?? ''}`.trim()
          : '',
        value:
          row.treatment === 'income' || row.treatment === 'oneOff'
            ? row.valueChf
            : row.marketValue,
        treatment: ev.treatments[row.treatment] ?? row.treatment,
        change: changes.join('; '),
        reason: row.editReason ?? row.correctionReason ?? '',
        origin: row.manual
          ? d.manualRecord
          : originText(k, origins[row.id]) !== '–'
            ? originText(k, origins[row.id])
            : row.fileName
              ? d.origin(row.fileName, row.row)
              : '–',
      };
    });
  const evidenceOf = data.documents?.evidence ?? {};
  const notes: string[] = [];
  const holdings = [...result.positions]
    .sort(
      (a, b) =>
        compareText(a.platform, b.platform) ||
        compareText(a.accountId, b.accountId) ||
        compareText(a.asset, b.asset),
    )
    .map((position) => {
      const evidence = evidenceOf[position.id];
      const note = k.statusNote(rules, position.status);
      if (note) notes.push(note);
      return {
        position,
        price: position.status === 'ok' ? position.priceChf : null,
        priceSource: k.priceSourceText(
          position.priceOrigin,
          position.priceSource,
          position.priceDate,
          rules.homeCurrency,
        ),
        value: position.status === 'ok' ? position.valueChf : null,
        evidence: !evidence
          ? k.t.quantitySourceLabels[position.quantitySource]
          : evidence.kind === 'manual'
            ? ev.evidenceKinds.manual(evidence.note)
            : evidence.kind === 'statement'
              ? ev.evidenceKinds.statement(evidence.files.join(', '))
              : evidence.kind === 'wallet'
                ? ev.evidenceKinds.wallet(evidence.files.join(', '))
                : ev.evidenceKinds.ledger(evidence.bookings),
        note,
      };
    });
  if (data.documents?.transactions.some((t) => t.treatment === 'excluded')) {
    notes.push(ev.hiddenNote);
  }
  return { transactions, holdings, notes: [...new Set(notes)] };
}
