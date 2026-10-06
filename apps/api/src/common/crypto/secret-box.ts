import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';

const PREFIX = 'enc:v1:';

/**
 * AES-256-GCM for secrets a user saves in the settings (the AI provider's API key; later the
 * CoinGecko/Etherscan keys, F6.7). Ported from surf-lend's `settings/secret-box.ts`. The key is
 * SHA-256 of `SETTINGS_ENCRYPTION_KEY`, so any long random string works. Format:
 * `enc:v1:<iv>:<auth tag>:<ciphertext>`, each base64. A fresh 96-bit IV per seal.
 */
export class SecretBox {
  private readonly key: Buffer | undefined;

  constructor(secret: string) {
    this.key =
      secret.length > 0
        ? createHash('sha256').update(secret).digest()
        : undefined;
  }

  /** False without `SETTINGS_ENCRYPTION_KEY`: nothing can be sealed then. */
  get available(): boolean {
    return this.key !== undefined;
  }

  seal(plain: string): string {
    if (!this.key) throw new Error('SETTINGS_ENCRYPTION_KEY is not set');
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return `${PREFIX}${[iv, cipher.getAuthTag(), data].map((part) => part.toString('base64')).join(':')}`;
  }

  /** `undefined` when the value cannot be decrypted (no key, a changed key, tampering). */
  open(sealed: string): string | undefined {
    if (!this.key || !sealed.startsWith(PREFIX)) return undefined;
    const [iv, tag, data] = sealed
      .slice(PREFIX.length)
      .split(':')
      .map((part) => Buffer.from(part, 'base64'));
    if (!iv || !tag || !data) return undefined;
    try {
      const decipher = createDecipheriv('aes-256-gcm', this.key, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(data), decipher.final()]).toString(
        'utf8',
      );
    } catch {
      return undefined;
    }
  }
}

/** What the settings page may show of a key: its last four characters. */
export function secretHint(plain: string): string {
  return plain.length <= 4 ? '…' : `…${plain.slice(-4)}`;
}
