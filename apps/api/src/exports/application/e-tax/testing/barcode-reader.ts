import { inflateSync } from 'node:zlib';
import { errorCorrection } from '../pdf417';
import { PDF417_PATTERNS } from '../pdf417-patterns';

/**
 * Test-only reader for what `pdf417.ts` / `png.ts` write: PNG → module matrix → codewords
 * (checked against their error correction) → Macro PDF417 segment (index, file id, payload
 * bytes). It knows the layout it reads (13 columns, byte compaction) — an independent decoder
 * (zxing-cpp) confirmed the same symbols by hand (docs/ECH-0196.md).
 */

/** A 1-bit greyscale PNG (no interlace, filter 0 on every line) back to its modules. */
export function readMonochromePng(png: Buffer): boolean[][] {
  let offset = 8;
  let width = 0;
  let height = 0;
  const idat: Buffer[] = [];
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString('ascii', offset + 4, offset + 8);
    const data = png.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
    }
    if (type === 'IDAT') idat.push(data);
    offset += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = Math.ceil(width / 8);
  const rows: boolean[][] = [];
  for (let y = 0; y < height; y += 1) {
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const row: boolean[] = [];
    for (let x = 0; x < width; x += 1) {
      row.push((((line[x >> 3] ?? 0) >> (7 - (x & 7))) & 1) === 0);
    }
    rows.push(row);
  }
  return rows;
}

const REVERSE = PDF417_PATTERNS.map(
  (cluster) => new Map(cluster.map((pattern, word) => [pattern, word])),
);

function value(bits: readonly boolean[]): number {
  return bits.reduce((n, b) => n * 2 + (b ? 1 : 0), 0);
}

/** The codewords of a symbol, row by row, without row indicators. */
export function codewordsOf(
  matrix: readonly (readonly boolean[])[],
  columns: number,
): number[] {
  const words: number[] = [];
  matrix.forEach((row, r) => {
    for (let c = 0; c < columns; c += 1) {
      const start = 34 + c * 17;
      const word = REVERSE[r % 3]?.get(value(row.slice(start, start + 17)));
      if (word === undefined) throw new Error(`row ${r} col ${c}: no codeword`);
      words.push(word);
    }
  });
  return words;
}

export interface MacroSegment {
  readonly index: number;
  readonly fileId: readonly number[];
  readonly last: boolean;
  readonly bytes: Buffer;
}

function numeric(words: readonly number[]): number {
  return Number(String(words.reduce((n, w) => n * 900 + w, 0)).slice(1));
}

/** Codewords → the segment (throws when the error correction does not match). */
export function readSegment(
  words: readonly number[],
  ecLevel: number,
  fileIdLength: number,
): MacroSegment {
  const ecCount = 2 ** (ecLevel + 1);
  const length = words[0] ?? 0;
  const data = words.slice(0, length);
  const ec = words.slice(length, length + ecCount);
  if (errorCorrection(data, ecLevel).join(',') !== ec.join(',')) {
    throw new Error('error correction does not match');
  }
  const latch = data[1];
  let i = 2;
  const payload: number[] = [];
  while (i < data.length && (data[i] ?? 0) < 900) payload.push(data[i++] ?? 0);
  const bytes: number[] = [];
  const groups =
    latch === 924
      ? payload.length / 5
      : Math.max(0, Math.ceil(payload.length / 5) - 1);
  for (let g = 0; g < groups; g += 1) {
    let n = 0;
    for (const w of payload.slice(g * 5, g * 5 + 5)) n = n * 900 + w;
    const six: number[] = [];
    for (let k = 0; k < 6; k += 1) {
      six.unshift(n % 256);
      n = Math.floor(n / 256);
    }
    bytes.push(...six);
  }
  bytes.push(...payload.slice(groups * 5));
  while (data[i] === 900) i += 1;
  if (data[i] !== 928) throw new Error('no macro control block');
  const index = numeric(data.slice(i + 1, i + 3));
  const fileId = data.slice(i + 3, i + 3 + fileIdLength);
  return {
    index,
    fileId,
    last: data[data.length - 1] === 922,
    bytes: Buffer.from(bytes),
  };
}
