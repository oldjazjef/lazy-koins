import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  HostListener,
  inject,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import {
  NavigationEnd,
  Router,
  RouterLink,
  RouterOutlet,
} from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideBot,
  lucideChevronRight,
  lucideChevronsUpDown,
  lucideCircleUserRound,
  lucideLock,
  lucideLogOut,
  lucideMoon,
  lucideSun,
} from '@ng-icons/lucide';
import { TranslatePipe } from '@ngx-translate/core';
import { HlmBadge } from '@lazykoins/ui/badge';
import { HlmButtonImports } from '@lazykoins/ui/button';
import { HlmDropdownMenuImports } from '@lazykoins/ui/dropdown-menu';
import { HlmSidebarImports, HlmSidebarService } from '@lazykoins/ui/sidebar';
import { filter, map } from 'rxjs';
import { ChatService } from '../assistant/chat.service';
import { ChatSidebar } from '../assistant/chat-sidebar';
import { UserSettingsService } from '../../features/settings/user-settings.service';
import { AuthService } from '../auth/auth.service';
import { LanguageService } from '../i18n/language.service';
import { AdminAccess } from '../admin/admin-access.service';
import { LibraryAvailability } from '../library/library-availability.service';
import { PinLockService } from '../pin/pin-lock.service';
import { SetupStateService } from '../setup/setup-state.service';
import { NotificationBell } from '../notification-centre/notification-bell';
import { NotificationCentreService } from '../notification-centre/notification-centre.service';
import { ThemeService } from '../theme/theme.service';
import { AppVersionService } from '../version/app-version.service';
import {
  HELP_NAV_ITEM,
  isNavActive,
  isNavRowActive,
  NAV_ICONS,
  type NavItem,
  navItemsFor,
  USER_MENU_ITEMS,
} from './nav-config';

/**
 * The signed-in frame, ported from etx-working-time-manager's shell: the spartan sidebar at the
 * left (app icon, name and version; the main navigation from `nav-config.ts`; the user menu with
 * Profil, Einstellungen, Jetzt sperren, Abmelden — ANFORDERUNGEN §11), collapsible to icons on
 * desktop widths and an off-canvas sheet on narrow ones; at the right a slim top bar (sidebar
 * trigger, notification bell, assistant, theme), the page — the only part that scrolls — and the
 * assistant's panel (F11.14).
 */
@Component({
  selector: 'lk-app-shell',
  imports: [
    RouterOutlet,
    RouterLink,
    NgIcon,
    TranslatePipe,
    ChatSidebar,
    NotificationBell,
    HlmBadge,
    ...HlmButtonImports,
    ...HlmDropdownMenuImports,
    ...HlmSidebarImports,
  ],
  providers: [
    provideIcons({
      ...NAV_ICONS,
      lucideBot,
      lucideChevronRight,
      lucideChevronsUpDown,
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
  /** "Administration" for platform admins only (asked once from `/api/me`). */
  private readonly admin = inject(AdminAccess);
  protected readonly items = computed(() =>
    navItemsFor(this.library.available(), this.admin.isAdmin()),
  );
  protected readonly userItems = USER_MENU_ITEMS;
  protected readonly help = HELP_NAV_ITEM;
  protected readonly auth = inject(AuthService);
  protected readonly theme = inject(ThemeService);
  protected readonly version = inject(AppVersionService);
  /** The assistant's sidebar (F11.14), on every page. */
  protected readonly chat = inject(ChatService);
  /** F11.0s: no main navigation until the setup wizard is finished. */
  protected readonly setup = inject(SetupStateService);

  /** F11.0p: "Jetzt sperren" in the user menu when a PIN is set. */
  protected readonly pin = inject(PinLockService);
  /** Expanded/collapsed (desktop, remembered in a cookie) or the open sheet (mobile). */
  private readonly sidebar = inject(HlmSidebarService);
  protected readonly sidebarOpen = computed(() =>
    this.sidebar.isMobile() ? this.sidebar.openMobile() : this.sidebar.open(),
  );

  /** The app icon (generated from assets/brand/icon.svg, see `pnpm icons`), 24 px in the sidebar. */
  // A template literal: i18n-keys.spec.ts reads quoted dotted literals as translation keys.
  protected readonly logo = `favicon.svg`;
  private readonly router = inject(Router);
  /** The current URL, for the active entry (the most specific one, `isNavActive`). */
  private readonly url = toSignal(
    this.router.events.pipe(
      filter((event) => event instanceof NavigationEnd),
      map(() => this.router.url),
    ),
    { initialValue: this.router.url },
  );

  /**
   * Explicit expand/collapse choices for entries with sub-items, keyed by path (etx). Without one
   * an entry is open while one of its pages is shown.
   */
  private readonly expandOverrides = signal<ReadonlyMap<string, boolean>>(
    new Map(),
  );

  protected isActive(item: NavItem, siblings?: readonly NavItem[]): boolean {
    return isNavActive(this.url(), item, siblings);
  }

  /**
   * A top-level row: highlighted when it is the current page, or when one of its sub-items is
   * and that sub-item cannot be seen (group closed, or the sidebar collapsed to icons).
   */
  protected isRowActive(item: NavItem): boolean {
    const subItemsVisible =
      this.isExpanded(item) &&
      (this.sidebar.isMobile() || this.sidebar.state() === 'expanded');
    return isNavRowActive(this.url(), item, subItemsVisible);
  }

  protected isExpanded(item: NavItem): boolean {
    return (
      this.expandOverrides().get(item.path) ?? isNavActive(this.url(), item)
    );
  }

  protected toggleExpanded(item: NavItem): void {
    const next = new Map(this.expandOverrides());
    next.set(item.path, !this.isExpanded(item));
    this.expandOverrides.set(next);
  }

  protected subMenuId(item: NavItem): string {
    return `lk-nav-sub-${item.path.split('/').pop() ?? ''}`;
  }

  private readonly centre = inject(NotificationCentreService);
  private readonly settings = inject(UserSettingsService).settings;
  /** The profile's name on the user menu (as etx shows it), once known. */
  protected readonly userName = computed(() =>
    this.settings.hasValue() ? this.settings.value().displayName.trim() : '',
  );

  constructor() {
    void this.admin.load();
    // Signed in: the bell polls (F11.11) until signing out.
    this.centre.start();
    inject(DestroyRef).onDestroy(() => this.centre.stop());
    // F11.2: the profile's language and formats, as soon as they are known (and after a save).
    const settings = this.settings;
    const language = inject(LanguageService);
    effect(() => {
      if (settings.hasValue()) language.apply(settings.value());
    });
    // The mobile sheet closes once a link (navigation or user menu) took the user somewhere.
    effect(() => {
      this.url();
      this.sidebar.setOpenMobile(false);
    });
  }

  protected lockNow(): void {
    void this.pin.lock();
  }

  @HostListener('document:keydown.escape')
  protected escape(): void {
    // Escape belongs to the mobile navigation sheet while it is open (it closes itself).
    if (this.sidebar.openMobile()) return;
    // The chat's overlay (narrow screens) closes on Escape; beside the page it stays.
    if (this.chat.open()) this.chat.navigated();
  }

  protected async signOut(): Promise<void> {
    await this.auth.signOut();
    await this.router.navigate(['/login']);
  }
}
