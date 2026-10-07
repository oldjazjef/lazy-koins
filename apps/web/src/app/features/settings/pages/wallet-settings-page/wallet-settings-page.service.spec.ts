import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideTranslateService } from '@ngx-translate/core';
import type { ChainSettings } from '../../../../core/api/wallets.types';
import { NotificationService } from '../../../../core/notifications/notification.service';
import { WalletSettingsPageService } from './wallet-settings-page.service';

const settings = (): ChainSettings => ({
  keys: { etherscan: '…1234', helius: null, subscan: null },
  solanaRpcUrl: '',
  esploraUrl: '',
  koiosUrl: '',
  cosmosLcdUrl: '',
  defaults: {
    esploraUrl: 'https://mempool.space/api',
    koiosUrl: 'https://api.koios.rest/api/v1',
    cosmosLcdUrl: 'https://cosmos-rest.publicnode.com',
    solanaRpcUrl: 'https://api.mainnet-beta.solana.com',
  },
  keyStorageAvailable: true,
});

const settle = async () => {
  await new Promise((resolve) => setTimeout(resolve));
  TestBed.tick();
  await new Promise((resolve) => setTimeout(resolve));
};

async function setup() {
  const notifications = { success: vi.fn(), error: vi.fn(), info: vi.fn() };
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      provideTranslateService(),
      { provide: NotificationService, useValue: notifications },
    ],
  });
  const service = TestBed.inject(WalletSettingsPageService);
  const http = TestBed.inject(HttpTestingController);
  await settle();
  http.expectOne('/api/settings/wallets').flush(settings());
  await settle();
  return { service, http, notifications };
}

describe('WalletSettingsPageService (F6.7)', () => {
  afterEach(() => {
    try {
      TestBed.inject(HttpTestingController).verify();
    } finally {
      TestBed.resetTestingModule();
    }
  });

  it('tests the unsaved form values and reports ok', async () => {
    const { service, http } = await setup();
    const testing = service.test('etherscan', { etherscanKey: 'NEW-KEY' });
    const request = http.expectOne('/api/settings/wallets/test');
    expect(request.request.body).toEqual({
      service: 'etherscan',
      etherscanKey: 'NEW-KEY',
    });
    request.flush({
      ok: true,
      service: 'etherscan',
      detail: 'Block 1',
      millis: 12,
    });
    await testing;
    expect(service.results().etherscan).toEqual({
      ok: true,
      detail: 'Block 1',
      millis: 12,
    });
  });

  it('keeps the precise error of a failed test (code, status, provider words)', async () => {
    const { service, http } = await setup();
    const testing = service.test('subscan', {});
    http
      .expectOne('/api/settings/wallets/test')
      .flush(
        { code: 'invalidKey', status: 403, detail: 'API key denied' },
        { status: 502, statusText: 'Bad Gateway' },
      );
    await testing;
    expect(service.results().subscan).toEqual({
      ok: false,
      key: 'wallets.errors.invalidKey',
      detail: 'HTTP 403 – API key denied',
    });
  });

  it('saves and shows the new hints', async () => {
    const { service, http, notifications } = await setup();
    const saving = service.save({ heliusKey: 'H-KEY', esploraUrl: '' });
    const request = http.expectOne('/api/settings/wallets');
    expect(request.request.method).toBe('PUT');
    request.flush({
      ...settings(),
      keys: { etherscan: '…1234', helius: '…-KEY', subscan: null },
    });
    expect(await saving).toBe(true);
    expect(service.settings.value()?.keys.helius).toBe('…-KEY');
    expect(notifications.success).toHaveBeenCalledWith('settings.saved');
  });
});
