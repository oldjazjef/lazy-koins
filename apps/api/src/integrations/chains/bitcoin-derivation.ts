import { ripemd160 } from '@noble/hashes/legacy';
import { sha256 } from '@noble/hashes/sha2';
import { base58check, bech32 } from '@scure/base';
import { HDKey } from '@scure/bip32';

/**
 * Bitcoin extended **public** keys → addresses (F6.1: xpub/ypub/zpub), with `@scure/bip32` for
 * the BIP32 derivation and `@scure/base` for bech32/base58check. Only public derivation — a
 * private key never exists here (F6.2 refuses xprv/zprv before anything is stored).
 *
 * - `xpub` (BIP44): P2PKH `1…`
 * - `ypub` (BIP49): P2SH-P2WPKH `3…`
 * - `zpub` (BIP84): P2WPKH `bc1q…`
 *
 * Addresses are `<chain>/<index>` below the account key: chain 0 = receive, 1 = change.
 */

const VERSIONS = {
  xpub: 0x0488b21e,
  ypub: 0x049d7cb2,
  zpub: 0x04b24746,
} as const;
const XPRV = 0x0488ade4;

export type ExtendedKind = keyof typeof VERSIONS;

const b58c = base58check(sha256);

function hash160(bytes: Uint8Array): Uint8Array {
  return ripemd160(sha256(bytes));
}

export function extendedKind(key: string): ExtendedKind | undefined {
  const prefix = key.slice(0, 4);
  return prefix === 'xpub' || prefix === 'ypub' || prefix === 'zpub'
    ? prefix
    : undefined;
}

/** Parses an account-level extended public key; throws on anything else. */
export function parseExtendedKey(key: string): {
  kind: ExtendedKind;
  node: HDKey;
} {
  const kind = extendedKind(key);
  if (!kind) throw new Error('Not an xpub/ypub/zpub');
  const node = HDKey.fromExtendedKey(key, {
    public: VERSIONS[kind],
    private: XPRV,
  });
  if (node.privateKey) throw new Error('Not a public key');
  return { kind, node };
}

function addressOf(kind: ExtendedKind, publicKey: Uint8Array): string {
  const keyHash = hash160(publicKey);
  switch (kind) {
    case 'zpub':
      return bech32.encode('bc', [0, ...bech32.toWords(keyHash)]);
    case 'ypub': {
      const redeem = Uint8Array.from([0x00, 0x14, ...keyHash]);
      return b58c.encode(Uint8Array.from([0x05, ...hash160(redeem)]));
    }
    case 'xpub':
      return b58c.encode(Uint8Array.from([0x00, ...keyHash]));
  }
}

/** The address at `<chain>/<index>` below the account key. */
export function deriveAddress(
  parsed: { kind: ExtendedKind; node: HDKey },
  chain: 0 | 1,
  index: number,
): string {
  const child = parsed.node.deriveChild(chain).deriveChild(index);
  if (!child.publicKey) throw new Error('Derivation failed');
  return addressOf(parsed.kind, child.publicKey);
}
