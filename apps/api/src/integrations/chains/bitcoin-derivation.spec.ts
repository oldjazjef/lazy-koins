import {
  deriveAddress,
  extendedKind,
  parseExtendedKey,
} from './bitcoin-derivation';

/**
 * Published BIP84 test vectors (mnemonic "abandon … about", account m/84'/0'/0'). Public data
 * from the BIP itself — no wallet of anyone.
 */
const BIP84_ZPUB =
  'zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs';

describe('Bitcoin xpub derivation (BIP84 test vectors)', () => {
  const parsed = parseExtendedKey(BIP84_ZPUB);

  it('reads the zpub as a public account key', () => {
    expect(extendedKind(BIP84_ZPUB)).toBe('zpub');
    expect(parsed.node.privateKey).toBeNull();
  });

  it('derives the first receive addresses', () => {
    expect(deriveAddress(parsed, 0, 0)).toBe(
      'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu',
    );
    expect(deriveAddress(parsed, 0, 1)).toBe(
      'bc1qnjg0jd8228aq7egyzacy8cys3knf9xvrerkf9g',
    );
  });

  it('derives the first change address', () => {
    expect(deriveAddress(parsed, 1, 0)).toBe(
      'bc1q8c6fshw2dlwun7ekn9qwf37cu2rn755upcp6el',
    );
  });

  it('refuses anything but an extended public key', () => {
    expect(() => parseExtendedKey('bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu')).toThrow();
    expect(() => parseExtendedKey(`zpub${'1'.repeat(107)}`)).toThrow();
  });
});
