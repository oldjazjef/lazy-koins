#!/usr/bin/env node
/**
 * A FAKE ICTax API for trying the automatic ESTV Kursliste (F7.4a) locally without touching the
 * real ESTV servers: the same three endpoints and response shapes, a SYNTHETIC list.
 *
 *   node scripts/dev/fake-ictax-server.mjs [port]      (default 11436)
 *
 * Then start the API with `ESTV_BASE_URL=http://localhost:11436` (apps/api/.env).
 *
 * - `GET  /extern/api/authentication/session.json` → `data.csrfToken` + a session cookie;
 * - `POST /extern/api/xml/xmls.json` `{year}` (needs the token and the cookie) → a full export
 *   (`THIRD.INIT.220`) and a delta for every year 2017 … last year;
 * - `GET  /extern/api/download/<id>/<hash>/<name>` → a ZIP with `kursliste_<year>.xml`
 *   (schema 2.2.0, ISO-8859-1): synthetic values for BTC, ETH, SOL, DOT (two entries — the
 *   ambiguous case), ADA, USDT, IOTA (ticker IOT) and the year-end USD/EUR rates.
 *
 * `POST /bump` publishes a "newer" version (export date now, another hash) for every year — to
 * see the daily check pick it up. Values are made up; never real data.
 */
import { createServer } from 'node:http';
import { crc32, deflateRawSync } from 'node:zlib';

const port = Number(process.argv[2] ?? process.env.PORT ?? 11436);
const lastYear = new Date().getUTCFullYear() - 1;
let version = 1;
let exportDate = Date.parse(`${lastYear + 1}-03-02T08:00:00Z`);

const TOKENS = [
  ['BTC', 'Bitcoin', 70000.123456],
  ['ETH', 'Ethereum', 2400.5],
  ['SOL', 'Solana', 110.25],
  ['DOT', 'Polkadot', 3.75],
  ['DOT', 'Dotcoin', 0.0123],
  ['ADA', 'Cardano', 0.55],
  ['USDT', 'Tether', 0.79],
  ['IOT', 'IOTA', 0.066],
];

function xml(year) {
  // Values move a little with the year and the version, so a new version is visible.
  const factor = (1 + (year - 2017) * 0.05) * (1 + (version - 1) * 0.01);
  const notes = TOKENS.map(
    ([symbol, name, value], i) =>
      `<currencyNote id="${100 + i}" valorNumber="${9000000 + i}" securityGroup="CURRNOTE" securityType="CURRNOTE.TOKEN" securityName="${name}" securityAppendix="${symbol}" country="XV" currency="XXX" denomination="1">\n<yearend id="${200 + i}" quotationType="PIECE" taxValueCHF="${(value * factor).toFixed(6)}"/>\n</currencyNote>`,
  ).join('\n');
  return [
    '<?xml version="1.0" encoding="ISO-8859-1"?>',
    `<kursliste xmlns="http://xmlns.estv.admin.ch/ictax/2.2.0/kursliste" version="2.2.0.0" creationDate="${new Date(exportDate).toISOString().slice(0, 19)}" year="${year}">`,
    '<canton id="1" canton="ZH"><cantonName lang="de" name="Zürich"/></canton>',
    notes,
    `<exchangeRateYearEnd currency="EUR" year="${year}" value="${(0.93 * factor).toFixed(5)}"/>`,
    `<exchangeRateYearEnd currency="USD" year="${year}" value="${(0.79 * factor).toFixed(5)}"/>`,
    '</kursliste>',
  ].join('\n');
}

function zip(name, data) {
  const fileName = Buffer.from(name);
  const body = deflateRawSync(data);
  const crc = crc32(data);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(body.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(fileName.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(body.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(fileName.length, 28);
  const cdOffset = local.length + fileName.length + body.length;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + fileName.length, 12);
  end.writeUInt32LE(cdOffset, 16);
  return Buffer.concat([local, fileName, body, central, fileName, end]);
}

const hashOf = (year) => `fake${year}v${version}`;

const server = createServer((req, res) => {
  const url = req.url ?? '';
  console.log(`${req.method} ${url.split('?')[0]}`);
  if (url === '/extern/api/authentication/session.json') {
    res.setHeader('set-cookie', 'JSESSIONID=fake-session; Path=/; HttpOnly');
    res.setHeader('content-type', 'application/json');
    res.end(
      JSON.stringify({ status: 'SUCCESS', data: { csrfToken: 'fake-csrf' } }),
    );
    return;
  }
  if (url === '/extern/api/xml/xmls.json' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      if (
        req.headers['x-csrf-token'] !== 'fake-csrf' ||
        !String(req.headers.cookie ?? '').includes('JSESSIONID=fake-session')
      ) {
        res.statusCode = 403;
        res.end('{}');
        return;
      }
      const { year } = JSON.parse(body || '{}');
      const data =
        year >= 2017 && year <= lastYear
          ? [
              {
                id: year * 10 + 1,
                deleted: false,
                exportDate,
                exportFile: {
                  id: year * 10 + 1,
                  fileName: `kursliste_${year}.zip`,
                  fileSize: zip(
                    `kursliste_${year}.xml`,
                    Buffer.from(xml(year), 'latin1'),
                  ).length,
                  fileHash: hashOf(year),
                },
                exportType: {
                  categoryShortName: 'EXPTYP',
                  shortName: 'THIRD.INIT.220',
                },
              },
              {
                id: year * 10 + 2,
                exportDate: exportDate - 1000,
                exportFile: {
                  id: year * 10 + 2,
                  fileName: `kursliste_${year}.zip`,
                  fileSize: 10,
                  fileHash: `delta${year}`,
                },
                exportType: { shortName: 'THIRD.DELTA.220' },
              },
            ]
          : [];
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify({
          status: 'SUCCESS',
          error: null,
          data,
          totalItems: data.length,
        }),
      );
    });
    return;
  }
  const download =
    /^\/extern\/api\/download\/(\d+)\/([^/]+)\/kursliste_(\d{4})\.zip$/.exec(
      url,
    );
  if (download) {
    const year = Number(download[3]);
    if (download[2] !== hashOf(year)) {
      res.statusCode = 404;
      res.end('not found');
      return;
    }
    const archive = zip(
      `kursliste_${year}.xml`,
      Buffer.from(xml(year), 'latin1'),
    );
    res.setHeader('content-type', 'application/zip;charset=UTF-8');
    res.setHeader('content-length', String(archive.length));
    res.end(archive);
    return;
  }
  if (url === '/bump' && req.method === 'POST') {
    version += 1;
    exportDate = Date.now();
    res.end(`version ${version}\n`);
    return;
  }
  res.statusCode = 404;
  res.end('not found');
});

server.listen(port, () => {
  console.log(
    `Fake ICTax on http://localhost:${port} (synthetic Kursliste ${2017}–${lastYear})`,
  );
});
