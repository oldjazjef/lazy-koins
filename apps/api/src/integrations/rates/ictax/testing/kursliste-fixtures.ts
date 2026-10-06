import { crc32, deflateRawSync } from 'node:zlib';

/**
 * SYNTHETIC Kursliste fixtures (CLAUDE.md, Private data): the shape of the ICTax XML export
 * (schema 2.0.0 and 2.2.0) with made-up ids, valors and values, and a minimal ZIP writer — so
 * the client and the parser are tested without the real list and without network.
 */

export const NS_20 = 'http://xmlns.estv.admin.ch/ictax/2.0.0/kursliste';
export const NS_22 = 'http://xmlns.estv.admin.ch/ictax/2.2.0/kursliste';

export interface FixtureOptions {
  readonly year?: number;
  readonly namespace?: string;
  /** Prefix the elements (`kl:`) instead of a default namespace. */
  readonly prefix?: string;
  readonly encoding?: 'ISO-8859-1' | 'UTF-8';
  /** Filler `share` elements before the currency notes (a "large-ish" file). */
  readonly fillerShares?: number;
}

/** A Kursliste with BTC, ETH, a deleted token, a token without value, USD/EUR/JPY year-end rates. */
export function kurslisteXml(options: FixtureOptions = {}): string {
  const year = options.year ?? 2025;
  const ns = options.namespace ?? NS_22;
  const p = options.prefix ? `${options.prefix}:` : '';
  const xmlns = options.prefix
    ? `xmlns:${options.prefix}="${ns}"`
    : `xmlns="${ns}"`;
  const lines: string[] = [
    `<?xml version="1.0" encoding="${options.encoding ?? 'ISO-8859-1'}"?>`,
    `<${p}kursliste ${xmlns} xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" version="2.2.0.0" creationDate="2026-03-01T20:00:00" year="${year}">`,
    `<${p}canton id="1" canton="ZH"><${p}cantonName lang="de" name="Zürich"/></${p}canton>`,
    `<${p}currency id="2" currency="USD"><${p}currencyName lang="de" name="US-Dollar"/></${p}currency>`,
  ];
  for (let i = 0; i < (options.fillerShares ?? 0); i += 1) {
    lines.push(
      `<${p}share id="${1000 + i}" valorNumber="${900000 + i}" isin="CH00000${String(i).padStart(5, '0')}" securityGroup="SHARE" securityName="Synthetische AG ${i} &amp; Co" currency="CHF" nominalValue="1" institutionId="1" institutionName="Synthetisch" country="CH"><${p}yearend id="${5000 + i}" quotationType="PIECE" taxValue="${i}.5" taxValueCHF="${i}.5"/><${p}payment id="${8000 + i}" paymentDate="${year}-05-01" currency="CHF" paymentValue="1" paymentValueCHF="1"/></${p}share>`,
    );
  }
  lines.push(
    `<${p}currencyNote id="11" valorNumber="1000001" securityGroup="CURRNOTE" securityType="CURRNOTE.TOKEN" securityName="Bitcoin" securityAppendix="BTC" country="XV" currency="XXX" denomination="1">`,
    `<${p}yearend id="21" quotationType="PIECE" taxValueCHF="70000.123456"/>`,
    `</${p}currencyNote>`,
    `<${p}currencyNote id="12" valorNumber="1000002" securityGroup="CURRNOTE" securityType="CURRNOTE.TOKEN" securityName="Ethereum" securityAppendix="ETH" country="XV" currency="XXX" denomination="1">`,
    `<${p}yearend id="22" quotationType="PIECE" taxValueCHF="2400.5"/>`,
    `<${p}legend id="31" effectiveDate="${year}-06-01"/>`,
    `</${p}currencyNote>`,
    `<${p}currencyNote id="13" deleted="1" valorNumber="1000003" securityGroup="CURRNOTE" securityType="CURRNOTE.TOKEN" securityName="Gelöscht" securityAppendix="DEL" country="XV" currency="XXX" denomination="1"><${p}yearend id="23" quotationType="PIECE" taxValueCHF="1"/></${p}currencyNote>`,
    `<${p}currencyNote id="14" valorNumber="1000004" securityGroup="CURRNOTE" securityType="CURRNOTE.TOKEN" securityName="Ohne Kurs" securityAppendix="NOV" country="XV" currency="XXX" denomination="1"><${p}yearend id="24" quotationType="PIECE" undefined="1"/></${p}currencyNote>`,
    `<${p}currencyNote id="15" valorNumber="1000005" securityGroup="CURRNOTE" securityType="CURRNOTE.TOKEN" securityName="Mini Token" securityAppendix="MINI" country="XV" currency="XXX" denomination="1000"><${p}yearend id="25" quotationType="PIECE" taxValueCHF="2"/></${p}currencyNote>`,
    `<${p}exchangeRate currency="USD" date="${year}-12-30" value="0.8"/>`,
    `<${p}exchangeRateYearEnd currency="EUR" year="${year}" value="0.9305" valueMiddle="0.937"/>`,
    `<${p}exchangeRateYearEnd currency="JPY" year="${year}" denomination="100" value="0.5054" valueMiddle="0.55"/>`,
    `<${p}exchangeRateYearEnd currency="USD" year="${year}" value="0.79225" valueMiddle="0.83"/>`,
    `</${p}kursliste>`,
  );
  return lines.join('\n');
}

/** The XML as bytes in its declared encoding. */
export function kurslisteBytes(options: FixtureOptions = {}): Buffer {
  const xml = kurslisteXml(options);
  return Buffer.from(
    xml,
    (options.encoding ?? 'ISO-8859-1') === 'UTF-8' ? 'utf8' : 'latin1',
  );
}

/** A ZIP archive with the given entries (deflated, or stored with `store: true`). */
export function zip(
  entries: readonly { name: string; data: Buffer; store?: boolean }[],
): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const body = entry.store ? entry.data : deflateRawSync(entry.data);
    const method = entry.store ? 0 : 8;
    const crc = crc32(entry.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, body);
    centrals.push(central, name);
    offset += local.length + name.length + body.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}
