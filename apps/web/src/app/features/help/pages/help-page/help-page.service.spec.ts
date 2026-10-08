import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideTranslateService, TranslateService } from '@ngx-translate/core';
import { AuthService } from '../../../../core/auth/auth.service';
import { LibraryAvailability } from '../../../../core/library/library-availability.service';
import { SetupStateService } from '../../../../core/setup/setup-state.service';
import { HELP_SECTION_IDS } from '../../help-content';
import { HelpPageService, matches, normalise } from './help-page.service';

/** The real message files: the search runs over the texts the user reads. */
const I18N_DIR = [
  join(process.cwd(), 'public', 'i18n'),
  join(process.cwd(), 'apps', 'web', 'public', 'i18n'),
].find((dir) => existsSync(dir));
const messages = (locale: string): Record<string, unknown> =>
  JSON.parse(
    readFileSync(join(I18N_DIR ?? '', `${locale}.json`), 'utf8'),
  ) as Record<string, unknown>;

function setup(
  options: { account?: boolean; library?: boolean; locale?: string } = {},
) {
  TestBed.configureTestingModule({
    providers: [
      HelpPageService,
      provideTranslateService(),
      {
        provide: AuthService,
        useValue: { hasAccount: options.account ?? true },
      },
      {
        provide: LibraryAvailability,
        useValue: { available: signal(options.library ?? true) },
      },
      { provide: SetupStateService, useValue: { incomplete: signal(false) } },
    ],
  });
  const translate = TestBed.inject(TranslateService);
  translate.setTranslation('de-CH', messages('de-CH'));
  translate.setTranslation('en', messages('en'));
  translate.use(options.locale ?? 'de-CH');
  return TestBed.inject(HelpPageService);
}

const ids = (service: HelpPageService) =>
  service.visibleSections().map((section) => section.id);

describe('HelpPageService (F11.21)', () => {
  it('numbers the whole guide: step N of M', () => {
    const service = setup();
    expect(service.total).toBe(HELP_SECTION_IDS.length);
    expect(service.sections().map((section) => section.number)).toEqual(
      HELP_SECTION_IDS.map((_, index) => index + 1),
    );
    expect(ids(service)).toEqual([...HELP_SECTION_IDS]);
  });

  it('filters by every word, ignoring case and accents, and keeps the step numbers', () => {
    const service = setup();
    service.query.set('ESTV-Kursliste');
    expect(ids(service)).toContain('rates');
    expect(ids(service)).not.toContain('wallets');
    const rates = service.visibleSections().find((s) => s.id === 'rates');
    expect(rates?.number).toBe(HELP_SECTION_IDS.indexOf('rates') + 1);

    // "prufung" finds "Prüfungen"; both words must occur.
    service.query.set('prufung ampel');
    expect(ids(service)).toEqual(['checks']);

    service.query.set('gibtsnicht');
    expect(service.visibleSections()).toEqual([]);
    expect(service.visibleFaq()).toEqual([]);
    expect(service.nothingFound()).toBe(true);

    service.query.set('  ');
    expect(service.searching()).toBe(false);
    expect(ids(service)).toHaveLength(HELP_SECTION_IDS.length);
  });

  it('searches the FAQ too, in the current language', () => {
    const service = setup({ locale: 'en' });
    service.query.set('forgot PIN');
    expect(service.visibleFaq()).toEqual(['pin']);
  });

  it('shows the web app what applies to it (no data folder, the library publishing tip)', () => {
    const service = setup({ account: true });
    const setupSection = service.sections().find((s) => s.id === 'setup');
    expect(setupSection?.steps.map((step) => step.id)).not.toContain('storage');
    const files = service.sections().find((s) => s.id === 'files');
    expect(files?.tips.map((tip) => tip.id)).toContain('library');
    expect(files?.tips.map((tip) => tip.id)).not.toContain('libraryDesktop');
    const privacy = service.sections().find((s) => s.id === 'privacy');
    expect(privacy?.links.map((link) => link.id)).not.toContain(
      'settingsStorage',
    );
  });

  it('shows the desktop app its own steps and hides the library link without a library', () => {
    const service = setup({ account: false, library: false });
    const setupSection = service.sections().find((s) => s.id === 'setup');
    expect(
      setupSection?.steps.find((step) => step.id === 'storage')?.only,
    ).toBe('desktop');
    const files = service.sections().find((s) => s.id === 'files');
    expect(files?.tips.map((tip) => tip.id)).toEqual(
      expect.arrayContaining(['libraryDesktop']),
    );
    expect(files?.tips.map((tip) => tip.id)).not.toContain('library');
    expect(files?.links.map((link) => link.id)).not.toContain('library');
    // Without the Electron bridge (tests, a browser in local mode) no Speicherort link.
    const privacy = service.sections().find((s) => s.id === 'privacy');
    expect(privacy?.links.map((link) => link.id)).not.toContain(
      'settingsStorage',
    );
  });

  it('a jump to a section hidden by the search clears the search', () => {
    const service = setup();
    service.query.set('Treuhänder');
    expect(ids(service)).not.toContain('wallets');
    service.reveal('wallets');
    expect(service.query()).toBe('');
    expect(service.target()).toEqual({ id: 'wallets', seq: 1 });
    // The same target again scrolls again.
    service.reveal('wallets');
    expect(service.target()?.seq).toBe(2);
    // Anything else is not a place on the page.
    service.reveal('nowhere');
    expect(service.target()?.id).toBe('wallets');
    expect(service.isTarget('faq')).toBe(true);
    expect(service.isTarget(null)).toBe(false);
  });

  it('normalises text for the search', () => {
    expect(normalise('Prüfungen ÜBER')).toBe('prufungen uber');
    expect(matches('kurse und prufungen', 'Prüf KURS')).toBe(true);
    expect(matches('kurse', 'kurs wallet')).toBe(false);
  });
});
