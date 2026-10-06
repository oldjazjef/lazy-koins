import { ServiceUnavailableException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env';
import { InMemoryUserSettingsRepository } from '../testing/in-memory-user-settings.repository';
import { SecretBox } from './secret-box';
import {
  GetSettingsHandler,
  GetSettingsQuery,
  SettingsReader,
  SettingsSecrets,
  UpdateSettingsCommand,
  UpdateSettingsHandler,
} from './settings.handlers';

const KEY = 'a-test-key-that-is-long-enough-for-aes-256-gcm';

function setup(encryptionKey = KEY) {
  const repo = new InMemoryUserSettingsRepository();
  const config = {
    get: () => encryptionKey,
  } as unknown as ConfigService<Env, true>;
  const secrets = new SettingsSecrets(config);
  const reader = new SettingsReader(repo, secrets);
  return {
    repo,
    reader,
    get: new GetSettingsHandler(reader),
    update: new UpdateSettingsHandler(repo, secrets, reader),
  };
}

describe('settings (F11, F6.7)', () => {
  it('has defaults before the first save', async () => {
    const t = setup();
    expect(await t.get.execute(new GetSettingsQuery('anna'))).toEqual({
      displayName: '',
      canton: '',
      advisorName: '',
      advisorEmail: '',
      numberFormat: 'de-CH',
      dateFormat: 'dd.MM.yyyy',
      onlineRates: true,
      keys: { coingecko: null, etherscan: null },
      coingeckoIds: {},
      keyStorageAvailable: true,
    });
  });

  it('stores keys sealed, answers with a hint only, and opens them for the API', async () => {
    const t = setup();
    const view = await t.update.execute(
      new UpdateSettingsCommand('anna', {
        displayName: '  Anna Muster ',
        advisorName: 'Treuhand AG',
        onlineRates: false,
        keys: { coingecko: ' CG-secret-1234 ' },
      }),
    );
    expect(view).toMatchObject({
      displayName: 'Anna Muster',
      onlineRates: false,
      keys: { coingecko: '…1234', etherscan: null },
    });
    expect(JSON.stringify(view)).not.toContain('CG-secret');
    const stored = t.repo.rows.get('anna')?.sealedKeys.coingecko ?? '';
    expect(stored.startsWith('enc:v1:')).toBe(true);
    expect(stored).not.toContain('CG-secret');
    expect(new SecretBox(KEY).open(stored)).toBe('CG-secret-1234');
    expect((await t.reader.resolve('anna')).keys.coingecko).toBe(
      'CG-secret-1234',
    );

    // Absent keeps it, empty removes it.
    await t.update.execute(new UpdateSettingsCommand('anna', { canton: 'BE' }));
    expect((await t.reader.resolve('anna')).keys.coingecko).toBe(
      'CG-secret-1234',
    );
    await t.update.execute(
      new UpdateSettingsCommand('anna', { keys: { coingecko: '' } }),
    );
    expect((await t.reader.resolve('anna')).keys.coingecko).toBeUndefined();
  });

  it('refuses to store a key without SETTINGS_ENCRYPTION_KEY, but saves the rest', async () => {
    const t = setup('');
    await expect(
      t.update.execute(
        new UpdateSettingsCommand('anna', { keys: { etherscan: 'x' } }),
      ),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    const view = await t.update.execute(
      new UpdateSettingsCommand('anna', { advisorEmail: 'tr@example.ch' }),
    );
    expect(view).toMatchObject({
      advisorEmail: 'tr@example.ch',
      keyStorageAvailable: false,
    });
  });
});
