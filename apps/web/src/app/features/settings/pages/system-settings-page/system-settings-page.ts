import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
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
  protected readonly repositoryUrl = REPOSITORY_URL;
  protected readonly supportUrl = SUPPORT_URL;

  protected commitUrl(commit: string): string {
    return `${REPOSITORY_URL}/commit/${commit}`;
  }
}
