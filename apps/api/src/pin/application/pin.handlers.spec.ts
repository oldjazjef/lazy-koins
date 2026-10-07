import { HttpException } from '@nestjs/common';
import { SecretBox } from '../../common/crypto/secret-box';
import { pinSetup } from '../testing/pin-fixture';
import {
  ForgotPinCommand,
  GetPinStatusQuery,
  LockCommand,
  RemovePinCommand,
  SetAutoLockCommand,
  SetPinCommand,
  UnlockCommand,
} from './pin.handlers';

const anna = { userId: 'anna' };

/** The HTTP status and body a handler failed with. */
async function failure(
  work: Promise<unknown>,
): Promise<{ status: number; body: Record<string, unknown> }> {
  try {
    await work;
  } catch (error) {
    if (error instanceof HttpException) {
      return {
        status: error.getStatus(),
        body: error.getResponse() as Record<string, unknown>,
      };
    }
    throw error;
  }
  throw new Error('expected a failure');
}

describe('PIN lock handlers (F11.0p)', () => {
  it('without a PIN: unlocked, nothing to wait for; desktop says it is required', async () => {
    const web = pinSetup('web');
    expect(await web.status.execute(new GetPinStatusQuery(anna))).toMatchObject(
      {
        mode: 'web',
        hasPin: false,
        required: false,
        unlocked: true,
        maxFailures: 10,
      },
    );
    const desktop = pinSetup('desktop');
    expect(
      await desktop.status.execute(new GetPinStatusQuery(anna)),
    ).toMatchObject({ mode: 'desktop', required: true, maxFailures: null });
  });

  it('sets a PIN as a scrypt hash, unlocks this session, and locks without its token', async () => {
    const t = pinSetup('web');
    const { status, unlock } = await t.set.execute(
      new SetPinCommand(anna, '482913', undefined, 30),
    );
    expect(status).toMatchObject({
      hasPin: true,
      unlocked: true,
      autoLockMinutes: 30,
    });
    const row = t.pins.rows.get('anna');
    expect(row?.pinHash.startsWith('scrypt$')).toBe(true);
    expect(JSON.stringify(row)).not.toContain('482913');
    expect(
      (await t.status.execute(new GetPinStatusQuery(anna, unlock.token)))
        .unlocked,
    ).toBe(true);
    expect((await t.status.execute(new GetPinStatusQuery(anna))).unlocked).toBe(
      false,
    );
    expect(
      (await t.status.execute(new GetPinStatusQuery(anna, 'forged-token')))
        .unlocked,
    ).toBe(false);
  });

  it('refuses a PIN that is not 4–8 digits', async () => {
    const t = pinSetup('web');
    expect(
      await failure(t.set.execute(new SetPinCommand(anna, '12a4'))),
    ).toMatchObject({ status: 422, body: { code: 'invalidPin' } });
  });

  it('unlocks with the right PIN → a token for this user only', async () => {
    const t = pinSetup('desktop');
    await t.set.execute(new SetPinCommand(anna, '1234'));
    t.sessions.revokeAll();
    const { unlock, status } = await t.unlock.execute(
      new UnlockCommand(anna, '1234'),
    );
    expect(status.unlocked).toBe(true);
    expect(t.sessions.touch(unlock.token, 'anna')).toBeDefined();
    expect(t.sessions.touch(unlock.token, 'bob')).toBeUndefined();
  });

  it('throttles wrong PINs with a growing wait that survives (stored), then resets on success', async () => {
    const t = pinSetup('desktop');
    await t.set.execute(new SetPinCommand(anna, '1234'));

    // 1st wrong: no wait yet.
    expect(
      await failure(t.unlock.execute(new UnlockCommand(anna, '0000'))),
    ).toMatchObject({
      status: 422,
      body: { code: 'wrongPin', retryAfterSeconds: 0, failedAttempts: 1 },
    });
    // 2nd wrong: 1 s.
    expect(
      await failure(t.unlock.execute(new UnlockCommand(anna, '0000'))),
    ).toMatchObject({ body: { retryAfterSeconds: 1, failedAttempts: 2 } });
    // Too early — even the right PIN waits: 429.
    expect(
      await failure(t.unlock.execute(new UnlockCommand(anna, '1234'))),
    ).toMatchObject({
      status: 429,
      body: { code: 'pinThrottled', retryAfterSeconds: 1 },
    });
    t.clock.advance(1);
    // 3rd wrong: 2 s, persisted in the row.
    await failure(t.unlock.execute(new UnlockCommand(anna, '9999')));
    expect(t.pins.rows.get('anna')).toMatchObject({ failedAttempts: 3 });
    expect(
      (await t.status.execute(new GetPinStatusQuery(anna))).retryAfterSeconds,
    ).toBe(2);
    t.clock.advance(2);
    await t.unlock.execute(new UnlockCommand(anna, '1234'));
    expect(t.pins.rows.get('anna')).toMatchObject({
      failedAttempts: 0,
      nextAttemptAt: null,
    });
  });

  it('checks one attempt at a time per user (no parallel guessing)', async () => {
    const t = pinSetup('desktop');
    await t.set.execute(new SetPinCommand(anna, '1234'));
    const results = await Promise.allSettled([
      t.unlock.execute(new UnlockCommand(anna, '0000')),
      t.unlock.execute(new UnlockCommand(anna, '0001')),
      t.unlock.execute(new UnlockCommand(anna, '0002')),
    ]);
    const codes = results.map((r) =>
      r.status === 'rejected'
        ? ((r.reason as HttpException).getResponse() as { code: string }).code
        : 'ok',
    );
    // The second attempt waits 1 s after the first failure: the third is throttled.
    expect(codes).toEqual(['wrongPin', 'wrongPin', 'pinThrottled']);
  });

  it('web: after 10 wrong attempts a new sign-in is required; a sign-in after that lets it try again', async () => {
    const t = pinSetup('web');
    await t.set.execute(new SetPinCommand(anna, '1234'));
    let last: { status: number; body: Record<string, unknown> } | undefined;
    for (let i = 0; i < 10; i += 1) {
      last = await failure(t.unlock.execute(new UnlockCommand(anna, '0000')));
      t.clock.advance(1000);
    }
    expect(last).toMatchObject({
      status: 403,
      body: { code: 'reloginRequired' },
    });
    expect(await t.status.execute(new GetPinStatusQuery(anna))).toMatchObject({
      reloginRequired: true,
      failedAttempts: 10,
    });
    // The right PIN does not help without signing in again.
    expect(
      await failure(t.unlock.execute(new UnlockCommand(anna, '1234'))),
    ).toMatchObject({ status: 403, body: { code: 'reloginRequired' } });
    // An old sign-in does not count either.
    const before = new Date(t.clock.ms - 3_600_000).toISOString();
    expect(
      await failure(
        t.unlock.execute(
          new UnlockCommand({ userId: 'anna', authTime: before }, '1234'),
        ),
      ),
    ).toMatchObject({ body: { code: 'reloginRequired' } });
    t.clock.advance(5);
    const { status } = await t.unlock.execute(
      new UnlockCommand({ userId: 'anna', authTime: t.clock.iso() }, '1234'),
    );
    expect(status).toMatchObject({
      unlocked: true,
      reloginRequired: false,
      failedAttempts: 0,
    });
  });

  it('desktop: no sign-in limit, the wait keeps growing', async () => {
    const t = pinSetup('desktop');
    await t.set.execute(new SetPinCommand(anna, '1234'));
    for (let i = 0; i < 12; i += 1) {
      const result = await failure(
        t.unlock.execute(new UnlockCommand(anna, '0000')),
      );
      expect(result.body['code']).toBe('wrongPin');
      t.clock.advance(1000);
    }
    expect(
      (await t.status.execute(new GetPinStatusQuery(anna))).retryAfterSeconds,
    ).toBe(0);
  });

  it('changing the PIN needs the current one and locks the other sessions', async () => {
    const t = pinSetup('web');
    const first = await t.set.execute(new SetPinCommand(anna, '1234'));
    expect(
      await failure(t.set.execute(new SetPinCommand(anna, '5678'))),
    ).toMatchObject({ status: 400, body: { code: 'currentPinRequired' } });
    expect(
      await failure(t.set.execute(new SetPinCommand(anna, '5678', '1111'))),
    ).toMatchObject({ status: 422, body: { code: 'wrongPin' } });
    const changed = await t.set.execute(
      new SetPinCommand(anna, '5678', '1234'),
    );
    expect(t.sessions.touch(first.unlock.token, 'anna')).toBeUndefined();
    expect(t.sessions.touch(changed.unlock.token, 'anna')).toBeDefined();
    t.sessions.revokeAll();
    await t.unlock.execute(new UnlockCommand(anna, '5678'));
  });

  it('removing: web only, with the current PIN', async () => {
    const web = pinSetup('web');
    await web.set.execute(new SetPinCommand(anna, '1234'));
    expect(
      await failure(web.remove.execute(new RemovePinCommand(anna, '0000'))),
    ).toMatchObject({ status: 422 });
    expect(
      await web.remove.execute(new RemovePinCommand(anna, '1234')),
    ).toMatchObject({ hasPin: false, unlocked: true });

    const desktop = pinSetup('desktop');
    await desktop.set.execute(new SetPinCommand(anna, '1234'));
    expect(
      await failure(desktop.remove.execute(new RemovePinCommand(anna, '1234'))),
    ).toMatchObject({ status: 409, body: { code: 'pinRequired' } });
  });

  it('lock ends the session; the token expires after the auto-lock time without activity', async () => {
    const t = pinSetup('web');
    const { unlock } = await t.set.execute(
      new SetPinCommand(anna, '1234', undefined, 5),
    );
    t.clock.advance(4 * 60);
    expect(t.sessions.touch(unlock.token, 'anna')).toBeDefined(); // activity renews
    t.clock.advance(4 * 60);
    expect(t.sessions.touch(unlock.token, 'anna')).toBeDefined();
    t.clock.advance(5 * 60 + 1);
    expect(t.sessions.touch(unlock.token, 'anna')).toBeUndefined();

    const again = await t.unlock.execute(new UnlockCommand(anna, '1234'));
    await t.lock.execute(new LockCommand(again.unlock.token));
    expect(t.sessions.touch(again.unlock.token, 'anna')).toBeUndefined();
  });

  it('changes the auto-lock time (1–240 min)', async () => {
    const t = pinSetup('desktop');
    await t.set.execute(new SetPinCommand(anna, '1234'));
    expect(
      await t.autoLock.execute(new SetAutoLockCommand(anna, 60)),
    ).toMatchObject({ autoLockMinutes: 60 });
    expect(t.pins.rows.get('anna')?.autoLockMinutes).toBe(60);
  });

  it('desktop "PIN vergessen": only confirmed, clears every sealed key, keeps the rest', async () => {
    const t = pinSetup('desktop');
    const box = new SecretBox('a-test-key-that-is-long-enough-for-aes-256');
    await t.set.execute(new SetPinCommand(anna, '1234'));
    await t.settings.save('anna', {
      displayName: 'Anna',
      sealedKeys: {
        coingecko: box.seal('CG-1'),
        etherscan: box.seal('ES-1'),
        coinmarketcap: box.seal('CMC-1'),
      },
    });
    await t.ai.save('anna', {
      enabled: true,
      provider: 'openai_compatible',
      baseUrl: 'https://api.openai.com/v1',
      model: '',
      apiKeyCipher: box.seal('sk-1'),
      apiKeyHint: '…sk-1',
      consentAt: null,
    });
    await t.mail.save('anna', {
      enabled: true,
      host: 'smtp.example.org',
      port: 587,
      security: 'starttls',
      username: 'anna',
      passwordCipher: box.seal('pw'),
      passwordHint: '…pw',
      fromName: 'Anna',
      fromAddress: 'anna@example.org',
    });
    await t.chains.save('anna', {
      sealedHeliusKey: box.seal('helius-1'),
      solanaRpcUrl: 'https://rpc.example.org',
    });

    expect(
      await failure(t.forgot.execute(new ForgotPinCommand(anna, false))),
    ).toMatchObject({ status: 400, body: { code: 'confirmationRequired' } });
    expect(t.pins.rows.has('anna')).toBe(true);

    const reset = await t.forgot.execute(new ForgotPinCommand(anna, true));
    expect(reset.erasedKeys).toEqual({
      ai: true,
      mail: true,
      coingecko: true,
      etherscan: true,
      coinmarketcap: true,
      chains: true,
    });
    expect(await t.chains.find('anna')).toMatchObject({
      sealedHeliusKey: null,
      solanaRpcUrl: 'https://rpc.example.org',
    });
    expect(reset.status.hasPin).toBe(false);
    expect(t.pins.rows.has('anna')).toBe(false);
    expect(t.settings.rows.get('anna')).toMatchObject({
      displayName: 'Anna',
      sealedKeys: { coingecko: null, etherscan: null, coinmarketcap: null },
    });
    expect(t.ai.rows.get('anna')).toMatchObject({
      enabled: true,
      apiKeyCipher: null,
      apiKeyHint: null,
    });
    expect(t.mail.rows.get('anna')).toMatchObject({
      host: 'smtp.example.org',
      passwordCipher: null,
    });
  });

  it('web "PIN vergessen": only right after a sign-in; keys stay', async () => {
    const t = pinSetup('web');
    await t.set.execute(new SetPinCommand(anna, '1234'));
    expect(
      await failure(t.forgot.execute(new ForgotPinCommand(anna, true))),
    ).toMatchObject({ status: 403, body: { code: 'reloginRequired' } });
    const old = new Date(t.clock.ms - 30 * 60_000).toISOString();
    expect(
      await failure(
        t.forgot.execute(
          new ForgotPinCommand({ userId: 'anna', authTime: old }, false),
        ),
      ),
    ).toMatchObject({ status: 403 });
    const reset = await t.forgot.execute(
      new ForgotPinCommand({ userId: 'anna', authTime: t.clock.iso() }, false),
    );
    expect(reset).toMatchObject({
      erasedKeys: null,
      status: { hasPin: false },
    });
  });
});
