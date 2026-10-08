import { createHash } from 'node:crypto';
import {
  type Decimal,
  formatFixed,
  parseDecimal,
  sum,
  toDecimalString,
} from '@lazykoins/engine';
import type { ExportData } from '../export-data';
import { kitOf } from '../export-texts';

/**
 * F10.10: the E-Steuerauszug after eCH-0196 **2.2.0** (namespace `…/eCH-0196/2`,
 * `minorVersion="22"`) — the portfolio as a "Wertschriftenliste" the cantonal tax software can
 * import. Pure. How crypto is mapped (decided 08.10.2026, docs/ECH-0196.md):
 *
 * - one **depot** per platform/account, one **security** per asset in it (`positionId` 1…n,
 *   unique across the statement as the standard demands for the same title in several depots);
 * - `securityCategory="CURRNOTE"` — the ESTV Kursliste lists crypto as currency notes
 *   (`CURRNOTE.TOKEN` there; that type is not in the 2.2 enumeration, so `securityType` is left
 *   out); fiat balances are `CURRNOTE.CURRENCY`; no ISIN; the Kursliste's valor number when the
 *   asset's value came from it; the name "<Kursliste name> (<ticker>)" or the ticker;
 *   `country="CH"` (mandatory; a coin has no issuer domicile), `currency="CHF"`,
 *   `quotationType="PIECE"`;
 * - **taxValue** at 31.12. only for a holding > 0 (the standard's rule): quantity, unit price and
 *   value in CHF, `kursliste="1"` for an ESTV value, `undefined="1"` (no price, no 0) when there
 *   is no price; spam and negative balances are left out (they are in no total either);
 * - every taxable inflow as a **payment** on its day — `grossRevenueB` (no Verrechnungssteuer on
 *   crypto income), the category as its name; the Earn gap (Differenzmethode) as a payment on
 *   31.12.; an inflow without a price is `undefined="1"`;
 * - no `stock` mutations (the balance changes are in the Transaktionsnachweis, F10.13), no bank
 *   accounts, liabilities or expenses, totals A / withholding / DA-1 / IUP = 0;
 * - the institution is lazy-koins itself, never the exchange (no LEI, no UID): the statement is
 *   made by the taxpayer from their own exports.
 *
 * Totals are summed from the unrounded single values and rounded once (DIN 1333, half up): below
 * 100 with 3 decimals, from 100 with 2, as the standard prescribes; single values unrounded.
 */

export const ECH0196_NAMESPACE = 'http://www.ech.ch/xmlns/eCH-0196/2';
export const ECH0196_MINOR_VERSION = 22;
/** No clearing number: lazy-koins is no financial institution (Beilage 2 §2.1 asks for 5 digits). */
export const ETAX_ORGANISATION = '00000';
/** Organisation name in the statement — the maker, never an exchange (eCH-0010, ≤ 60). */
export const ETAX_INSTITUTION = 'lazy-koins (selbst erstellt)';

/** What the E-Steuerauszug needs beyond the result. */
export interface ETaxData {
  /** Stable, pseudonymous customer number (14 characters, `[A-Z0-9]`). */
  readonly clientNumber: string;
  /** Asset → the Kursliste entry its 31.12. value came from (F7.4a). */
  readonly titles: Readonly<
    Record<
      string,
      { readonly name: string; readonly valorNumber: string | null }
    >
  >;
}

export interface ETaxPayment {
  readonly date: string;
  readonly name: string;
  readonly quantity: string;
  readonly price: string | null;
  readonly value: string | null;
}

export interface ETaxSecurity {
  readonly positionId: number;
  readonly asset: string;
  readonly name: string;
  readonly valorNumber: string | null;
  readonly fiat: boolean;
  /** Holding at 31.12. (> 0), or null when none. */
  readonly taxValue: {
    readonly quantity: string;
    readonly price: string | null;
    readonly value: string | null;
    readonly kursliste: boolean;
  } | null;
  readonly payments: readonly ETaxPayment[];
  /** Σ payments; null when one of them has no value. */
  readonly revenue: string | null;
}

export interface ETaxDepot {
  readonly depotNumber: string;
  readonly securities: readonly ETaxSecurity[];
}

export interface ETaxStatement {
  readonly id: string;
  readonly taxYear: number;
  readonly canton: string;
  readonly createdAt: string;
  readonly clientNumber: string;
  readonly firstName: string | null;
  readonly lastName: string | null;
  readonly depots: readonly ETaxDepot[];
  /** Rounded totals (as in the XML). */
  readonly totalTaxValue: string;
  readonly totalRevenueB: string;
  /** Securities without a price (value / revenue undefined, counted as 0). */
  readonly undefinedCount: number;
}

const MAX_NAME = 60;
const MAX_DEPOT = 32;
const MAX_PERSON_NAME = 30;

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function cut(text: string, max: number): string {
  const chars = [...text];
  return chars.length <= max ? text : `${chars.slice(0, max - 1).join('')}…`;
}

