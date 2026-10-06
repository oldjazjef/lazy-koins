import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { desktopBridge } from '../../../../core/desktop/desktop-bridge';
import { AppVersionService } from '../../../../core/version/app-version.service';

/** Where the source lives (public repository). */
export const REPOSITORY_URL = 'https://github.com/oldjazjef/lazy-koins';
export const SUPPORT_URL = 'https://buymeacoffee.com/oldjazjef';

/** Einstellungen › System: the running version (number + commit), build time and the repository. */
@Component({
  selector: 'lk-system-settings-page',
  imports: [TranslatePipe, DatePipe],
  templateUrl: './system-settings-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SystemSettingsPage {
  protected readonly version = inject(AppVersionService).info;
  protected readonly desktop = desktopBridge() !== null;
  /** F11.13: OS notifications — the desktop app only (null = not offered / not loaded yet). */
  private readonly osBridge = desktopBridge()?.notifications ?? null;
  protected readonly osNotifications = signal<boolean | null>(null);

  constructor() {
    void this.osBridge
      ?.enabled()
      .then((on) => this.osNotifications.set(on))
      .catch(() => undefined);
  }

  protected async setOsNotifications(event: Event): Promise<void> {
    if (!this.osBridge) return;
    const wanted = (event.target as HTMLInputElement).checked;
    try {
      this.osNotifications.set(await this.osBridge.setEnabled(wanted));
    } catch {
      this.osNotifications.set(!wanted);
    }
  }
  protected readonly repositoryUrl = REPOSITORY_URL;
  protected readonly supportUrl = SUPPORT_URL;

  protected commitUrl(commit: string): string {
    return `${REPOSITORY_URL}/commit/${commit}`;
  }
}
