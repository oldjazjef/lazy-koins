import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { desktopBridge } from '../../core/desktop/desktop-bridge';

/** The sections of Einstellungen (ANFORDERUNGEN §11), each a sub-route. */
export const SETTINGS_SECTIONS = ['rates', 'wallets', 'ai'] as const;

/** Desktop app only (F3.1): where the data lives. */
export const DESKTOP_SETTINGS_SECTIONS = ['storage'] as const;

/** Einstellungen: the section links above the section's page. */
@Component({
  selector: 'lk-settings-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, TranslatePipe],
  template: `
    <nav
      class="mb-6 flex flex-wrap gap-1 border-b"
      [attr.aria-label]="'settings.sections.label' | translate"
    >
      @for (section of sections; track section) {
        <a
          class="lk-tab"
          [routerLink]="section"
          routerLinkActive="lk-tab-active"
          ariaCurrentWhenActive="page"
          >{{ 'settings.sections.' + section | translate }}</a
        >
      }
    </nav>
    <router-outlet />
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingsShell {
  protected readonly sections: readonly string[] =
    desktopBridge() !== null
      ? [...SETTINGS_SECTIONS, ...DESKTOP_SETTINGS_SECTIONS]
      : SETTINGS_SECTIONS;
}
