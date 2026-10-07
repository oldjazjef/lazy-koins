import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideCalendar,
  lucideChevronLeft,
  lucideChevronRight,
} from '@ng-icons/lucide';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { HlmButtonImports } from '@lazykoins/ui/button';
import { HlmCalendarRange } from '@lazykoins/ui/calendar';
import { HlmPopoverImports } from '@lazykoins/ui/popover';
import { formatDay, isoToDate } from '../../format/date-only';
import { displayFormat } from '../../format/locale-format';
import {
  dayCount,
  type DateRange,
  type DateRangePreset,
  EMPTY_RANGE,
  isComplete,
  isWholeMonth,
  isWholeYear,
  ordered,
  sameRange,
  shiftRange,
  withinBounds,
} from './date-range';

/**
 * One control for a period — ported from etx-working-time-manager's `etx-date-range-picker`
 * (WTA-307, the shape Toggl Track uses): a button naming the period, a panel with the caller's
 * presets beside a range calendar, and two arrows that move the whole period at once. It emits
 * the period **once**, when both ends are in (two date fields fired a reload per field).
 *
 * Values are `DateRange` (`from`/`to` as `yyyy-MM-dd`, `''` unset) — no `Date` leaves this
 * component. The button shows the active preset's name and the days in the user's date format
 * (F11.2); month/weekday names and the week start come from the app-wide calendar texts.
 * Keyboard: the button opens the panel (Enter/Space), Tab reaches the presets and the calendar
 * (arrow keys, Page Up/Down, Home/End, Enter), Escape closes and returns focus. The popover lives
 * in the CDK overlay container, so it opens above dialogs too.
 *
 * ```html
 * <label hlmLabel for="dashboard-period">…</label>
 * <lk-date-range-picker inputId="dashboard-period" [range]="period()" [presets]="presets()"
 *   [max]="today" (rangeChange)="setPeriod($event)" />
 * ```
 */
@Component({
  selector: 'lk-date-range-picker',
  imports: [
    TranslatePipe,
    NgIcon,
    HlmCalendarRange,
    ...HlmButtonImports,
    ...HlmPopoverImports,
  ],
  providers: [
    provideIcons({ lucideCalendar, lucideChevronLeft, lucideChevronRight }),
  ],
  templateUrl: './date-range-picker.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
})
export class DateRangePicker {
  private readonly translate = inject(TranslateService);

  readonly range = input.required<DateRange>();

  /** The caller's presets, in display order. */
  readonly presets = input<readonly DateRangePreset[]>([]);

  /** Bounds as `yyyy-MM-dd` (inclusive, `''` = none): days outside are disabled. */
  readonly min = input<string>('');
  readonly max = input<string>('');

  /** Upper bound in days, inclusive; `null` = no limit. */
  readonly maxDays = input<number | null>(null);

  /** Whether an empty period is allowed — a filter yes, the dashboard no. */
  readonly clearable = input(false);

  /** The two arrows that move the period by its own size. */
  readonly stepper = input(true);

  /** Wired to the `<label for="…">` that names the control (on the button). */
  readonly inputId = input<string>('date-range');

  readonly rangeChange = output<DateRange>();

  protected readonly hasRange = computed(() => isComplete(this.range()));

  protected readonly availablePresets = computed(() => {
    const limit = this.maxDays();
    return this.presets().filter(
      (preset) =>
        withinBounds(preset.range, this.min(), this.max()) &&
        (limit === null || dayCount(preset.range) <= limit),
    );
  });

  protected readonly activePreset = computed(() =>
    this.availablePresets().find((preset) =>
      sameRange(preset.range, this.range()),
    ),
  );

  protected readonly pickedStart = computed(() => isoToDate(this.range().from));
  protected readonly pickedEnd = computed(() => isoToDate(this.range().to));
  protected readonly minPicked = computed(() => isoToDate(this.min()));
  protected readonly maxPicked = computed(() => isoToDate(this.max()));

  /** A new start alone is half a period; held here until the end arrives. */
  private readonly draftStart = signal<Date | undefined>(undefined);

  /** Set once a hand-picked range exceeds `maxDays`; cleared by the next valid selection. */
  protected readonly limitExceeded = signal(false);

  /**
   * The days in the user's format. Without a matching preset a whole year or month is named
   * (`2025`, `März 2026`); next to a preset's name the exact days are shown
   * (`Steuerjahr 2025 01.01.2025 – 31.12.2025`, not `Steuerjahr 2025 2025`).
   */
  protected readonly days = computed(() => {
    const range = this.range();
    const start = isoToDate(range.from);
    const end = isoToDate(range.to);
    const format = displayFormat();
    if (!start || !end) return '';
    const span = `${formatDay(start, format.dateFormat)} – ${formatDay(end, format.dateFormat)}`;
    if (this.activePreset()) return span;
    if (isWholeYear(range)) return String(start.getFullYear());
    if (isWholeMonth(range)) {
      return new Intl.DateTimeFormat(format.intlLocale, {
        month: 'long',
        year: 'numeric',
      }).format(start);
    }
    return span;
  });

  /** The text of the button for screen readers: preset + days, or "Zeitraum wählen". */
  protected readonly label = computed(() => {
    this.translate.currentLang();
    const preset = this.activePreset();
    const days = this.days();
    if (!days) return this.translate.instant('dateRange.empty');
    return preset
      ? `${this.translate.instant(preset.labelKey, preset.labelParams ?? {})}: ${days}`
      : days;
  });

  protected readonly canStepBack = computed(() => this.canStep(-1));
  protected readonly canStepForward = computed(() => this.canStep(1));

  private canStep(direction: -1 | 1): boolean {
    if (!this.hasRange()) return false;
    const next = shiftRange(this.range(), direction);
    return withinBounds(next, this.min(), this.max());
  }

  protected applyPreset(preset: DateRangePreset): void {
    this.limitExceeded.set(false);
    this.draftStart.set(undefined);
    if (!sameRange(preset.range, this.range())) {
      this.rangeChange.emit(preset.range);
    }
  }

  protected step(direction: -1 | 1): void {
    if (!this.canStep(direction)) return;
    this.limitExceeded.set(false);
    this.rangeChange.emit(shiftRange(this.range(), direction));
  }

  /** The calendar reports the ends separately; only a complete period is emitted. */
  protected onStartPicked(date: Date | undefined): void {
    this.draftStart.set(date);
    this.limitExceeded.set(false);
  }

  /** Returns whether a period was emitted — the template closes the panel on `true`. */
  protected onEndPicked(date: Date | undefined): boolean {
    const start = this.draftStart() ?? this.pickedStart();
    if (!start || !date) return false;
    const next = ordered(start, date);
    const limit = this.maxDays();
    if (limit !== null && dayCount(next) > limit) {
      // Reported, not clamped: a shortened period would show something else than was picked.
      this.limitExceeded.set(true);
      return false;
    }
    this.draftStart.set(undefined);
    this.limitExceeded.set(false);
    if (!sameRange(next, this.range())) this.rangeChange.emit(next);
    return true;
  }

  protected clear(): boolean {
    if (!this.clearable()) return false;
    this.limitExceeded.set(false);
    this.draftStart.set(undefined);
    this.rangeChange.emit(EMPTY_RANGE);
    return true;
  }
}
