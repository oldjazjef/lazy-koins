import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

/**
 * The PIN's hash (F11.0p): **scrypt** from node:crypto (no extra dependency, no native module).
 *
 * Parameters: N = 2^15 (cost), r = 8 (block size), p = 1, a 16-byte random salt per PIN, 32-byte
 * output — about 30–100 ms and 32 MiB per hash, the OWASP baseline for scrypt. They are stored in
 * the hash itself, `scrypt$<log2 N>$<r>$<p>$<salt b64>$<hash b64>`, so they can be raised later
 * without breaking stored PINs (`needsRehash`).
 *
 * A 4–8 digit PIN has at most 10^8 values: the hash only protects it from being read; brute
 * force is stopped by the growing wait between attempts (pin.ts), not by the hash. Someone who
 * copies the database file can try every PIN offline — the PIN guards an open app, not the file.
 */
export const PIN_HASH_PARAMS = {
  logN: 15,
  r: 8,
  p: 1,
  saltBytes: 16,
  keyBytes: 32,
} as const;

const MAXMEM = 64 * 1024 * 1024;

interface ScryptParams {
  readonly logN: number;
  readonly r: number;
  readonly p: number;
}

function derive(
  pin: string,
  salt: Buffer,
  params: ScryptParams,
  keyBytes: number,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      pin.normalize('NFKC'),
      salt,
      keyBytes,
      { N: 2 ** params.logN, r: params.r, p: params.p, maxmem: MAXMEM },
      (error, key) => (error ? reject(error) : resolve(key)),
    );
  });
}

/** A new hash with a fresh salt. */
export async function hashPin(
  pin: string,
  params: ScryptParams = PIN_HASH_PARAMS,
): Promise<string> {
  const salt = randomBytes(PIN_HASH_PARAMS.saltBytes);
  const key = await derive(pin, salt, params, PIN_HASH_PARAMS.keyBytes);
  return [
    'scrypt',
    params.logN,
    params.r,
    params.p,
    salt.toString('base64'),
    key.toString('base64'),
  ].join('$');
}

function parse(
  stored: string,
): { params: ScryptParams; salt: Buffer; key: Buffer } | undefined {
  const [scheme, logN, r, p, salt, key, ...rest] = stored.split('$');
  if (scheme !== 'scrypt' || rest.length > 0 || !salt || !key) return;
  const params = { logN: Number(logN), r: Number(r), p: Number(p) };
  const sane =
    Number.isInteger(params.logN) &&
    params.logN >= 10 &&
    params.logN <= 20 &&
    Number.isInteger(params.r) &&
    params.r >= 1 &&
    params.r <= 32 &&
    Number.isInteger(params.p) &&
    params.p >= 1 &&
    params.p <= 4;
  if (!sane) return;
  return {
    params,
    salt: Buffer.from(salt, 'base64'),
    key: Buffer.from(key, 'base64'),
  };
}

/** Constant-time comparison; a malformed stored hash never matches. */
export async function verifyPin(pin: string, stored: string): Promise<boolean> {
  const parsed = parse(stored);
  if (!parsed || parsed.key.length === 0) return false;
  const key = await derive(pin, parsed.salt, parsed.params, parsed.key.length);
  return key.length === parsed.key.length && timingSafeEqual(key, parsed.key);
}

/** Whether a stored hash uses weaker parameters than today's. */
export function needsRehash(stored: string): boolean {
  const parsed = parse(stored);
  return (
    !parsed ||
    parsed.params.logN < PIN_HASH_PARAMS.logN ||
    parsed.params.r < PIN_HASH_PARAMS.r
  );
}
