import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { AuthService } from '../../core/auth/auth.service';
import { desktopBridge } from '../../core/desktop/desktop-bridge';

/** The sections of Einstellungen (ANFORDERUNGEN §11), each a sub-route. */
export const SETTINGS_SECTIONS = [
  'rates',
  'wallets',
  'ai',
  'mail',
  'mcp',
  'system',
] as const;

/** Desktop app only (F3.1): where the data lives. */
export const DESKTOP_SETTINGS_SECTIONS = ['storage'] as const;

/** Without an account (the desktop's local mode, F5.18): the link to a web library. */
export const LOCAL_SETTINGS_SECTIONS = ['library'] as const;

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
  /** System stays last; the desktop-only sections sit before it. */
  protected readonly sections: readonly string[] = [
    ...SETTINGS_SECTIONS.filter((section) => section !== 'system'),
    ...(inject(AuthService).hasAccount ? [] : LOCAL_SETTINGS_SECTIONS),
    ...(desktopBridge() !== null ? DESKTOP_SETTINGS_SECTIONS : []),
    'system',
  ];
}
