import { type ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { VerifiedIdentity } from '../users/domain/user';
import { AccessTokenGuard } from './access-token.guard';
import { IdentityTokenVerifierPort } from './ports/identity-token-verifier.port';
import type { PrincipalService } from './principal.service';

const IDENTITY: VerifiedIdentity = {
  uid: 'uid-1',
  email: 'a@b.dev',
  name: 'A',
  signInProvider: 'google.com',
  emailVerified: true,
};

class FakeVerifier extends IdentityTokenVerifierPort {
  async verify(token: string) {
    return token === 'good' ? IDENTITY : undefined;
  }
}

class AmbientVerifier extends FakeVerifier {
  override ambient() {
    return { ...IDENTITY, uid: 'local:owner' };
  }
}

function contextFor(authorization: string | undefined, isPublic: boolean) {
  const request: { headers: { authorization?: string }; user?: unknown } = {
    headers: { authorization },
  };
  const reflector = {
    getAllAndOverride: () => isPublic,
  } as unknown as Reflector;
  const context = {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  return { request, reflector, context };
}

const principals = {
  resolve: vi.fn(async (identity: VerifiedIdentity) => ({
    userId: `user-of-${identity.uid}`,
    email: 'a@b.dev',
  })),
} as unknown as PrincipalService;

describe('AccessTokenGuard', () => {
  it('resolves the principal for a valid token', async () => {
    const { request, reflector, context } = contextFor('Bearer good', false);
    await expect(
      new AccessTokenGuard(
        reflector,
        new FakeVerifier(),
        principals,
      ).canActivate(context),
    ).resolves.toBe(true);
    expect(request.user).toEqual({ userId: 'user-of-uid-1', email: 'a@b.dev' });
  });

  it.each([
    undefined,
    'good',
    'Bearer',
    'Bearer bad',
    'Basic good',
    'Bearer good extra',
  ])('rejects %s on a protected route', async (header) => {
    const { reflector, context } = contextFor(header, false);
    await expect(
      new AccessTokenGuard(
        reflector,
        new FakeVerifier(),
        principals,
      ).canActivate(context),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('lets anonymous and invalid callers through on a public route, without a principal', async () => {
    for (const header of [undefined, 'Bearer bad']) {
      const { request, reflector, context } = contextFor(header, true);
      await expect(
        new AccessTokenGuard(
          reflector,
          new FakeVerifier(),
          principals,
        ).canActivate(context),
      ).resolves.toBe(true);
      expect(request.user).toBeUndefined();
    }
  });

  it('still resolves the principal on a public route when the token is valid', async () => {
    const { request, reflector, context } = contextFor('Bearer good', true);
    await new AccessTokenGuard(
      reflector,
      new FakeVerifier(),
      principals,
    ).canActivate(context);
    expect(request.user).toBeDefined();
  });

  it('acts as the ambient identity (AUTH_MODE=local) when no token is sent', async () => {
    const { request, reflector, context } = contextFor(undefined, false);
    await expect(
      new AccessTokenGuard(
        reflector,
        new AmbientVerifier(),
        principals,
      ).canActivate(context),
    ).resolves.toBe(true);
    expect(request.user).toMatchObject({ userId: 'user-of-local:owner' });
  });

  it('accepts an MCP access token nowhere but on a public route (F11.16), not even in local mode', async () => {
    const pat = `lkmcp_${'x'.repeat(43)}`;
    const closed = contextFor(`Bearer ${pat}`, false);
    await expect(
      new AccessTokenGuard(
        closed.reflector,
        new AmbientVerifier(),
        principals,
      ).canActivate(closed.context),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(closed.request.user).toBeUndefined();

    const open = contextFor(`Bearer ${pat}`, true);
    await expect(
      new AccessTokenGuard(
        open.reflector,
        new AmbientVerifier(),
        principals,
      ).canActivate(open.context),
    ).resolves.toBe(true);
    expect(open.request.user).toBeUndefined();
  });
});
