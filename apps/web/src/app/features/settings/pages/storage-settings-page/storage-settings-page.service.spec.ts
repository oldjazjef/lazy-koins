import { TestBed } from '@angular/core/testing';
import type {
  DesktopBridge,
  StorageChangeResult,
  StorageInfo,
} from '../../../../core/desktop/desktop-bridge';
import { desktopOnly } from '../../../../core/desktop/desktop-bridge';
import { NotificationService } from '../../../../core/notifications/notification.service';
import { StorageSettingsPageService } from './storage-settings-page.service';

const info: StorageInfo = {
  dataDir: 'C:\\Users\\anna\\OneDrive\\lazy-koins',
  defaultDir: 'C:\\Users\\anna\\AppData\\Roaming\\lazy-koins\\data',
  isDefault: false,
  databaseFile: 'C:\\Users\\anna\\OneDrive\\lazy-koins\\lazykoins.db',
  syncProvider: 'OneDrive',
  conflictCopies: [],
  appVersion: '1.2.3',
};

function setup(choose: () => Promise<StorageChangeResult>) {
  const bridge: DesktopBridge = {
    platform: 'win32',
    storage: {
      info: vi.fn(async () => info),
      choose: vi.fn(choose),
      useDefault: vi.fn(async () => ({ status: 'cancelled' as const })),
      reveal: vi.fn(async () => undefined),
    },
  };
  window.lazykoinsDesktop = bridge;
  const notifications = { success: vi.fn(), error: vi.fn(), info: vi.fn() };
  TestBed.configureTestingModule({
    providers: [
      StorageSettingsPageService,
      { provide: NotificationService, useValue: notifications },
    ],
  });
  return {
    bridge,
    notifications,
    service: TestBed.inject(StorageSettingsPageService),
  };
}

describe('StorageSettingsPageService (desktop, F3.1)', () => {
  afterEach(() => {
    delete window.lazykoinsDesktop;
  });

  it('loads the folder from the desktop bridge', async () => {
    const { service } = setup(async () => ({ status: 'cancelled' }));
    await service.load();
    expect(service.info()).toEqual(info);
  });

  it('stays busy while the app restarts on the new folder', async () => {
    const { service, bridge } = setup(async () => ({ status: 'restarting' }));
    await service.choose();
    expect(bridge.storage.choose).toHaveBeenCalledOnce();
    expect(service.restarting()).toBe(true);
    expect(service.busy()).toBe(true);
  });

  it('is ready again after a cancelled change and reports failures', async () => {
    const cancelled = setup(async () => ({ status: 'cancelled' }));
    await cancelled.service.choose();
    expect(cancelled.service.busy()).toBe(false);
    expect(cancelled.notifications.error).not.toHaveBeenCalled();

    TestBed.resetTestingModule();
    const failed = setup(async () => ({ status: 'failed', message: 'x' }));
    await failed.service.choose();
    expect(failed.notifications.error).toHaveBeenCalledWith(
      'settings.storage.failed',
    );
  });

  it('exists only inside the desktop app', () => {
    expect(desktopOnly()).toBe(false);
    setup(async () => ({ status: 'cancelled' }));
    expect(desktopOnly()).toBe(true);
  });
});
