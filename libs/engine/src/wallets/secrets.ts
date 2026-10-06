import { wordlist as BIP39_ENGLISH } from '@scure/bip39/wordlists/english';
import { base58Decode } from './networks';

/**
 * F6.2: seed phrases and private keys are recognised and refused **before** anything is stored
 * or logged. `detectSecret` only answers *what kind* of secret it saw — never where or which
 * words — so the caller can refuse with a message that contains nothing of the input.
 *
 * Recognised:
 * - BIP-39 seed phrases: 12/15/18/21/24 words of the English list (the bundled list from
 *   `@scure/bip39`), anywhere in the text as a run of consecutive list words.
 * - Raw private keys: 64 hex digits (with or without `0x`), WIF (`5…` 51 chars, `K…`/`L…`
 *   52 chars, testnet `9…`/`c…`), extended private keys (`xprv/yprv/zprv/tprv/uprv/vprv…`),
 *   Solana secret keys (base58 of 64 bytes, or a JSON array of 64 byte values).
 */
export const SECRET_KINDS = [
  'seedPhrase',
  'privateKeyHex',
  'privateKeyWif',
  'extendedPrivateKey',
  'solanaSecretKey',
] as const;
export type SecretKind = (typeof SECRET_KINDS)[number];

const SEED_LENGTHS = [12, 15, 18, 21, 24];
const WORDS: ReadonlySet<string> = new Set(BIP39_ENGLISH);

function seedPhraseIn(text: string): boolean {
  const tokens = text
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((token) => token.length > 0);
  // Longest run of consecutive list words; a numbered list ("1. abandon 2. ability") still
  // counts because the numbers are separators here.
  let run = 0;
  let longest = 0;
  for (const token of tokens) {
    run = WORDS.has(token) ? run + 1 : 0;
    longest = Math.max(longest, run);
  }
  return longest >= Math.min(...SEED_LENGTHS);
}

const EXTENDED_PRIVATE = /\b[xyztuv]prv[1-9A-HJ-NP-Za-km-z]{100,112}\b/;
const HEX_64 = /(?:^|[^0-9a-fA-F])(?:0x)?[0-9a-fA-F]{64}(?![0-9a-fA-F])/;
const WIF =
  /(?:^|[^1-9A-HJ-NP-Za-km-z])([5][1-9A-HJ-NP-Za-km-z]{50}|[KLc][1-9A-HJ-NP-Za-km-z]{51}|9[1-9A-HJ-NP-Za-km-z]{50})(?![1-9A-HJ-NP-Za-km-z])/;
const BASE58_RUN =
  /(?<![0-9A-Za-z])[1-9A-HJ-NP-Za-km-z]{85,90}(?![0-9A-Za-z])/g;
const BYTE_ARRAY = /\[\s*(\d{1,3}\s*,\s*){63}\d{1,3}\s*\]/;

function solanaSecretIn(text: string): boolean {
  if (BYTE_ARRAY.test(text)) return true;
  for (const match of text.matchAll(BASE58_RUN)) {
    if (base58Decode(match[0])?.length === 64) return true;
  }
  return false;
}

/**
 * The kind of secret found in `text`, or `null`. Checks every field a user types into the
 * wallet form (address, label, notes). Never include `text` in an error or a log line.
 */
export function detectSecret(text: string): SecretKind | null {
  if (text.trim() === '') return null;
  if (EXTENDED_PRIVATE.test(text)) return 'extendedPrivateKey';
  if (WIF.test(text)) return 'privateKeyWif';
  if (solanaSecretIn(text)) return 'solanaSecretKey';
  if (HEX_64.test(text)) return 'privateKeyHex';
  if (seedPhraseIn(text)) return 'seedPhrase';
  return null;
}
