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

  it.each(['anna@lazykoins.dev', 'dev:', 'dev:not-an-email', 'eyJhbGciOi...'])(
    'rejects %s',
    async (token) => {
      await expect(verifier.verify(token)).resolves.toBeUndefined();
    },
  );

  it('has no ambient identity: no token means anonymous', () => {
    expect(verifier.ambient()).toBeUndefined();
  });
});
