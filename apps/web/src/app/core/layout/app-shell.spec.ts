import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { provideTranslateService, TranslateService } from '@ngx-translate/core';
import { ChatService } from '../assistant/chat.service';
import { ChatSidebar } from '../assistant/chat-sidebar';
import { AuthService } from '../auth/auth.service';
import { LanguageService } from '../i18n/language.service';
import { LibraryAvailability } from '../library/library-availability.service';
import { NotificationBell } from '../notification-centre/notification-bell';
import { NotificationCentreService } from '../notification-centre/notification-centre.service';
import { PinLockService } from '../pin/pin-lock.service';
import { SetupStateService } from '../setup/setup-state.service';
import { ThemeService } from '../theme/theme.service';
import { AppVersionService } from '../version/app-version.service';
import { UserSettingsService } from '../../features/settings/user-settings.service';
import { AppShell } from './app-shell';
import { provideAppSidebar, SIDEBAR_COOKIE } from './sidebar-config';

@Component({ selector: 'lk-notification-bell', template: '' })
class BellStub {}

@Component({ selector: 'lk-chat-sidebar', template: '' })
class ChatStub {}

@Component({ template: '' })
class Blank {}

/** jsdom has no `matchMedia`; the sidebar asks it whether the screen is narrow. */
function mockScreen(narrow: boolean): void {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: narrow,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }),
  });
}

async function setup(
  options: {
    narrow?: boolean;
    setupIncomplete?: boolean;
    library?: boolean;
    url?: string;
  } = {},
) {
  mockScreen(options.narrow ?? false);
  TestBed.overrideComponent(AppShell, {
    remove: { imports: [NotificationBell, ChatSidebar] },
    add: { imports: [BellStub, ChatStub] },
  });
  TestBed.configureTestingModule({
    imports: [AppShell],
    providers: [
      provideRouter([{ path: '**', component: Blank }]),
      provideTranslateService(),
      provideAppSidebar(),
      {
        provide: AuthService,
        useValue: {
          hasAccount: true,
          email: signal('anna@lazykoins.dev'),
          signOut: vi.fn(),
        },
      },
      { provide: ThemeService, useValue: { current: signal('light') } },
      {
        provide: AppVersionService,
        useValue: { info: signal({ version: '1.2.3', commit: 'abc1234' }) },
      },
      {
        provide: ChatService,
        useValue: { open: signal(false), toggle: vi.fn() },
      },
      {
        provide: SetupStateService,
        useValue: { incomplete: signal(options.setupIncomplete ?? false) },
      },
      { provide: PinLockService, useValue: { status: signal(null) } },
      {
        provide: LibraryAvailability,
        useValue: { available: signal(options.library ?? true) },
      },
      {
        provide: NotificationCentreService,
        useValue: { start: vi.fn(), stop: vi.fn() },
      },
      {
        provide: UserSettingsService,
        useValue: { settings: { hasValue: () => false } },
      },
      { provide: LanguageService, useValue: { apply: vi.fn() } },
    ],
  });
  TestBed.inject(TranslateService).use('de-CH');
  await TestBed.inject(Router).navigateByUrl(options.url ?? '/app/dashboard');
  const fixture = TestBed.createComponent(AppShell);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return { fixture, el: fixture.nativeElement as HTMLElement };
}

const links = (root: ParentNode) =>
  [...root.querySelectorAll<HTMLAnchorElement>('[data-main-nav] a')].map((a) =>
    a.getAttribute('href'),
  );

