import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideTranslateService } from '@ngx-translate/core';
import { setDisplayFormat, SWISS_DISPLAY } from '../../format/locale-format';
import { type DateRange, type DateRangePreset } from './date-range';
import { DateRangePicker } from './date-range-picker';

const PRESETS: DateRangePreset[] = [
  {
    id: 'ytd',
    labelKey: 'dashboard.period.ytd',
    range: { from: '2026-01-01', to: '2026-10-07' },
  },
  {
    id: 'year:2025',
    labelKey: 'dashboard.period.taxYear',
    labelParams: { year: 2025 },
    range: { from: '2025-01-01', to: '2025-12-31' },
  },
  {
    id: 'year:2019',
    labelKey: 'dashboard.period.taxYear',
    labelParams: { year: 2019 },
    range: { from: '2019-01-01', to: '2019-12-31' },
  },
];

@Component({
  imports: [DateRangePicker],
  template: `<lk-date-range-picker
    inputId="period"
    [range]="range()"
    [presets]="presets()"
    [min]="min()"
    [max]="max()"
    [maxDays]="maxDays()"
    [clearable]="clearable()"
    (rangeChange)="seen.push($event); range.set($event)"
  />`,
})
class Host {
  readonly range = signal<DateRange>({ from: '2026-01-01', to: '2026-10-07' });
  readonly presets = signal<DateRangePreset[]>(PRESETS);
  readonly min = signal('2020-01-01');
  readonly max = signal('2026-10-07');
  readonly maxDays = signal<number | null>(null);
  readonly clearable = signal(false);
  readonly seen: DateRange[] = [];
}

function render(patch: (host: Host) => void = () => undefined) {
  TestBed.configureTestingModule({ providers: [provideTranslateService()] });
  const fixture = TestBed.createComponent(Host);
  patch(fixture.componentInstance);
  fixture.detectChanges();
  const picker = fixture.debugElement.children[0]
    .componentInstance as DateRangePicker;
  // Protected members, reached the way the template does.
  const p = picker as unknown as Record<string, () => unknown> & {
    onStartPicked(date: Date): void;
    onEndPicked(date: Date): boolean;
    clear(): boolean;
    step(direction: -1 | 1): void;
  };
  return { fixture, host: fixture.componentInstance, p };
}

function trigger(): HTMLButtonElement {
  return document.getElementById('period') as HTMLButtonElement;
}

function overlayButtons(): HTMLButtonElement[] {
  return [
    ...(document.querySelectorAll(
      '.cdk-overlay-container button',
    ) as NodeListOf<HTMLButtonElement>),
  ];
}

describe('DateRangePicker', () => {
  afterEach(() => {
    setDisplayFormat(SWISS_DISPLAY);
    document.querySelector('.cdk-overlay-container')?.replaceChildren();
    TestBed.resetTestingModule();
  });

  it('names the active preset and shows the days in the user date format', () => {
    const { fixture } = render();
    expect(trigger().textContent).toContain('dashboard.period.ytd');
    expect(trigger().textContent).toContain('01.01.2026 – 07.10.2026');

    setDisplayFormat({
      intlLocale: 'en',
      numberFormat: 'en',
      dateFormat: 'yyyy-MM-dd',
    });
    fixture.detectChanges();
    expect(trigger().textContent).toContain('2026-01-01 – 2026-10-07');
  });

  it('shows a whole year as the year and a whole month by its name in the language', () => {
    const { fixture, host } = render((h) => h.presets.set([]));
    host.range.set({ from: '2024-01-01', to: '2024-12-31' });
    fixture.detectChanges();
    expect(trigger().textContent?.trim()).toBe('2024');

    host.range.set({ from: '2026-03-01', to: '2026-03-31' });
    fixture.detectChanges();
    expect(trigger().textContent).toContain('März 2026');

    setDisplayFormat({
      intlLocale: 'en',
      numberFormat: 'en',
      dateFormat: 'yyyy-MM-dd',
    });
    fixture.detectChanges();
    expect(trigger().textContent).toContain('March 2026');
  });

  it('offers only presets inside min/max and emits the chosen one once', async () => {
    const { fixture, host } = render();
    trigger().click();
    fixture.detectChanges();
    await fixture.whenStable();
    const labels = overlayButtons().map((b) => b.textContent?.trim());
    expect(labels).toContain('dashboard.period.ytd');
    expect(labels.filter((l) => l === 'dashboard.period.taxYear')).toHaveLength(
      1,
    );

    overlayButtons()
      .find((b) => b.textContent?.trim() === 'dashboard.period.taxYear')
      ?.click();
    fixture.detectChanges();
    expect(host.seen).toEqual([{ from: '2025-01-01', to: '2025-12-31' }]);
  });

  it('emits a hand-picked period only when both ends are in, in order', () => {
    const { host, p } = render();
    p.onStartPicked(new Date(2025, 4, 20));
    expect(host.seen).toEqual([]);
    expect(p.onEndPicked(new Date(2025, 4, 2))).toBe(true);
    expect(host.seen).toEqual([{ from: '2025-05-02', to: '2025-05-20' }]);
  });

  it('refuses a period longer than maxDays instead of clamping it', () => {
    const { host, p } = render((h) => h.maxDays.set(31));
    p.onStartPicked(new Date(2025, 0, 1));
    expect(p.onEndPicked(new Date(2025, 2, 1))).toBe(false);
    expect(host.seen).toEqual([]);
  });

  it('steps by the period but never past max', () => {
    const { fixture, host, p } = render();
    host.range.set({ from: '2025-01-01', to: '2025-12-31' });
    fixture.detectChanges();
    p.step(1);
    expect(host.seen).toEqual([]); // 2026 would end after max
    p.step(-1);
    expect(host.seen).toEqual([{ from: '2024-01-01', to: '2024-12-31' }]);
    const next = fixture.nativeElement.querySelector(
      'button[aria-label="dateRange.next"]',
    ) as HTMLButtonElement;
    fixture.detectChanges();
    expect(next.disabled).toBe(false);
  });

  it('clears to an empty period only when clearable', () => {
    const blocked = render();
    expect(blocked.p.clear()).toBe(false);
    expect(blocked.host.seen).toEqual([]);
    TestBed.resetTestingModule();

    const { fixture, host, p } = render((h) => h.clearable.set(true));
    expect(p.clear()).toBe(true);
    expect(host.seen).toEqual([{ from: '', to: '' }]);
    fixture.detectChanges();
    expect(trigger().textContent).toContain('dateRange.empty');
  });
});
