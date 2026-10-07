import { detectSecret } from './secrets';

/**
 * F6.2. Every "secret" here is a published test vector or synthetic noise — never a real key:
 * the BIP-39 "abandon … about" mnemonic, the Bitcoin wiki's WIF example, 0x00..01 style hex.
 */
const ABANDON_12 = `${'abandon '.repeat(11)}about`;
const ABANDON_24 = `${'abandon '.repeat(23)}art`;

describe('detectSecret (F6.2)', () => {
  it.each([12, 15, 18, 21, 24])('refuses a %i-word seed phrase', (count) => {
    const words = Array.from({ length: count }, (_, i) =>
      i % 2 === 0 ? 'zoo' : 'wrong',
    ).join(' ');
    expect(detectSecret(words)).toBe('seedPhrase');
  });

  it('finds a seed phrase in any case, numbered, comma- or line-separated, inside notes', () => {
    expect(detectSecret(ABANDON_12.toUpperCase())).toBe('seedPhrase');
    expect(detectSecret(ABANDON_24)).toBe('seedPhrase');
    expect(
      detectSecret(
        ABANDON_12.split(' ')
          .map((w, i) => `${i + 1}. ${w}`)
          .join('\n'),
      ),
    ).toBe('seedPhrase');
    expect(detectSecret(`Backup: ${ABANDON_12.split(' ').join(', ')} !`)).toBe(
      'seedPhrase',
    );
  });

  it('lets ordinary notes and short word runs through', () => {
    expect(detectSecret('Ledger Nano, Hauptwallet für Staking')).toBeNull();
    expect(detectSecret('abandon ability able about above absent')).toBeNull();
    expect(detectSecret('')).toBeNull();
  });

  it('refuses raw hex private keys with and without 0x', () => {
    const hex = '0123456789abcdef'.repeat(4);
    expect(detectSecret(hex)).toBe('privateKeyHex');
    expect(detectSecret(`0x${hex.toUpperCase()}`)).toBe('privateKeyHex');
    expect(detectSecret(`key ${hex} end`)).toBe('privateKeyHex');
  });

  it('refuses WIF keys (uncompressed 5…, compressed K…/L…)', () => {
    // The Bitcoin wiki's WIF example (a documentation key).
    expect(
      detectSecret('5HueCGU8rMjxEXxiPuD5BDku4MkFqeZyd4dZ1jvhTVqvbTLvyTJ'),
    ).toBe('privateKeyWif');
    expect(
      detectSecret('KwdMAjGmerYanjeui5SHS7JkmpZvVipYvB2LJGU1ZxJwYvP98617'),
    ).toBe('privateKeyWif');
  });

  it('refuses extended private keys but accepts extended public keys', () => {
    const body = 'A'.repeat(95);
    expect(detectSecret(`xprv9s21ZrQH143K${body}`)).toBe('extendedPrivateKey');
    expect(detectSecret(`zprvAWgYBBk7JR8G${body}`)).toBe('extendedPrivateKey');
    expect(
      detectSecret(
        'zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs',
      ),
    ).toBeNull();
  });

  it('refuses Solana secret keys (base58 of 64 bytes, byte arrays)', () => {
    const base58Of64 = '5'.repeat(1) + '2'.repeat(87);
    expect(detectSecret(base58Of64)).toBe('solanaSecretKey');
    const bytes = `[${Array.from({ length: 64 }, (_, i) => i).join(',')}]`;
    expect(detectSecret(bytes)).toBe('solanaSecretKey');
  });

  it('accepts public addresses of every family', () => {
    for (const address of [
      '0x000000000000000000000000000000000000dEaD',
      'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu',
      '1BoatSLRHtKNngkdXEeobR76b53LETtpyT',
      '11111111111111111111111111111111',
      'So11111111111111111111111111111111111111112',
      'cosmos1qypqxpq9qcrsszg2pvxq6rs0zqg3yyc5lzv7xu',
    ]) {
      expect(detectSecret(address)).toBeNull();
    }
  });
});
