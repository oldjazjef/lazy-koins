import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  inject,
  signal,
} from '@angular/core';
import {
  Router,
  RouterLink,
  RouterLinkActive,
  RouterOutlet,
} from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideChevronDown,
  lucideCircleUserRound,
  lucideLogOut,
  lucideMoon,
  lucideSun,
} from '@ng-icons/lucide';
import { TranslatePipe } from '@ngx-translate/core';
import { HlmButtonImports } from '@lazykoins/ui/button';
import { AuthService } from '../auth/auth.service';
import { ThemeService } from '../theme/theme.service';
import { NAV_ICONS, NAV_ITEMS, USER_MENU_ITEMS } from './nav-config';

/**
 * The signed-in frame, desktop first: a header with the app name, the main navigation, the theme
 * toggle and the user menu at the top right (Profil, Einstellungen, Abmelden — ANFORDERUNGEN
 * §11); the page below in a centred column.
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
    provideIcons({
      ...NAV_ICONS,
      lucideChevronDown,
      lucideCircleUserRound,
      lucideLogOut,
      lucideMoon,
      lucideSun,
    }),
  ],
  templateUrl: './app-shell.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppShell {
  protected readonly items = NAV_ITEMS;
  protected readonly userItems = USER_MENU_ITEMS;
  protected readonly menuOpen = signal(false);
  private readonly host = inject(ElementRef<HTMLElement>);
  protected readonly auth = inject(AuthService);
  protected readonly theme = inject(ThemeService);
  private readonly router = inject(Router);

  protected toggleMenu(): void {
    this.menuOpen.update((open) => !open);
  }

  /** Closes the user menu on a click outside it or on Escape. */
  @HostListener('document:click', ['$event'])
  protected outside(event: MouseEvent): void {
    const menu = (this.host.nativeElement as HTMLElement).querySelector(
      '[data-user-menu]',
    );
    if (menu && !menu.contains(event.target as Node)) this.menuOpen.set(false);
  }

  @HostListener('document:keydown.escape')
  protected escape(): void {
    this.menuOpen.set(false);
  }

  protected async signOut(): Promise<void> {
    this.menuOpen.set(false);
    await this.auth.signOut();
    await this.router.navigate(['/login']);
  }
}
