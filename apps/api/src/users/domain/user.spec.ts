import { displayNameFor, type VerifiedIdentity } from './user';

const identity = (over: Partial<VerifiedIdentity>): VerifiedIdentity => ({
  uid: 'u',
  email: null,
  emailVerified: false,
  name: null,
  signInProvider: 'dev',
  ...over,
});

describe('displayNameFor', () => {
  it('prefers the provider name, then the e-mail local part', () => {
    expect(displayNameFor(identity({ name: '  Anna Muster ' }))).toBe(
      'Anna Muster',
    );
    expect(displayNameFor(identity({ email: 'anna@lazykoins.dev' }))).toBe(
      'anna',
    );
  });

  it('falls back to a generic name', () => {
    expect(displayNameFor(identity({}))).toBe('Benutzer');
  });
});