describe('AppShell', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    document.cookie = `${SIDEBAR_COOKIE}=; max-age=0; path=/`;
  });

  it('renders the main navigation inside the sidebar, not in a top header', async () => {
    const { el } = await setup();
    const nav = el.querySelector('hlm-sidebar nav[data-main-nav]');
    expect(nav).not.toBeNull();
    expect(nav?.getAttribute('aria-label')).toBe('nav.label');
    // Mappings' sub-items open while one of its pages is shown (below).
    expect(links(el)).toEqual([
      '/app/dashboard',
      '/app/projects',
      '/app/files',
      '/app/transactions',
      '/app/mappings',
      '/app/wallets',
    ]);
    // The top bar holds only the trigger and the global actions.
    expect(el.querySelector('main > header nav')).toBeNull();
    expect(
      el.querySelector('main > header lk-notification-bell'),
    ).not.toBeNull();
  });

  it('shows the liability disclaimer under every page', async () => {
    const { el } = await setup();
    expect(
      el.querySelector('.lk-scroll-content footer[data-disclaimer]')
        ?.textContent,
    ).toContain('app.disclaimer');
  });

  it('has a sidebar trigger in the top bar (mobile + collapse)', async () => {
    const { el } = await setup();
    const trigger = el.querySelector<HTMLButtonElement>(
      'main > header button[data-sidebar-trigger]',
    );
    expect(trigger).not.toBeNull();
    expect(trigger?.getAttribute('aria-expanded')).toBe('true');
    expect(trigger?.textContent).toContain('nav.toggleSidebar');
  });

  it('collapses the sidebar to icons with the trigger on wide screens', async () => {
    const { el, fixture } = await setup();
    const sidebar = el.querySelector('hlm-sidebar');
    expect(sidebar?.getAttribute('data-state')).toBe('expanded');
    el.querySelector<HTMLButtonElement>('[data-sidebar-trigger]')?.click();
    fixture.detectChanges();
    expect(sidebar?.getAttribute('data-state')).toBe('collapsed');
    expect(sidebar?.getAttribute('data-collapsible')).toBe('icon');
    expect(document.cookie).toContain(`${SIDEBAR_COOKIE}=false`);
  });

  it('on a narrow screen the navigation lives in a sheet the trigger opens', async () => {
    const { el, fixture } = await setup({ narrow: true });
    // Not in the page while closed …
    expect(el.querySelector('[data-main-nav]')).toBeNull();
    const trigger = el.querySelector<HTMLButtonElement>(
      '[data-sidebar-trigger]',
    );
    expect(trigger?.getAttribute('aria-expanded')).toBe('false');
    trigger?.click();
    fixture.detectChanges();
    await fixture.whenStable();
    // … and in the sheet (an overlay) once opened.
    expect(trigger?.getAttribute('aria-expanded')).toBe('true');
    expect(links(document.body)).toContain('/app/projects');
  });

  it('marks the most specific entry as the current page', async () => {
    const { el, fixture } = await setup({ url: '/app/mappings/library/x' });
    const current = () =>
      [...el.querySelectorAll('[data-main-nav] [aria-current="page"]')].map(
        (a) => a.getAttribute('href'),
      );
    expect(links(el)).toContain('/app/mappings/library');
    expect(current()).toEqual(['/app/mappings/library']);
    // Group closed: the parent row carries it.
    const toggle = el.querySelector<HTMLButtonElement>(
      '[data-main-nav] button[aria-expanded]',
    );
    expect(toggle?.getAttribute('aria-expanded')).toBe('true');
    toggle?.click();
    fixture.detectChanges();
    expect(current()).toEqual(['/app/mappings']);
  });

  it('shows Mappings as a plain link while there is no library (desktop, F5.18)', async () => {
    const { el } = await setup({ library: false, url: '/app/mappings' });
    expect(links(el)).toEqual([
      '/app/dashboard',
      '/app/projects',
      '/app/files',
      '/app/transactions',
      '/app/mappings',
      '/app/wallets',
    ]);
    expect(
      el.querySelector('[data-main-nav] button[aria-expanded]'),
    ).toBeNull();
  });

  it('hides the navigation until the setup wizard is finished (F11.0s)', async () => {
    const { el } = await setup({ setupIncomplete: true });
    expect(el.querySelector('[data-main-nav]')).toBeNull();
    // The user menu stays reachable (sign out).
    expect(el.querySelector('[data-user-menu]')).not.toBeNull();
  });

  it('shows the version next to the name and the address in the user menu', async () => {
    const { el } = await setup();
    expect(el.querySelector('[data-app-version]')?.textContent).toContain(
      'app.versionBadge',
    );
    expect(el.querySelector('[data-user-menu]')?.textContent).toContain(
      'anna@lazykoins.dev',
    );
  });
});
