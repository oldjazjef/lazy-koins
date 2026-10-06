import { LOCAL_UID, LocalIdentityVerifier } from './local-identity.verifier';

describe('LocalIdentityVerifier', () => {
  const verifier = new LocalIdentityVerifier(' Me@Example.CH ');

  it('is the same single user with or without a token', async () => {
    const expected = {
      uid: LOCAL_UID,
      email: 'me@example.ch',
      emailVerified: true,
      name: null,
      signInProvider: 'local',
    };
    expect(verifier.ambient()).toEqual(expected);
    await expect(verifier.verify('anything')).resolves.toEqual(expected);
  });
});