/** DIN 1333 (half up), 3 decimals below 100, 2 from 100 — totals only. */
export function roundTotal(value: Decimal): string {
  return formatFixed(value, value.abs().lessThan(100) ? 3 : 2, 'halfUp');
}

/** `CH` + organisation (5) + customer (14) + `<year>1231` + `01` (Beilage 2 §2.1), 31 chars. */
export function eTaxStatementId(clientNumber: string, taxYear: number): string {
  return `CH${ETAX_ORGANISATION}${clientNumber}${taxYear}123101`;
}

/** 14 characters from a project id: `LK` + 12 upper-case hex of its SHA-256 — no personal data. */
export function eTaxClientNumber(projectId: string): string {
  return `LK${createHash('sha256').update(projectId).digest('hex').slice(0, 12).toUpperCase()}`;
}

function splitName(full: string): {
  first: string | null;
  last: string | null;
} {
  const parts = full
    .trim()
    .split(/\s+/)
    .filter((p) => p !== '');
  if (parts.length === 0) return { first: null, last: null };
  const last = parts.pop() ?? '';
  return {
    first: parts.length > 0 ? cut(parts.join(' '), MAX_PERSON_NAME) : null,
    last: cut(last, MAX_PERSON_NAME),
  };
}

/** The statement's content (also what the PDF's readable pages show). */
export function eTaxStatement(data: ExportData, eTax: ETaxData): ETaxStatement {
  const { result, rules } = data;
  const fiat = new Set(rules.fiat);
  const key = (platform: string, account: string) =>
    `${platform}\u0000${account}`;
  const assetsByDepot = new Map<string, Set<string>>();
  const touch = (platform: string, account: string, asset: string) => {
    const k = key(platform, account);
    const set = assetsByDepot.get(k) ?? new Set<string>();
    set.add(asset);
    assetsByDepot.set(k, set);
  };
  const positions = result.positions.filter(
    (p) => p.status === 'ok' || p.status === 'missingPrice',
  );
  for (const p of positions) {
    if (parseDecimal(p.quantity).greaterThan(0))
      touch(p.platform, p.accountId, p.asset);
  }
  const incomes = result.income.filter((l) => l.status !== 'spam');
  for (const l of incomes) touch(l.platform, l.accountId, l.asset);
  const gaps = result.earnGaps.filter((g) => g.status !== 'negative');
  for (const g of gaps) touch(g.platform, g.accountId, g.asset);

  const yearEnd = `${data.taxYear}-12-31`;
  let positionId = 0;
  const usedDepots = new Set<string>();
  const totals: Decimal[] = [];
  const revenues: Decimal[] = [];
  let undefinedCount = 0;
  const depots = [...assetsByDepot.keys()].sort(compareText).map((k) => {
    const [platform = '', account = ''] = k.split('\u0000');
    const label =
      account && account !== platform ? `${platform} / ${account}` : platform;
    let depotNumber = cut(label || '–', MAX_DEPOT);
    for (let n = 2; usedDepots.has(depotNumber); n += 1) {
      const suffix = ` #${n}`;
      depotNumber = `${cut(label, MAX_DEPOT - suffix.length)}${suffix}`;
    }
    usedDepots.add(depotNumber);
    const assets = [...(assetsByDepot.get(k) ?? [])].sort(compareText);
    const securities = assets.map((asset): ETaxSecurity => {
      positionId += 1;
      const position = positions.find(
        (p) =>
          p.platform === platform &&
          p.accountId === account &&
          p.asset === asset &&
          parseDecimal(p.quantity).greaterThan(0),
      );
      const title = eTax.titles[asset];
      const priced = position?.status === 'ok' && position.valueChf !== null;
      if (position) {
        if (priced && position.valueChf)
          totals.push(parseDecimal(position.valueChf));
        else undefinedCount += 1;
      }
      const payments: ETaxPayment[] = [
        ...incomes
          .filter(
            (l) =>
              l.platform === platform &&
              l.accountId === account &&
              l.asset === asset,
          )
          .sort(
            (a, b) =>
              compareText(a.timestamp, b.timestamp) || compareText(a.id, b.id),
          )
          .map((l) => ({
            date: l.date,
            name: rules.labels.categories[l.category],
            quantity: l.quantityNet,
            price: l.status === 'ok' ? l.priceChf : null,
            value: l.status === 'ok' ? l.valueChf : null,
          })),
        ...gaps
          .filter(
            (g) =>
              g.platform === platform &&
              g.accountId === account &&
              g.asset === asset,
          )
          .map((g) => ({
            date: yearEnd,
            name: kitOf(data).t.eTax.earnGap,
            quantity: g.gapQuantity,
            price: g.status === 'income' ? g.averagePriceChf : null,
            value: g.status === 'income' ? g.valueChf : null,
          })),
      ];
      for (const p of payments) {
        if (p.value !== null) revenues.push(parseDecimal(p.value));
        else undefinedCount += 1;
      }
      return {
        positionId,
        asset,
        name: cut(title ? `${title.name} (${asset})` : asset, MAX_NAME),
        valorNumber: title?.valorNumber ?? null,
        fiat: fiat.has(asset),
        taxValue: position
          ? {
              quantity: position.quantity,
              price: priced ? position.priceChf : null,
              value: priced ? position.valueChf : null,
              kursliste: priced && position.priceOrigin === 'estv',
            }
          : null,
        payments,
        revenue: payments.some((p) => p.value === null)
          ? null
          : toDecimalString(
              sum(payments.map((p) => parseDecimal(p.value ?? '0'))),
            ),
      };
    });
    return { depotNumber, securities };
  });
  const person = splitName(data.ownerName);
  return {
    id: eTaxStatementId(eTax.clientNumber, data.taxYear),
    taxYear: data.taxYear,
    canton: data.canton,
    createdAt: data.createdAt,
    clientNumber: eTax.clientNumber,
    firstName: person.first,
    lastName: person.last,
    depots,
    totalTaxValue: roundTotal(sum(totals)),
    totalRevenueB: roundTotal(sum(revenues)),
    undefinedCount,
  };
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** XML 1.0 forbids control characters other than tab, line feed and carriage return. */
function xmlChars(value: string): string {
  return [...value]
    .filter((c) => {
      const code = c.charCodeAt(0);
      return code >= 0x20 || code === 0x09 || code === 0x0a || code === 0x0d;
    })
    .join('');
}

function attrs(
  values: Readonly<Record<string, string | number | null | undefined>>,
): string {
  return Object.entries(values)
    .filter(([, v]) => v !== null && v !== undefined)
    .map(([k, v]) => ` ${k}="${escapeXml(xmlChars(String(v)))}"`)
    .join('');
}

/** A decimal string as xs:decimal (no exponent, no "+"). */
function dec(value: string): string {
  return toDecimalString(parseDecimal(value));
}

/** The XML document (UTF-8, double-quoted declaration — the official verifier insists). */
export function eTaxStatementXml(statement: ETaxStatement): string {
  const zero = '0';
  const totals = {
    totalTaxValue: statement.totalTaxValue,
    totalGrossRevenueA: zero,
    totalGrossRevenueB: statement.totalRevenueB,
    totalWithHoldingTaxClaim: zero,
  };
  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<taxStatement xmlns="${ECH0196_NAMESPACE}"${attrs({
      id: statement.id,
      creationDate: statement.createdAt,
      taxPeriod: statement.taxYear,
      periodFrom: `${statement.taxYear}-01-01`,
      periodTo: `${statement.taxYear}-12-31`,
      country: 'CH',
      canton: statement.canton,
      ...totals,
      minorVersion: ECH0196_MINOR_VERSION,
    })}>`,
    `  <institution${attrs({ name: ETAX_INSTITUTION })}/>`,
    `  <client${attrs({
      clientNumber: statement.clientNumber,
      firstName: statement.firstName,
      lastName: statement.lastName,
    })}/>`,
    `  <listOfSecurities${attrs({
      ...totals,
      totalLumpSumTaxCredit: zero,
      totalNonRecoverableTax: zero,
      totalAdditionalWithHoldingTaxUSA: zero,
      totalGrossRevenueIUP: zero,
      totalGrossRevenueConversion: zero,
    })}>`,
  ];
  for (const depot of statement.depots) {
    lines.push(`    <depot${attrs({ depotNumber: depot.depotNumber })}>`);
    for (const s of depot.securities) {
      lines.push(
        `      <security${attrs({
          positionId: s.positionId,
          valorNumber: s.valorNumber,
          country: 'CH',
          currency: 'CHF',
          quotationType: 'PIECE',
          securityCategory: 'CURRNOTE',
          securityType: s.fiat ? 'CURRNOTE.CURRENCY' : null,
          securityName: s.name,
        })}>`,
      );
      const tv = s.taxValue;
      if (tv) {
        lines.push(
          `        <taxValue${attrs({
            referenceDate: `${statement.taxYear}-12-31`,
            quotationType: 'PIECE',
            quantity: dec(tv.quantity),
            balanceCurrency: 'CHF',
            unitPrice: tv.price === null ? null : dec(tv.price),
            exchangeRate: tv.value === null ? null : '1',
            value: tv.value === null ? null : dec(tv.value),
            undefined: tv.value === null ? '1' : null,
            kursliste: tv.kursliste ? '1' : null,
          })}/>`,
        );
      }
      for (const p of s.payments) {
        lines.push(
          `        <payment${attrs({
            paymentDate: p.date,
            name: cut(p.name, 200),
            quotationType: 'PIECE',
            quantity: dec(p.quantity),
            amountCurrency: 'CHF',
            amountPerUnit: p.price === null ? null : dec(p.price),
            amount: p.value === null ? null : dec(p.value),
            exchangeRate: p.value === null ? null : '1',
            grossRevenueB: p.value === null ? null : dec(p.value),
            undefined: p.value === null ? '1' : null,
          })}/>`,
        );
      }
      lines.push('      </security>');
    }
    lines.push('    </depot>');
  }
  lines.push('  </listOfSecurities>', '</taxStatement>', '');
  return lines.join('\n');
}
