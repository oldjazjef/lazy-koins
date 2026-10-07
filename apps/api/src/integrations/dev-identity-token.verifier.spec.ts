import { DevIdentityTokenVerifier } from './dev-identity-token.verifier';

describe('DevIdentityTokenVerifier', () => {
  const verifier = new DevIdentityTokenVerifier();

  it('turns dev:<email> into an identity with a stable uid', async () => {
    await expect(verifier.verify('dev:Anna@LazyKoins.dev')).resolves.toEqual({
      uid: 'dev:anna@lazykoins.dev',
      email: 'anna@lazykoins.dev',
      name: null,
      signInProvider: 'dev',
      emailVerified: true,
    });
  });

  it('reads the sign-in time after # (F11.0p fresh sign-in), same uid', async () => {
    const at = Date.UTC(2026, 9, 7, 10, 0, 0);
    await expect(
      verifier.verify(`dev:anna@lazykoins.dev#${at}`),
    ).resolves.toMatchObject({
      uid: 'dev:anna@lazykoins.dev',
      email: 'anna@lazykoins.dev',
      authTime: '2026-10-07T10:00:00.000Z',
    });
  });

  it.each([
    'anna@lazykoins.dev',
    'dev:',
    'dev:not-an-email',
    'eyJhbGciOi...',
    'dev:anna@lazykoins.dev#abc',
  ])('rejects %s', async (token) => {
    await expect(verifier.verify(token)).resolves.toBeUndefined();
  });

  it('has no ambient identity: no token means anonymous', () => {
    expect(verifier.ambient()).toBeUndefined();
  });
});
