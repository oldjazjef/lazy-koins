import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import type { Wallet } from '../../../../core/api/wallets.types';
import { NotificationService } from '../../../../core/notifications/notification.service';
import { walletError } from '../../wallet-errors';
import { WalletPageService } from './wallet-page.service';
import { WalletFormSchema } from './wallet.schema';

const ID = '00000000-0000-7000-8000-000000000001';

const wallet = (over: Partial<Wallet> = {}): Wallet => ({
  id: ID,
  label: 'Ledger',
  address: '0x1111111111111111111111111111111111111111',
  addressKind: 'evm',
  networks: ['ethereum'],
  possibleNetworks: [
    'ethereum',
    'bsc',
    'polygon',
    'arbitrum',
    'optimism',
    'base',
  ],
  notes: '',
  checkedAt: null,
  createdAt: '2026-10-08T10:00:00.000Z',
  updatedAt: '2026-10-08T10:00:00.000Z',
  projects: [],
  perNetwork: [],
  ...over,
});

const settle = async () => {
  await new Promise((resolve) => setTimeout(resolve));
  TestBed.tick();
  await new Promise((resolve) => setTimeout(resolve));
};

function setup() {
  const notifications = { success: vi.fn(), error: vi.fn(), info: vi.fn() };
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      provideTranslateService(),
      provideRouter([]),
      WalletPageService,
      { provide: NotificationService, useValue: notifications },
    ],
  });
  const service = TestBed.inject(WalletPageService);
  const http = TestBed.inject(HttpTestingController);
  const router = TestBed.inject(Router);
  vi.spyOn(router, 'navigate').mockResolvedValue(true);
  return { service, http, router, notifications };
}

describe('WalletPageService', () => {
  afterEach(() => {
    try {
      TestBed.inject(HttpTestingController).verify();
    } finally {
      TestBed.resetTestingModule();
    }
  });

  it('creates a wallet and opens its page', async () => {
    const { service, http, router } = setup();
    const saving = service.save({
      label: 'Ledger',
      address: wallet().address,
      networks: ['ethereum'],
      notes: '',
    });
    const request = http.expectOne('/api/wallets');
    expect(request.request.method).toBe('POST');
    request.flush(wallet());
    expect(await saving).toBe(true);
    expect(router.navigate).toHaveBeenCalledWith(['/app/wallets', ID]);
  });

  it('F6.2: a refused secret is remembered as its kind only, no error toast', async () => {
    const { service, http, notifications } = setup();
    const saving = service.save({ label: 'x', address: 'secret words' });
    http
      .expectOne('/api/wallets')
      .flush(
        { code: 'secretRefused', kind: 'seedPhrase', message: 'refused' },
        { status: 422, statusText: 'Unprocessable Entity' },
      );
    expect(await saving).toBe(false);
    expect(service.refused()).toBe('seedPhrase');
    expect(notifications.error).not.toHaveBeenCalled();
  });

  it('checks networks and fetches the open wallet, showing precise errors', async () => {
    const { service, http, notifications } = setup();
    service.walletId.set(ID);
    await settle();
    http.expectOne(`/api/wallets/${ID}`).flush(wallet());
    http.expectOne(`/api/wallets/${ID}/tokens`).flush([]);
    await settle();

    const checking = service.checkNetworks();
    http
      .expectOne(`/api/wallets/${ID}/check-networks`)
      .flush(wallet({ checkedAt: '2026-10-08T11:00:00.000Z' }));
    await checking;
    await settle();
    http.expectOne(`/api/wallets/${ID}/tokens`).flush([]);
    expect(service.wallet.value()?.checkedAt).toBe('2026-10-08T11:00:00.000Z');

    const fetching = service.fetch();
    http
      .expectOne(`/api/wallets/${ID}/fetch`)
      .flush(
        { code: 'invalidKey', detail: 'Invalid API Key', status: 401 },
        { status: 502, statusText: 'Bad Gateway' },
      );
    await fetching;
    expect(notifications.error).toHaveBeenCalledWith(
      'wallets.errors.invalidKey',
      'HTTP 401 – Invalid API Key',
    );
  });

  it('marks a token "kein Spam"', async () => {
    const { service, http } = setup();
    service.walletId.set(ID);
    await settle();
    http.expectOne(`/api/wallets/${ID}`).flush(wallet());
    http.expectOne(`/api/wallets/${ID}/tokens`).flush([]);
    const marking = service.setToken('ethereum', '0xbad', true);
    const request = http.expectOne(`/api/wallets/${ID}/tokens`);
    expect(request.request.body).toEqual({
      network: 'ethereum',
      tokenKey: '0xbad',
      notSpam: true,
    });
    request.flush([{ network: 'ethereum', tokens: [] }]);
    await marking;
    await settle();
    http.expectOne(`/api/wallets/${ID}`).flush(wallet());
  });
});

describe('wallet form and errors', () => {
  it('needs a label', () => {
    const result = WalletFormSchema.safeParse({
      label: ' ',
      address: '',
      notes: '',
    });
    expect(result.success).toBe(false);
  });

  it('maps unknown failures to a generic key', () => {
    expect(walletError(new Error('x'))).toEqual({
      key: 'wallets.errors.failed',
    });
  });
});
