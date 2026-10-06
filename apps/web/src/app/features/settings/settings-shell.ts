import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { desktopBridge } from '../../core/desktop/desktop-bridge';

/**
 * Einstellungen with its sections (F11.0b). The section tabs only appear in the desktop app,
 * which has a second section (Speicherort, F3.1); the web app has AI alone.
 */
@Component({
  selector: 'lk-settings-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, TranslatePipe],
  template: `
    @if (desktop) {
      <nav
        [attr.aria-label]="'settings.sections' | translate"
        class="flex gap-1 pb-4"
      >
        <a
          routerLink="ai"
          routerLinkActive="lk-nav-active"
          ariaCurrentWhenActive="page"
          class="lk-nav-link"
          >{{ 'settings.ai.tab' | translate }}</a
        >
        <a
          routerLink="storage"
          routerLinkActive="lk-nav-active"
          ariaCurrentWhenActive="page"
          class="lk-nav-link"
          >{{ 'settings.storage.tab' | translate }}</a
        >
      </nav>
    }
    <router-outlet />
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingsShell {
  protected readonly desktop = desktopBridge() !== null;
}
