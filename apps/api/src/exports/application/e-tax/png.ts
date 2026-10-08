import { crc32, deflateSync } from 'node:zlib';

/**
 * A 1-bit greyscale PNG of a module matrix, one pixel per module — the barcode images of the
 * E-Steuerauszug are embedded at their native size (290 × 35 for a PDF417 segment) and scaled
 * by the page, as eCH-0196 Beilage 2 §2.2/2.3 describes.
 */
export function monochromePng(matrix: readonly (readonly boolean[])[]): Buffer {
  const height = matrix.length;
  const width = matrix[0]?.length ?? 0;
  const stride = Math.ceil(width / 8);
  const raw = Buffer.alloc((stride + 1) * height);
  matrix.forEach((row, y) => {
    const offset = y * (stride + 1);
    raw[offset] = 0; // filter: none
    row.forEach((bar, x) => {
      // 1 = white in greyscale: a bar is a 0 bit.
      if (!bar) {
        const index = offset + 1 + (x >> 3);
        raw[index] = (raw[index] ?? 0) | (0x80 >> (x & 7));
      }
    });
  });
  const chunk = (type: string, data: Buffer): Buffer => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 1; // bit depth
  header[9] = 0; // greyscale
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
