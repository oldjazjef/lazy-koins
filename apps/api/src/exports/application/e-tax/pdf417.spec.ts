import { randomBytes } from 'node:crypto';
import { code128c, code128cValues } from './code128';
import { macroFileId, pageBarcodeDigits } from './e-tax-html';
import { compactBytes, errorCorrection, macroPdf417 } from './pdf417';
import { monochromePng } from './png';
import {
  codewordsOf,
  readMonochromePng,
  readSegment,
} from './testing/barcode-reader';

const ECH = { columns: 13, rows: 35, ecLevel: 4, segmentBytes: 450 };

describe('PDF417 Macro (eCH-0196 Beilage 2 §2.2)', () => {
  it('has the error correction factors of ISO/IEC 15438 for level 4', () => {
    // One data codeword 1: the check codewords are the generator's coefficients, highest first.
    const ec = errorCorrection([1], 4);
    expect(ec).toHaveLength(32);
    // The factors of level 4 as published in the standard's table, lowest degree first.
    const level4 = [
      361, 575, 922, 525, 176, 586, 640, 321, 536, 742, 677, 742, 687, 284, 193,
      517, 273, 494, 263, 147, 593, 800, 571, 320, 803, 133, 231, 390, 685, 330,
      63, 410,
    ];
    expect(ec).toEqual([...level4].reverse());
  });

  it('compacts bytes 6 → 5 codewords and the rest one by one', () => {
    expect(compactBytes(new Uint8Array([1, 2, 3, 4, 5, 6]))[0]).toBe(924);
    const words = compactBytes(new Uint8Array([1, 2, 3, 4, 5, 6, 7]));
    expect(words[0]).toBe(901);
    expect(words).toHaveLength(1 + 5 + 1);
    expect(words.at(-1)).toBe(7);
  });

  it('splits a payload into 13 × 35 symbols that read back to the same bytes', () => {
    for (const size of [1, 449, 450, 451, 905, 1803]) {
      const payload = randomBytes(size);
      const fileId = [112, 170, 169, 206];
      const symbols = macroPdf417(payload, {
        ...ECH,
        fileId,
        fileName: 'CH00000LK1234567890AB2025123101',
      });
      expect(symbols).toHaveLength(Math.ceil(size / 450));
      const segments = symbols.map((s) => {
        expect(s.matrix).toHaveLength(35);
        for (const row of s.matrix) expect(row).toHaveLength(290);
        // The image the PDF embeds is that matrix, one pixel per module.
        const back = readMonochromePng(monochromePng(s.matrix));
        expect(back).toEqual(s.matrix);
        return readSegment(codewordsOf(back, 13), 4, 4);
      });
      expect(segments.map((s) => s.index)).toEqual(segments.map((_, i) => i));
      expect(segments.map((s) => s.last)).toEqual(
        segments.map((_, i) => i === segments.length - 1),
      );
      for (const s of segments) expect(s.fileId).toEqual(fileId);
      expect(Buffer.concat(segments.map((s) => s.bytes))).toEqual(payload);
    }
  });

  it('refuses a file name outside [A-Z0-9 ] (text compaction of the macro field)', () => {
    expect(() =>
      macroPdf417(new Uint8Array([1]), {
        ...ECH,
        fileId: [1],
        fileName: 'ch-1',
      }),
    ).toThrow();
  });

  it('derives four file-id codewords from the statement id, the same each time', () => {
    const id = macroFileId('CH00000LK1234567890AB2025123101');
    expect(id).toHaveLength(4);
    expect(id.every((w) => w >= 0 && w < 900)).toBe(true);
    expect(macroFileId('CH00000LK1234567890AB2025123101')).toEqual(id);
  });
});

describe('CODE128C page barcode (eCH-0196 Beilage 2 §2.4)', () => {
  it('encodes digit pairs with start C, checksum and stop', () => {
    // 105 + 1·12 + 2·34 = 185 → 185 mod 103 = 82.
    expect(code128cValues('1234')).toEqual([105, 12, 34, 82, 106]);
    // 11 modules per symbol, 13 for the stop.
    expect(code128c('1234')).toHaveLength(11 * 4 + 13);
    expect(() => code128cValues('123')).toThrow();
  });

  it('builds the 16 digits: form, version, organisation, page, 2D, orientation, direction', () => {
    expect(pageBarcodeDigits(1, false)).toBe('1972200000001011');
    expect(pageBarcodeDigits(12, true)).toBe('1962200000012111');
    expect(pageBarcodeDigits(3, true)).toHaveLength(16);
  });
});
