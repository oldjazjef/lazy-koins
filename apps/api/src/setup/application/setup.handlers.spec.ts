import { HttpException } from '@nestjs/common';
import { SetPinCommand } from '../../pin/application/pin.handlers';
import type { PinMode } from '../../pin/domain/pin';
import { fakeConfig, pinSetup } from '../../pin/testing/pin-fixture';
import { InMemorySetupProgressRepository } from '../testing/in-memory-setup-progress.repository';
import {
  CompleteSetupCommand,
  CompleteSetupHandler,
  GetSetupHandler,
  GetSetupQuery,
  SetupFactsReader,
  SetupViews,
  UpdateSetupCommand,
  UpdateSetupHandler,
} from './setup.handlers';

function setup(mode: PinMode, encryptionKey = 'k'.repeat(32)) {
  const pin = pinSetup(mode);
  const progress = new InMemorySetupProgressRepository();
  const facts = new SetupFactsReader(
    pin.settings,
    pin.ai,
    pin.mail,
    pin.state,
    fakeConfig({ SETTINGS_ENCRYPTION_KEY: encryptionKey }),
  );
  const views = new SetupViews(progress, facts, pin.runtime);
  return {
    ...pin,
    progress,
    get: new GetSetupHandler(views),
    update: new UpdateSetupHandler(progress, views),
    complete: new CompleteSetupHandler(progress, views, pin.clock),
  };
}

async function codeOf(work: Promise<unknown>): Promise<string> {
  try {
    await work;
  } catch (error) {
    if (error instanceof HttpException) {
      return (error.getResponse() as { code: string }).code;
    }
    throw error;
  }
  throw new Error('expected a failure');
}

describe('setup wizard (F11.0s)', () => {
  it('starts open on profile; web has no Speicherort step and an optional PIN', async () => {
    const t = setup('web');
    const view = await t.get.execute(new GetSetupQuery('anna'));
    expect(view).toMatchObject({
      mode: 'web',
      currentStep: 'profile',
      completedAt: null,
      complete: false,
      missing: ['profile'],
    });
    expect(view.steps.map((s) => s.id)).toEqual([
      'profile',
      'advisor',
      'ai',
      'rates',
      'wallets',
      'mail',
      'pin',
      'summary',
    ]);
    expect(view.steps.filter((s) => s.required).map((s) => s.id)).toEqual([
      'profile',
    ]);
    expect(view.steps.every((s) => s.state === 'open')).toBe(true);
  });

  it('desktop: Speicherort before the PIN, and the PIN is required', async () => {
    const t = setup('desktop');
    const view = await t.get.execute(new GetSetupQuery('anna'));
    expect(view.steps.map((s) => s.id)).toEqual([
      'profile',
      'advisor',
      'ai',
      'rates',
      'wallets',
      'mail',
      'storage',
      'pin',
      'summary',
    ]);
    expect(view.steps.filter((s) => s.required).map((s) => s.id)).toEqual([
      'profile',
      'pin',
    ]);
    expect(view.missing).toEqual(['profile', 'pin']);
  });

  it('persists step states and the step on screen (resume); required steps cannot be skipped', async () => {
    const t = setup('web');
    expect(
      await codeOf(
        t.update.execute(
          new UpdateSetupCommand('anna', { states: { profile: 'skipped' } }),
        ),
      ),
    ).toBe('stepRequired');
    expect(
      await codeOf(
        t.update.execute(
          new UpdateSetupCommand('anna', { states: { profile: 'done' } }),
        ),
      ),
    ).toBe('stepIncomplete');
    expect(
      await codeOf(
        t.update.execute(
          new UpdateSetupCommand('anna', { states: { storage: 'done' } }),
        ),
      ),
    ).toBe('unknownStep');

    await t.settings.save('anna', { displayName: 'Anna', canton: 'ZH' });
    await t.update.execute(
      new UpdateSetupCommand('anna', {
        currentStep: 'ai',
        states: { profile: 'done', advisor: 'skipped', ai: 'error' },
      }),
    );
    const resumed = await t.get.execute(new GetSetupQuery('anna'));
    expect(resumed.currentStep).toBe('ai');
    expect(
      Object.fromEntries(resumed.steps.map((s) => [s.id, s.state])),
    ).toMatchObject({
      profile: 'done',
      advisor: 'skipped',
      ai: 'error',
      rates: 'open',
    });
    expect(resumed.facts).toMatchObject({ profile: true, advisor: false });
  });

  it('"App starten" needs the required steps; untouched optional steps count as skipped', async () => {
    const t = setup('web');
    expect(
      await codeOf(t.complete.execute(new CompleteSetupCommand('anna'))),
    ).toBe('setupIncomplete');
    await t.settings.save('anna', { displayName: 'Anna', canton: 'BE' });
    await t.update.execute(
      new UpdateSetupCommand('anna', { states: { profile: 'done' } }),
    );
    const done = await t.complete.execute(new CompleteSetupCommand('anna'));
    expect(done.complete).toBe(true);
    expect(done.completedAt).toBe('2026-10-07T10:00:00.000Z');
    expect(
      Object.fromEntries(done.steps.map((s) => [s.id, s.state])),
    ).toMatchObject({
      profile: 'done',
      advisor: 'skipped',
      mail: 'skipped',
      pin: 'skipped',
      summary: 'done',
    });
  });

  it('desktop: finished only with a PIN — and unfinished again after "PIN vergessen"', async () => {
    const t = setup('desktop');
    await t.settings.save('anna', { displayName: 'Anna', canton: 'ZH' });
    expect(
      await codeOf(t.complete.execute(new CompleteSetupCommand('anna'))),
    ).toBe('setupIncomplete');
    await t.set.execute(new SetPinCommand({ userId: 'anna' }, '1234'));
    await t.update.execute(
      new UpdateSetupCommand('anna', {
        states: { profile: 'done', pin: 'done' },
      }),
    );
    expect(
      (await t.complete.execute(new CompleteSetupCommand('anna'))).complete,
    ).toBe(true);

    await t.pins.remove('anna');
    t.state.forget('anna');
    const after = await t.get.execute(new GetSetupQuery('anna'));
    expect(after.complete).toBe(false);
    expect(after.missing).toEqual(['pin']);
    expect(after.steps.find((s) => s.id === 'pin')?.state).toBe('open');
  });

  it('reads the facts from the settings, never a key', async () => {
    const t = setup('web');
    await t.settings.save('anna', {
      advisorEmail: 'treuhand@example.org',
      onlineRates: false,
      sealedKeys: { coingecko: 'enc:v1:x', etherscan: null },
    });
    await t.ai.save('anna', {
      enabled: true,
      provider: 'anthropic',
      baseUrl: '',
      model: '',
      apiKeyCipher: 'enc:v1:y',
      apiKeyHint: '…abcd',
      consentAt: null,
    });
    const view = await t.get.execute(new GetSetupQuery('anna'));
    expect(view.facts).toEqual({
      profile: false,
      advisor: true,
      ai: true,
      onlineRates: false,
      coingeckoKey: true,
      etherscanKey: false,
      mail: false,
      pin: false,
      keyStorage: true,
    });
    expect(JSON.stringify(view)).not.toContain('enc:v1');
  });
});
