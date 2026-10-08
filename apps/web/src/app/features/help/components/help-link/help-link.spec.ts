import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { HELP_SECTION_FOR_TAB } from '../../help-content';
import { HelpLink } from './help-link';

function render(section: string, labelKey: string | null = null) {
  TestBed.configureTestingModule({
    providers: [provideRouter([]), provideTranslateService()],
  });
  const fixture = TestBed.createComponent(HelpLink);
  fixture.componentRef.setInput('section', section);
  fixture.componentRef.setInput('labelKey', labelKey);
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

describe('HelpLink (contextual help, F11.21)', () => {
  it('is a "?" button that opens the guide at its step', () => {
    const link = render('rates').querySelector('a[data-help-link]');
    expect(link?.getAttribute('href')).toBe('/app/help#rates');
    expect(link?.getAttribute('aria-label')).toBe('help.context');
  });

  it('with a label it is a labelled button (the setup wizard)', () => {
    const link = render('setup', 'help.setupBanner.wizard').querySelector(
      'a[data-help-link]',
    );
    expect(link?.getAttribute('href')).toBe('/app/help#setup');
    expect(link?.textContent).toContain('help.setupBanner.wizard');
  });

  it('every project tab has a step of the guide', () => {
    expect(HELP_SECTION_FOR_TAB.rates).toBe('rates');
    expect(HELP_SECTION_FOR_TAB.exports).toBe('exports');
    expect(HELP_SECTION_FOR_TAB.hints).toBe('checks');
  });
});
