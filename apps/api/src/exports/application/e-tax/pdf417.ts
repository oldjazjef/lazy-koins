import { PDF417_PATTERNS } from './pdf417-patterns';

/**
 * PDF417 with Macro PDF417 ("Structured Append"), as the E-Steuerauszug's 2D barcode sheets need
 * it (eCH-0196 Beilage 2 §2.2, eCH-0270): the ZLIB-compressed XML in byte compaction, split into
 * segments of a fixed size (13 data columns × 35 rows, error correction level 4), each with a
 * macro control block (segment index, file id, file name = the statement id, segment count; the
 * last one with the terminator). Pure — ported from pdf417-py (MIT), the encoder the open-source
 * E-Steuerauszug generators use with accepted results.
 */

const START = 0x1fea8;
const STOP = 0x3fa29;
const PADDING = 900;
const BYTE_LATCH = 901;
const BYTE_LATCH_6 = 924;
const MACRO_MARKER = 928;
const MACRO_OPTIONAL = 923;
const MACRO_TERMINATOR = 922;
const FIELD_FILE_NAME = 0;
const FIELD_SEGMENT_COUNT = 1;

export interface Pdf417Options {
  /** Data columns (eCH: 13). */
  readonly columns: number;
  /** Rows of every segment, the last one included (eCH: 35). */
  readonly rows: number;
  /** Error correction level 0–8 (eCH: 4 = 32 codewords). */
  readonly ecLevel: number;
}

/** One symbol: its codewords (row by row, without row indicators) and its module matrix. */
export interface Pdf417Symbol {
  readonly codewords: readonly number[];
  /** `rows` lines of `17 × (columns + 4) + 1` modules; `true` = bar. */
  readonly matrix: readonly (readonly boolean[])[];
}

export interface MacroOptions extends Pdf417Options {
  /** Bytes of the payload per segment (eCH examples: 450). */
  readonly segmentBytes: number;
  /** PDFMacroFileId: codewords 0–899 (eCH: four). */
  readonly fileId: readonly number[];
  /** PDFMacroFileName: the document id, `[A-Z0-9]` only (text compaction, upper/digits). */
  readonly fileName: string;
}

/** 5 digits in numeric compaction ("1" prefix, base 900): the segment index and count. */
function numeric5(value: number): number[] {
  let n = 100000 + value;
  const out: number[] = [];
  while (n > 0) {
    out.unshift(n % 900);
    n = Math.floor(n / 900);
  }
  return out;
}

/** Text compaction of `[A-Z0-9 ]` (alpha + mixed sub-modes), two values per codeword. */
export function compactUpperText(text: string): number[] {
  const MIXED_LATCH = 28; // alpha → mixed
  const ALPHA_LATCH = 28; // mixed → alpha
  const PAD = 29;
  const values: number[] = [];
  let mixed = false;
  for (const char of text) {
    const code = char.charCodeAt(0);
    if (code >= 48 && code <= 57) {
      if (!mixed) values.push(MIXED_LATCH);
      mixed = true;
      values.push(code - 48);
    } else if ((code >= 65 && code <= 90) || code === 32) {
      if (mixed) values.push(ALPHA_LATCH);
      mixed = false;
      values.push(code === 32 ? 26 : code - 65);
    } else {
      throw new Error(`PDF417 file name must be [A-Z0-9 ]: ${text}`);
    }
  }
  if (values.length % 2 === 1) values.push(PAD);
  const out: number[] = [];
  for (let i = 0; i < values.length; i += 2) {
    out.push(30 * (values[i] ?? 0) + (values[i + 1] ?? 0));
  }
  return out;
}

/** Byte compaction: 6 bytes → 5 codewords (base 256 → base 900), a rest byte by byte. */
export function compactBytes(bytes: Uint8Array): number[] {
  const out: number[] = [bytes.length % 6 === 0 ? BYTE_LATCH_6 : BYTE_LATCH];
  let i = 0;
  for (; i + 6 <= bytes.length; i += 6) {
    // 48 bits fit a double exactly.
    let value = 0;
    for (let j = 0; j < 6; j += 1) value = value * 256 + (bytes[i + j] ?? 0);
    const words: number[] = [];
    for (let j = 0; j < 5; j += 1) {
      words.unshift(value % 900);
      value = Math.floor(value / 900);
    }
    out.push(...words);
  }
  for (; i < bytes.length; i += 1) out.push(bytes[i] ?? 0);
  return out;
}

