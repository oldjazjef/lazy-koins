import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { provideTranslateService, TranslateService } from '@ngx-translate/core';
import { AuthService } from '../../../../core/auth/auth.service';
import { LibraryAvailability } from '../../../../core/library/library-availability.service';
import { SetupStateService } from '../../../../core/setup/setup-state.service';
import { HELP_SECTION_IDS } from '../../help-content';
import { HelpPage } from './help-page';

const I18N_DIR = [
  join(process.cwd(), 'public', 'i18n'),
  join(process.cwd(), 'apps', 'web', 'public', 'i18n'),
].find((dir) => existsSync(dir));
const messages = (locale: string): Record<string, unknown> =>
  JSON.parse(
    readFileSync(join(I18N_DIR ?? '', `${locale}.json`), 'utf8'),
  ) as Record<string, unknown>;

async function open(url: string, options: { setupIncomplete?: boolean } = {}) {
  const scrolled: string[] = [];
  // jsdom does not scroll; record which section was asked to.
  Element.prototype.scrollIntoView = function (this: Element) {
    scrolled.push(this.id);
  };
  TestBed.configureTestingModule({
    providers: [
      provideRouter([{ path: 'app/help', component: HelpPage }]),
      provideTranslateService(),
      { provide: AuthService, useValue: { hasAccount: true } },
      { provide: LibraryAvailability, useValue: { available: signal(true) } },
      {
        provide: SetupStateService,
        useValue: { incomplete: signal(options.setupIncomplete ?? false) },
      },
    ],
  });
  const translate = TestBed.inject(TranslateService);
  translate.setTranslation('de-CH', messages('de-CH'));
  translate.use('de-CH');
  const harness = await RouterTestingHarness.create();
  await harness.navigateByUrl(url);
  harness.detectChanges();
  await harness.fixture.whenStable();
  harness.detectChanges();
  return {
    harness,
    el: harness.routeNativeElement as HTMLElement,
    scrolled,
  };
}

const sectionIds = (el: HTMLElement) =>
  [...el.querySelectorAll('section[id]')].map((section) => section.id);

describe('HelpPage (F11.21)', () => {
  it('shows the guide: TOC with deep links, every step with "Schritt N von M", the FAQ', async () => {
    const { el } = await open('/app/help');
    expect(el.querySelector('h1')?.textContent).toContain('Hilfe');
    const toc = [
      ...el.querySelectorAll<HTMLAnchorElement>('[data-help-toc] a'),
    ].map((a) => a.getAttribute('href'));
    expect(toc).toEqual([
      ...HELP_SECTION_IDS.map((id) => `/app/help#${id}`),
      '/app/help#faq',
    ]);
    expect(sectionIds(el)).toEqual([...HELP_SECTION_IDS, 'faq']);
    const total = HELP_SECTION_IDS.length;
    expect(el.querySelector('#files [data-help-step]')?.textContent).toContain(
      `Schritt 3 von ${total}`,
    );
    // Headings: one h1, an h2 per step, h3 below.
    expect(el.querySelectorAll('h1')).toHaveLength(1);
    expect(el.querySelector('#files h2')?.textContent).toContain(
      'Dateien und Mappings',
    );
    expect(el.querySelectorAll('#files h3').length).toBeGreaterThan(0);
    // "Öffnen" links into the app; the note "keine Steuerberatung" on top.
    expect(
      [...el.querySelectorAll('#files [data-help-links] a')].map((a) =>
        a.getAttribute('href'),
      ),
    ).toEqual(['/app/files', '/app/mappings', '/app/mappings/library']);
    expect(el.querySelector('[data-no-advice]')?.textContent).toContain(
      'keine Steuerberatung',
    );
    expect(el.querySelectorAll('[data-help-faq]').length).toBeGreaterThan(0);
  });

  it('a deep link scrolls to its section, marks it and focuses its heading', async () => {
    const { el, scrolled } = await open('/app/help#rates');
    expect(scrolled).toEqual(['rates']);
    expect(
      el.querySelector('#rates')?.classList.contains('lk-help-highlight'),
    ).toBe(true);
    expect(document.activeElement).toBe(el.querySelector('#rates h2'));
    expect(
      el
        .querySelector('[data-help-toc] a[href="/app/help#rates"]')
        ?.getAttribute('aria-current'),
    ).toBe('location');
  });

  it('the search filters sections and TOC and says how many match', async () => {
    const { el, harness } = await open('/app/help');
    const input = el.querySelector<HTMLInputElement>('#help-search');
    if (!input) throw new Error('no search box');
    input.value = 'Folgeprojekt';
    input.dispatchEvent(new Event('input'));
    harness.detectChanges();
    expect(sectionIds(el)).toContain('followUp');
    expect(sectionIds(el)).not.toContain('wallets');
    expect(el.querySelector('[data-help-results]')?.textContent).toMatch(
      /\d+ von \d+ Abschnitten/,
    );
    input.value = 'xyzzy';
    input.dispatchEvent(new Event('input'));
    harness.detectChanges();
    expect(sectionIds(el)).toEqual([]);
    expect(el.querySelector('[data-help-none]')).not.toBeNull();
  });

  it('folds the contents on narrow screens behind a button', async () => {
    const { el, harness } = await open('/app/help');
    const toggle = el.querySelector<HTMLButtonElement>(
      '[data-help-toc] button[aria-controls="help-toc"]',
    );
    expect(toggle?.getAttribute('aria-expanded')).toBe('false');
    expect(el.querySelector('#help-toc')?.classList.contains('hidden')).toBe(
      true,
    );
    toggle?.click();
    harness.detectChanges();
    expect(toggle?.getAttribute('aria-expanded')).toBe('true');
    expect(el.querySelector('#help-toc')?.classList.contains('hidden')).toBe(
      false,
    );
  });

  it('during the setup wizard it offers the way back (F11.0s)', async () => {
    const { el } = await open('/app/help#setup', { setupIncomplete: true });
    const banner = el.querySelector('[data-setup-banner]');
    expect(banner?.textContent).toContain('Einrichtung fortsetzen');
    expect(banner?.querySelector('a')?.getAttribute('href')).toBe('/app/setup');
  });
});
