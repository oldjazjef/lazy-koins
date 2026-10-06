import { createReadStream } from 'node:fs';
import { open } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { createInflateRaw } from 'node:zlib';
import { EstvSourceError } from '../../../rates/ports/estv.port';

/**
 * Just enough of ZIP to stream one entry out of a downloaded archive without loading it: the
 * central directory (end record at the file's end), the entry's local header, then the entry's
 * bytes through `inflateRaw` (method 8) or as-is (method 0). No ZIP64, no encryption — the ICTax
 * archives need neither (≈ 40 MB, the XML < 4 GB).
 */

export interface ZipEntry {
  readonly name: string;
  readonly method: number;
  readonly compressedSize: number;
  readonly size: number;
  readonly localHeaderOffset: number;
}

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

function bad(message: string): EstvSourceError {
  return new EstvSourceError('badArchive', message);
}

/** The entries of the archive at `path`, from its central directory. */
export async function listZipEntries(path: string): Promise<ZipEntry[]> {
  const file = await open(path, 'r');
  try {
    const { size } = await file.stat();
    const tailLength = Math.min(size, 22 + 0xffff);
    const tail = Buffer.alloc(tailLength);
    await file.read(tail, 0, tailLength, size - tailLength);
    let eocd = -1;
    for (let i = tailLength - 22; i >= 0; i -= 1) {
      if (tail.readUInt32LE(i) === EOCD) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) throw bad('Das Archiv ist keine ZIP-Datei');
    const count = tail.readUInt16LE(eocd + 10);
    const cdSize = tail.readUInt32LE(eocd + 12);
    const cdOffset = tail.readUInt32LE(eocd + 16);
    if (cdOffset === 0xffffffff || cdOffset + cdSize > size) {
      throw bad('Das ZIP-Archiv ist beschädigt oder ZIP64');
    }
    const cd = Buffer.alloc(cdSize);
    await file.read(cd, 0, cdSize, cdOffset);
    const entries: ZipEntry[] = [];
    let at = 0;
    for (let n = 0; n < count; n += 1) {
      if (at + 46 > cd.length || cd.readUInt32LE(at) !== CENTRAL) {
        throw bad('Das ZIP-Verzeichnis ist beschädigt');
      }
      const nameLength = cd.readUInt16LE(at + 28);
      const extraLength = cd.readUInt16LE(at + 30);
      const commentLength = cd.readUInt16LE(at + 32);
      entries.push({
        method: cd.readUInt16LE(at + 10),
        compressedSize: cd.readUInt32LE(at + 20),
        size: cd.readUInt32LE(at + 24),
        localHeaderOffset: cd.readUInt32LE(at + 42),
        name: cd.toString('utf8', at + 46, at + 46 + nameLength),
      });
      at += 46 + nameLength + extraLength + commentLength;
    }
    return entries;
  } finally {
    await file.close();
  }
}

/** The bytes of one entry, decompressed, as a stream. */
export async function openZipEntry(
  path: string,
  entry: ZipEntry,
): Promise<Readable> {
  if (entry.method !== 0 && entry.method !== 8) {
    throw bad(`Nicht unterstützte ZIP-Kompression (${entry.method})`);
  }
  const file = await open(path, 'r');
  let dataStart: number;
  try {
    const header = Buffer.alloc(30);
    await file.read(header, 0, 30, entry.localHeaderOffset);
    if (header.readUInt32LE(0) !== LOCAL) {
      throw bad('Der ZIP-Eintrag ist beschädigt');
    }
    dataStart =
      entry.localHeaderOffset +
      30 +
      header.readUInt16LE(26) +
      header.readUInt16LE(28);
  } finally {
    await file.close();
  }
  if (entry.compressedSize === 0) return Readable.from([]);
  const raw = createReadStream(path, {
    start: dataStart,
    end: dataStart + entry.compressedSize - 1,
    highWaterMark: 256 * 1024,
  });
  if (entry.method === 0) return raw;
  const inflate = createInflateRaw({ chunkSize: 256 * 1024 });
  raw.on('error', (error) => inflate.destroy(error));
  return raw.pipe(inflate);
}