/** The generator polynomial's coefficients Π (x − 3^i), i = 1…k, lowest degree first. */
function ecFactors(count: number): number[] {
  let g = [1];
  let power = 1;
  for (let i = 1; i <= count; i += 1) {
    power = (power * 3) % 929;
    const next = new Array<number>(g.length + 1).fill(0);
    g.forEach((c, j) => {
      next[j] = ((next[j] ?? 0) + c) % 929;
      next[j + 1] = ((((next[j + 1] ?? 0) - c * power) % 929) + 929) % 929;
    });
    g = next;
  }
  return g.slice(1).reverse();
}

/** Reed-Solomon error correction codewords over GF(929) (ISO/IEC 15438 Annex). */
export function errorCorrection(
  data: readonly number[],
  level: number,
): number[] {
  const count = 2 ** (level + 1);
  const factors = ecFactors(count);
  const ec = new Array<number>(count).fill(0);
  for (const word of data) {
    const t = (word + (ec[count - 1] ?? 0)) % 929;
    for (let x = count - 1; x >= 0; x -= 1) {
      const previous = x > 0 ? (ec[x - 1] ?? 0) : 0;
      ec[x] = (previous + 929 - ((t * (factors[x] ?? 0)) % 929)) % 929;
    }
  }
  return ec.reverse().map((x) => (x > 0 ? 929 - x : 0));
}

function rowIndicators(
  row: number,
  options: Pdf417Options,
): { left: number; right: number } {
  const { rows, columns, ecLevel } = options;
  const base = 30 * Math.floor(row / 3);
  const r = Math.floor((rows - 1) / 3);
  const e = ecLevel * 3 + ((rows - 1) % 3);
  const c = columns - 1;
  switch (row % 3) {
    case 0:
      return { left: base + r, right: base + c };
    case 1:
      return { left: base + e, right: base + r };
    default:
      return { left: base + c, right: base + e };
  }
}

function bits(value: number, width: number): boolean[] {
  const out: boolean[] = [];
  for (let i = width - 1; i >= 0; i -= 1) out.push(((value >> i) & 1) === 1);
  return out;
}

/** One symbol from its data codewords (payload + control block, before padding). */
export function encodeSymbol(
  payload: readonly number[],
  controlBlock: readonly number[],
  options: Pdf417Options,
): Pdf417Symbol {
  const ecCount = 2 ** (options.ecLevel + 1);
  const capacity = options.rows * options.columns;
  const fill = capacity - (payload.length + controlBlock.length + ecCount + 1);
  if (fill < 0) throw new Error('PDF417 segment does not fit the symbol');
  const data = [
    capacity - ecCount,
    ...payload,
    ...new Array<number>(fill).fill(PADDING),
    ...controlBlock,
  ];
  const codewords = [...data, ...errorCorrection(data, options.ecLevel)];
  const matrix: boolean[][] = [];
  for (let row = 0; row < options.rows; row += 1) {
    const cluster = PDF417_PATTERNS[row % 3] ?? [];
    const pattern = (word: number) => bits(cluster[word] ?? 0, 17);
    const { left, right } = rowIndicators(row, options);
    const line = [...bits(START, 17), ...pattern(left)];
    for (let col = 0; col < options.columns; col += 1) {
      line.push(...pattern(codewords[row * options.columns + col] ?? 0));
    }
    line.push(...pattern(right), ...bits(STOP, 18));
    matrix.push(line);
  }
  return { codewords, matrix };
}

/** The payload split into Macro PDF417 segments, in order. */
export function macroPdf417(
  payload: Uint8Array,
  options: MacroOptions,
): Pdf417Symbol[] {
  const segments: Uint8Array[] = [];
  for (let i = 0; i < payload.length; i += options.segmentBytes) {
    segments.push(payload.subarray(i, i + options.segmentBytes));
  }
  if (segments.length === 0) segments.push(new Uint8Array());
  const fileName = compactUpperText(options.fileName);
  return segments.map((bytes, index) => {
    const control = [
      MACRO_MARKER,
      ...numeric5(index),
      ...options.fileId,
      MACRO_OPTIONAL,
      FIELD_FILE_NAME,
      ...fileName,
      MACRO_OPTIONAL,
      FIELD_SEGMENT_COUNT,
      ...numeric5(segments.length),
      ...(index === segments.length - 1 ? [MACRO_TERMINATOR] : []),
    ];
    return encodeSymbol(compactBytes(bytes), control, options);
  });
}
