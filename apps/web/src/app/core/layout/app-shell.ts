import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  HostListener,
  inject,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import {
  NavigationEnd,
  Router,
  RouterLink,
  RouterLinkActive,
  RouterOutlet,
} from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideBot,
  lucideChevronDown,
  lucideCircleUserRound,
  lucideLock,
  lucideLogOut,
  lucideMoon,
  lucideSun,
} from '@ng-icons/lucide';
import { TranslatePipe } from '@ngx-translate/core';
import { HlmButtonImports } from '@lazykoins/ui/button';
import { HlmDropdownMenuImports } from '@lazykoins/ui/dropdown-menu';
import { filter, map } from 'rxjs';
import { ChatService } from '../assistant/chat.service';
import { ChatSidebar } from '../assistant/chat-sidebar';
import { UserSettingsService } from '../../features/settings/user-settings.service';
import { AuthService } from '../auth/auth.service';
import { LanguageService } from '../i18n/language.service';
import { LibraryAvailability } from '../library/library-availability.service';
import { PinLockService } from '../pin/pin-lock.service';
import { SetupStateService } from '../setup/setup-state.service';
import { NotificationBell } from '../notification-centre/notification-bell';
import { NotificationCentreService } from '../notification-centre/notification-centre.service';
import { ThemeService } from '../theme/theme.service';
import { AppVersionService } from '../version/app-version.service';
import {
  isNavActive,
  NAV_ICONS,
  type NavItem,
  navItemsFor,
  USER_MENU_ITEMS,
} from './nav-config';

/**
 * The signed-in frame, desktop first: a header with the app name, the main navigation, the theme
 * toggle and the user menu at the top right (Profil, Einstellungen, Abmelden — ANFORDERUNGEN
 * §11); the page below in a centred column, and the assistant's sidebar at the right (F11.14).
 */
@Component({
  selector: 'lk-app-shell',
  imports: [
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    NgIcon,
    TranslatePipe,
    ChatSidebar,
    NotificationBell,
    ...HlmButtonImports,
    ...HlmDropdownMenuImports,
  ],
  providers: [
    provideIcons({
      ...NAV_ICONS,
      lucideBot,
      lucideChevronDown,
      lucideCircleUserRound,
      lucideLock,
      lucideLogOut,
      lucideMoon,
      lucideSun,
    }),
  ],
  templateUrl: './app-shell.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppShell {
  /**
   * F5.15–F5.18: the library sub-item while the library can be used (web: always; desktop: when
   * linked to a web library and online).
   */
  private readonly library = inject(LibraryAvailability);
  protected readonly items = computed(() =>
    navItemsFor(this.library.available()),
  );
  protected readonly userItems = USER_MENU_ITEMS;
  protected readonly menuOpen = signal(false);
  private readonly host = inject(ElementRef<HTMLElement>);
  protected readonly auth = inject(AuthService);
  protected readonly theme = inject(ThemeService);
  protected readonly version = inject(AppVersionService);
  /** The assistant's sidebar (F11.14), on every page. */
  protected readonly chat = inject(ChatService);
  /** F11.0s: no main navigation until the setup wizard is finished. */
  protected readonly setup = inject(SetupStateService);
  /** F11.0p: "Jetzt sperren" in the user menu when a PIN is set. */
  protected readonly pin = inject(PinLockService);

  protected lockNow(): void {
    this.menuOpen.set(false);
    void this.pin.lock();
  }
  /** The app icon (generated from assets/brand/icon.svg, see `pnpm icons`), 24 px in the header. */
  // A template literal: i18n-keys.spec.ts reads quoted dotted literals as translation keys.
  protected readonly logo = `favicon.svg`;
  private readonly router = inject(Router);
  /** The current URL, for entries with sub-items (no `routerLinkActive` on a menu button). */
  private readonly url = toSignal(
    this.router.events.pipe(
      filter((event) => event instanceof NavigationEnd),
      map(() => this.router.url),
    ),
    { initialValue: this.router.url },
  );

  protected isActive(item: NavItem, siblings?: readonly NavItem[]): boolean {
    return isNavActive(this.url(), item, siblings);
  }
  private readonly centre = inject(NotificationCentreService);

  constructor() {
    // Signed in: the bell polls (F11.11) until signing out.
    this.centre.start();
    inject(DestroyRef).onDestroy(() => this.centre.stop());
    // F11.2: the profile's language and formats, as soon as they are known (and after a save).
    const settings = inject(UserSettingsService).settings;
    const language = inject(LanguageService);
    effect(() => {
      if (settings.hasValue()) language.apply(settings.value());
    });
  }

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
    // The chat's overlay (narrow screens) closes on Escape; beside the page it stays.
    if (this.chat.open()) this.chat.navigated();
  }

  protected async signOut(): Promise<void> {
    this.menuOpen.set(false);
    await this.auth.signOut();
    await this.router.navigate(['/login']);
  }
}
