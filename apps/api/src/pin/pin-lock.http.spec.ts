import {
  type CanActivate,
  Controller,
  type ExecutionContext,
  Get,
  Global,
  Module,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import type { AddressInfo } from 'node:net';
import { AiSettingsRepositoryPort } from '../ai/ports/ai-settings.repository.port';
import { InMemoryAiSettingsRepository } from '../ai/testing/in-memory-ai-settings.repository';
import { MailSettingsRepositoryPort } from '../mail/ports/mail.repository.port';
import { InMemoryMailSettingsRepository } from '../mail/testing/mail-doubles';
import { UserSettingsRepositoryPort } from '../settings/ports/user-settings.repository.port';
import { InMemoryUserSettingsRepository } from '../settings/testing/in-memory-user-settings.repository';
import { PinSessions, UNLOCK_HEADER } from './application/pin-sessions';
import { PinLockGuard } from './pin-lock.guard';
import { PinModule } from './pin.module';
import { UserPinRepositoryPort } from './ports/user-pin.repository.port';
import { fakeConfig } from './testing/pin-fixture';
import { InMemoryUserPinRepository } from './testing/in-memory-user-pin.repository';

/** A data route (projects, files, …) — refused while locked. */
@Controller('data')
class DataController {
  @Get()
  get() {
    return { secret: 'data' };
  }
}

/** Stands in for AccessTokenGuard: `x-test-user` names the user. */
class TestAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{
      headers: Record<string, string | undefined>;
      user?: unknown;
    }>();
    const user = request.headers['x-test-user'];
    if (!user) throw new UnauthorizedException();
    request.user = { userId: user, email: `${user}@it.dev` };
    return true;
  }
}

function moduleFor(mode: 'local' | 'dev') {
  @Global()
  @Module({
    providers: [
      { provide: ConfigService, useValue: fakeConfig({ AUTH_MODE: mode }) },
      { provide: UserPinRepositoryPort, useClass: InMemoryUserPinRepository },
      {
        provide: UserSettingsRepositoryPort,
        useClass: InMemoryUserSettingsRepository,
      },
      {
        provide: AiSettingsRepositoryPort,
        useClass: InMemoryAiSettingsRepository,
      },
      {
        provide: MailSettingsRepositoryPort,
        useClass: InMemoryMailSettingsRepository,
      },
    ],
    exports: [
      ConfigService,
      UserPinRepositoryPort,
      UserSettingsRepositoryPort,
      AiSettingsRepositoryPort,
      MailSettingsRepositoryPort,
    ],
  })
  class TestPortsModule {}
  return TestPortsModule;
}

async function start(mode: 'local' | 'dev') {
  const moduleRef = await Test.createTestingModule({
    imports: [moduleFor(mode), PinModule],
    controllers: [DataController],
    providers: [
      { provide: APP_GUARD, useClass: TestAuthGuard },
      { provide: APP_GUARD, useExisting: PinLockGuard },
    ],
  }).compile();
  const app = moduleRef.createNestApplication({ logger: false });
  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  await app.listen(0, '127.0.0.1');
  const { port } = app.getHttpServer().address() as AddressInfo;
  const call = async (
    method: string,
    path: string,
    options: { user?: string; token?: string; body?: unknown } = {},
  ) => {
    const response = await fetch(`http://127.0.0.1:${port}/api${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(options.user === undefined
          ? { 'x-test-user': 'anna' }
          : options.user
            ? { 'x-test-user': options.user }
            : {}),
        ...(options.token ? { [UNLOCK_HEADER]: options.token } : {}),
      },
      body:
        options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    const text = await response.text();
    return {
      status: response.status,
      body: (text ? JSON.parse(text) : null) as Record<string, unknown>,
    };
  };
  return { app, call };
}

describe('PIN lock over HTTP (F11.0p): the API refuses data while locked', () => {
  let running: Awaited<ReturnType<typeof start>> | undefined;

  afterEach(async () => {
    await running?.app.close();
    running = undefined;
  });

  it('desktop: no PIN → data flows; PIN set → 423 without token, 200 with it; lockAll → 423', async () => {
    running = await start('local');
    const { call, app } = running;
    expect((await call('GET', '/data')).status).toBe(200);

    const set = await call('PUT', '/pin', { body: { pin: '482913' } });
    expect(set.status).toBe(200);
    const token = (set.body['unlock'] as { token: string }).token;

    const locked = await call('GET', '/data');
    expect(locked).toMatchObject({
      status: 423,
      body: { code: 'pinLocked' },
    });
    expect(JSON.stringify(locked.body)).not.toContain('data"');
    expect((await call('GET', '/data', { token })).status).toBe(200);
    // The status endpoint answers while locked, and says so.
    expect(await call('GET', '/pin/status')).toMatchObject({
      status: 200,
      body: { hasPin: true, unlocked: false, required: true },
    });

    // OS lock / suspend: the desktop shell calls lockAll (RunningApi.lockAll).
    app.get(PinSessions).revokeAll();
    expect((await call('GET', '/data', { token })).status).toBe(423);

    // Wrong PIN → 422 with the wait; right PIN → a new token.
    expect(
      await call('POST', '/pin/unlock', { body: { pin: '000000' } }),
    ).toMatchObject({ status: 422, body: { code: 'wrongPin' } });
    const unlocked = await call('POST', '/pin/unlock', {
      body: { pin: '482913' },
    });
    expect(unlocked.status).toBe(200);
    const fresh = (unlocked.body['unlock'] as { token: string }).token;
    expect((await call('GET', '/data', { token: fresh })).status).toBe(200);

    // Lock: this session is closed again.
    expect((await call('POST', '/pin/lock', { token: fresh })).status).toBe(
      204,
    );
    expect((await call('GET', '/data', { token: fresh })).status).toBe(423);
  });

  it("a token is one user's: another user is not unlocked by it", async () => {
    running = await start('dev');
    const { call } = running;
    const set = await call('PUT', '/pin', { body: { pin: '1234' } });
    const token = (set.body['unlock'] as { token: string }).token;
    await call('PUT', '/pin', { user: 'bob', body: { pin: '5678' } });
    expect((await call('GET', '/data', { user: 'bob', token })).status).toBe(
      423,
    );
  });

  it('the PIN is validated before anything else: letters are a 400, never stored', async () => {
    running = await start('dev');
    expect(
      (await running.call('PUT', '/pin', { body: { pin: 'abcd' } })).status,
    ).toBe(400);
    expect((await running.call('GET', '/data')).status).toBe(200);
  });

  it('changing the PIN or the auto-lock needs an unlocked session', async () => {
    running = await start('local');
    const { call } = running;
    await call('PUT', '/pin', { body: { pin: '1234' } });
    expect(
      (
        await call('PUT', '/pin', {
          body: { pin: '5678', currentPin: '1234' },
        })
      ).status,
    ).toBe(423);
    expect(
      (await call('PUT', '/pin/auto-lock', { body: { minutes: 5 } })).status,
    ).toBe(423);
  });
});
