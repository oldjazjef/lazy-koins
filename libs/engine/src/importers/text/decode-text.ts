/**
 * Bytes → text for CSV exports, pure (the engine does no I/O and has no `TextDecoder` in its
 * `lib`). Exchanges write UTF-8 with or without a BOM, Excel re-saves as UTF-16 LE with a BOM,
 * and some older exports are Windows-1252. The caller hands in the original bytes unchanged.
 */

export type TextEncoding = 'utf-8' | 'utf-16le' | 'utf-16be' | 'windows-1252';

export interface DecodedText {
  readonly text: string;
  readonly encoding: TextEncoding;
}

/** Windows-1252 differs from Latin-1 only in 0x80–0x9F. Undefined bytes map to U+FFFD. */
const CP1252_HIGH = [
  0x20ac, 0xfffd, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6,
  0x2030, 0x0160, 0x2039, 0x0152, 0xfffd, 0x017d, 0xfffd, 0xfffd, 0x2018,
  0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161,
  0x203a, 0x0153, 0xfffd, 0x017e, 0x0178,
];

/**
 * Decodes with the given encoding, or — `auto` — picks it from the BOM, then from the bytes
 * themselves. A BOM is always removed.
 */
export function decodeText(
  bytes: Uint8Array,
  encoding: TextEncoding | 'auto' = 'auto',
): DecodedText {
  if (encoding !== 'auto') return decodeAs(bytes, encoding);
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return { text: decodeUtf8(bytes, 3) ?? '', encoding: 'utf-8' };
  }
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    return { text: decodeUtf16(bytes, 2, true), encoding: 'utf-16le' };
  }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    return { text: decodeUtf16(bytes, 2, false), encoding: 'utf-16be' };
  }
  const utf16 = guessUtf16WithoutBom(bytes);
  if (utf16) {
    return {
      text: decodeUtf16(bytes, 0, utf16 === 'utf-16le'),
      encoding: utf16,
    };
  }
  const utf8 = decodeUtf8(bytes, 0);
  if (utf8 !== undefined) return { text: utf8, encoding: 'utf-8' };
  return { text: decodeCp1252(bytes), encoding: 'windows-1252' };
}

function decodeAs(bytes: Uint8Array, encoding: TextEncoding): DecodedText {
  switch (encoding) {
    case 'utf-16le':
    case 'utf-16be': {
      const le = encoding === 'utf-16le';
      const bom = le
        ? bytes[0] === 0xff && bytes[1] === 0xfe
        : bytes[0] === 0xfe && bytes[1] === 0xff;
      return { text: decodeUtf16(bytes, bom ? 2 : 0, le), encoding };
    }
    case 'windows-1252':
      return { text: decodeCp1252(bytes), encoding };
    default: {
      const start =
        bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0;
      return {
        text: decodeUtf8(bytes, start) ?? decodeCp1252(bytes.subarray(start)),
        encoding: 'utf-8',
      };
    }
  }
}

/**
 * Whether the bytes look like text at all (no NUL bytes outside UTF-16, few control
 * characters) — the upload's "is this really a CSV" check, from the bytes, not the extension.
 */
export function looksLikeText(bytes: Uint8Array): boolean {
  if (bytes.length === 0) return false;
  const bomUtf16 =
    (bytes[0] === 0xff && bytes[1] === 0xfe) ||
    (bytes[0] === 0xfe && bytes[1] === 0xff);
  if (bomUtf16 || guessUtf16WithoutBom(bytes)) return true;
  const sample = bytes.subarray(0, Math.min(bytes.length, 8192));
  let control = 0;
  for (const byte of sample) {
    if (byte === 0) return false;
    if (byte < 0x09 || (byte > 0x0d && byte < 0x20)) control += 1;
  }
  return control <= sample.length / 100;
}

function guessUtf16WithoutBom(
  bytes: Uint8Array,
): 'utf-16le' | 'utf-16be' | undefined {
  const pairs = Math.min(Math.floor(bytes.length / 2), 256);
  if (pairs < 2) return undefined;
  let evenZeros = 0;
  let oddZeros = 0;
  for (let i = 0; i < pairs; i += 1) {
    if (bytes[2 * i] === 0) evenZeros += 1;
    if (bytes[2 * i + 1] === 0) oddZeros += 1;
  }
  // ASCII text in UTF-16: one byte of every pair is zero, the other almost never.
  if (oddZeros > pairs * 0.9 && evenZeros < pairs * 0.1) return 'utf-16le';
  if (evenZeros > pairs * 0.9 && oddZeros < pairs * 0.1) return 'utf-16be';
  return undefined;
}

function decodeUtf16(
  bytes: Uint8Array,
  start: number,
  littleEndian: boolean,
): string {
  const units: number[] = [];
  for (let i = start; i + 1 < bytes.length; i += 2) {
    const a = bytes[i] ?? 0;
    const b = bytes[i + 1] ?? 0;
    units.push(littleEndian ? a | (b << 8) : (a << 8) | b);
  }
  return fromCodeUnits(units);
}

/** Strict UTF-8; `undefined` on any invalid sequence (the caller then tries Windows-1252). */
function decodeUtf8(bytes: Uint8Array, start: number): string | undefined {
  const units: number[] = [];
  let i = start;
  while (i < bytes.length) {
    const b0 = bytes[i] ?? 0;
    if (b0 < 0x80) {
      units.push(b0);
      i += 1;
      continue;
    }
    let need: number;
    let code: number;
    let min: number;
    if (b0 >= 0xc2 && b0 <= 0xdf) {
      need = 1;
      code = b0 & 0x1f;
      min = 0x80;
    } else if (b0 >= 0xe0 && b0 <= 0xef) {
      need = 2;
      code = b0 & 0x0f;
      min = 0x800;
    } else if (b0 >= 0xf0 && b0 <= 0xf4) {
      need = 3;
      code = b0 & 0x07;
      min = 0x10000;
    } else {
      return undefined;
    }
    for (let k = 1; k <= need; k += 1) {
      const next = bytes[i + k];
      if (next === undefined || (next & 0xc0) !== 0x80) return undefined;
      code = (code << 6) | (next & 0x3f);
    }
    if (code < min || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) {
      return undefined;
    }
    if (code >= 0x10000) {
      const v = code - 0x10000;
      units.push(0xd800 + (v >> 10), 0xdc00 + (v & 0x3ff));
    } else {
      units.push(code);
    }
    i += need + 1;
  }
  return fromCodeUnits(units);
}

function decodeCp1252(bytes: Uint8Array): string {
  const units: number[] = [];
  for (const byte of bytes) {
    units.push(
      byte >= 0x80 && byte <= 0x9f
        ? (CP1252_HIGH[byte - 0x80] ?? 0xfffd)
        : byte,
    );
  }
  return fromCodeUnits(units);
}

/** `String.fromCharCode` in chunks — a spread of a million arguments overflows the stack. */
function fromCodeUnits(units: readonly number[]): string {
  let out = '';
  for (let i = 0; i < units.length; i += 8192) {
    out += String.fromCharCode(...units.slice(i, i + 8192));
  }
  return out;
}
