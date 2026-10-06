import { SecretBox, secretHint } from './secret-box';

describe('SecretBox (AES-256-GCM)', () => {
  const box = new SecretBox('a-long-random-settings-encryption-key');

  it('round-trips and never stores the plain text', () => {
    const sealed = box.seal('sk-live-abcdef123456');
    expect(sealed.startsWith('enc:v1:')).toBe(true);
    expect(sealed).not.toContain('sk-live');
    expect(box.open(sealed)).toBe('sk-live-abcdef123456');
  });

  it('uses a fresh IV every time', () => {
    expect(box.seal('same')).not.toBe(box.seal('same'));
  });

  it('cannot be opened with another key or after tampering', () => {
    const sealed = box.seal('secret');
    expect(new SecretBox('another key').open(sealed)).toBeUndefined();
    const parts = sealed.split(':');
    const data = Buffer.from(parts[4] ?? '', 'base64');
    data[0] = (data[0] ?? 0) ^ 0xff;
    parts[4] = data.toString('base64');
    expect(box.open(parts.join(':'))).toBeUndefined();
    expect(box.open('plain text')).toBeUndefined();
  });

  it('is unavailable without a key', () => {
    const none = new SecretBox('');
    expect(none.available).toBe(false);
    expect(() => none.seal('x')).toThrow('SETTINGS_ENCRYPTION_KEY');
    expect(none.open(box.seal('x'))).toBeUndefined();
  });

  it('hints at the last four characters only', () => {
    expect(secretHint('sk-abcdef1234')).toBe('…1234');
    expect(secretHint('abc')).toBe('…');
  });
});
