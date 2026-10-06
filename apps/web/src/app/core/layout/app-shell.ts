import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import {
  Router,
  RouterLink,
  RouterLinkActive,
  RouterOutlet,
} from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideLogOut, lucideMoon, lucideSun } from '@ng-icons/lucide';
import { TranslatePipe } from '@ngx-translate/core';
import { HlmButtonImports } from '@lazykoins/ui/button';
import { AuthService } from '../auth/auth.service';
import { ThemeService } from '../theme/theme.service';
import { AppVersionService } from '../version/app-version.service';
import { NAV_ICONS, NAV_ITEMS } from './nav-config';

/**
 * The signed-in frame, desktop first: a header with the app name, the main navigation, the
 * signed-in account, theme toggle and sign-out; the page below in a centred column.
 */
@Component({
  selector: 'lk-app-shell',
  imports: [
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    NgIcon,
    TranslatePipe,
    ...HlmButtonImports,
  ],
  providers: [
    provideIcons({ ...NAV_ICONS, lucideLogOut, lucideMoon, lucideSun }),
  ],
  templateUrl: './app-shell.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppShell {
  protected readonly items = NAV_ITEMS;
  /** The app icon (generated from assets/brand/icon.svg, see `pnpm icons`), 24 px in the header. */
  // A template literal: i18n-keys.spec.ts reads quoted dotted literals as translation keys.
  protected readonly logo = `favicon.svg`;
  protected readonly auth = inject(AuthService);
  protected readonly theme = inject(ThemeService);
  protected readonly version = inject(AppVersionService);
  private readonly router = inject(Router);

  protected async signOut(): Promise<void> {
    await this.auth.signOut();
    await this.router.navigate(['/login']);
  }
}
