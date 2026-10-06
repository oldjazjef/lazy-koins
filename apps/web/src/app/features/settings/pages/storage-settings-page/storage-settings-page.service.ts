import { inject, Injectable, signal } from '@angular/core';
import {
  type DesktopBridge,
  desktopBridge,
  type StorageInfo,
} from '../../../../core/desktop/desktop-bridge';
import { NotificationService } from '../../../../core/notifications/notification.service';

/**
 * Einstellungen → Speicherort (F3.1, F3.3, F3.4), desktop only. Everything goes through the
 * desktop bridge: the folder picker and the questions (copy / open existing) are native dialogs
 * of the main process, which then restarts the app on the new folder.
 */
@Injectable()
export class StorageSettingsPageService {
  private readonly notifications = inject(NotificationService);
  private readonly bridge: DesktopBridge | null = desktopBridge();

  readonly info = signal<StorageInfo | null>(null);
  readonly loadFailed = signal(false);
  /** A change is running (dialogs open, or the app is restarting). */
  readonly busy = signal(false);
  readonly restarting = signal(false);

  async load(): Promise<void> {
    if (!this.bridge) return;
    try {
      this.info.set(await this.bridge.storage.info());
      this.loadFailed.set(false);
    } catch {
      this.loadFailed.set(true);
    }
  }

  choose(): Promise<void> {
    return this.change((bridge) => bridge.storage.choose());
  }

  useDefault(): Promise<void> {
    return this.change((bridge) => bridge.storage.useDefault());
  }

  async reveal(): Promise<void> {
    await this.bridge?.storage.reveal();
  }

  private async change(
    run: (
      bridge: DesktopBridge,
    ) => ReturnType<DesktopBridge['storage']['choose']>,
  ): Promise<void> {
    if (!this.bridge || this.busy()) return;
    this.busy.set(true);
    try {
      const result = await run(this.bridge);
      if (result.status === 'restarting') {
        this.restarting.set(true);
        return; // the app relaunches; this page goes away
      }
      if (result.status === 'failed') {
        this.notifications.error('settings.storage.failed');
      }
    } catch {
      this.notifications.error('settings.storage.failed');
    } finally {
      if (!this.restarting()) this.busy.set(false);
    }
  }
}
