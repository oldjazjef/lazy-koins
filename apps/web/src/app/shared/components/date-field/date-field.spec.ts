import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { provideTranslateService, TranslateService } from '@ngx-translate/core';
import { setDisplayFormat, SWISS_DISPLAY } from '../../format/locale-format';
import { DateField } from './date-field';

/**
 * The point is the boundary (as in etx WTA-284): forms keep a `yyyy-MM-dd` string while the
 * spartan picker works in `Date`s — asserted in both directions, plus the user's date format,
 * min/max and clearing.
 */
@Component({
  imports: [ReactiveFormsModule, DateField],
  template: `<lk-date-field
    inputId="test-date"
    [formControl]="control"
    [min]="min()"
    [max]="max()"
  />`,
})
class FormHost {
  readonly control = new FormControl('', { nonNullable: true });
  readonly min = signal('');
  readonly max = signal('');
}

@Component({
  imports: [DateField],
  template: `<lk-date-field
    inputId="test-date"
    [value]="value()"
    (changed)="seen.push($event)"
  />`,
})
class SignalHost {
  readonly value = signal('2026-03-29');
  readonly seen: string[] = [];
}

function create<T>(host: new () => T) {
  TestBed.configureTestingModule({ providers: [provideTranslateService()] });
  const fixture = TestBed.createComponent(host);
  fixture.detectChanges();
  const field = fixture.debugElement.children[0].componentInstance as DateField;
  const f = field as unknown as {
    picked(): Date | undefined;
    onPicked(date: Date | null): void;
    placeholder(): string;
    outOfRange(): boolean;
  };
  const input = () =>
    (fixture.nativeElement as HTMLElement).querySelector(
      '#test-date',
    ) as HTMLInputElement;
  return { fixture, host: fixture.componentInstance, f, input };
}

describe('DateField', () => {
  afterEach(() => {
    setDisplayFormat(SWISS_DISPLAY);
    TestBed.resetTestingModule();
  });

  it('shows a form string as a local Date and in the user date format', () => {
    const { fixture, host, f, input } = create(FormHost);
    host.control.setValue('2026-02-17');
    fixture.detectChanges();
    const picked = f.picked() as Date;
    expect([picked.getFullYear(), picked.getMonth(), picked.getDate()]).toEqual(
      [2026, 1, 17],
    );
    expect(input().value).toBe('17.02.2026');

    setDisplayFormat({
      intlLocale: 'en',
      numberFormat: 'en',
      dateFormat: 'yyyy-MM-dd',
    });
    host.control.setValue('2026-02-18');
    fixture.detectChanges();
    expect(input().value).toBe('2026-02-18');
  });

  it('writes a picked Date back as yyyy-MM-dd, never a Date, also on DST days', () => {
    const { host, f } = create(FormHost);
    f.onPicked(new Date(2026, 9, 25));
    expect(host.control.value).toBe('2026-10-25');
    f.onPicked(new Date(2025, 11, 31));
    expect(host.control.value).toBe('2025-12-31');
  });

  it('clears to an empty string', () => {
    const { host, f } = create(FormHost);
    host.control.setValue('2026-02-17');
    f.onPicked(null);
    expect(host.control.value).toBe('');
  });

  it('does not commit a day outside min/max and says why', () => {
    const { fixture, host, f } = create(FormHost);
    host.min.set('2026-01-01');
    host.max.set('2026-10-07');
    fixture.detectChanges();
    f.onPicked(new Date(2026, 11, 24));
    fixture.detectChanges();
    expect(host.control.value).toBe('');
    expect(f.outOfRange()).toBe(true);
    // The typed day stays visible so it can be corrected.
    expect(f.picked()?.getDate()).toBe(24);
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('[role="alert"]')
        ?.textContent,
    ).toContain('dateField.outOfRange');
    f.onPicked(new Date(2026, 9, 7));
    expect(host.control.value).toBe('2026-10-07');
    expect(f.outOfRange()).toBe(false);

    // Only a latest day: the sentence names just that bound.
    host.min.set('');
    fixture.detectChanges();
    f.onPicked(new Date(2026, 9, 8));
    fixture.detectChanges();
    expect(host.control.value).toBe('');
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('[role="alert"]')
        ?.textContent,
    ).toContain('dateField.notAfter');
  });

  it('spells the format in the language’s letters in the placeholder', () => {
    const { fixture, f } = create(FormHost);
    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('de-CH', {
      dateField: { letter: { day: 'T', month: 'M', year: 'J' } },
    });
    translate.setTranslation('en', {
      dateField: { letter: { day: 'D', month: 'M', year: 'Y' } },
    });
    translate.use('de-CH');
    expect(f.placeholder()).toBe('TT.MM.JJJJ');
    translate.use('en');
    setDisplayFormat({
      intlLocale: 'en',
      numberFormat: 'en',
      dateFormat: 'yyyy-MM-dd',
    });
    fixture.detectChanges();
    expect(f.placeholder()).toBe('YYYY-MM-DD');
  });

  it('works with a signal instead of a form', () => {
    const { host, f } = create(SignalHost);
    expect((f.picked() as Date).getDate()).toBe(29);
    f.onPicked(new Date(2026, 2, 30));
    expect(host.seen).toEqual(['2026-03-30']);
  });
});
