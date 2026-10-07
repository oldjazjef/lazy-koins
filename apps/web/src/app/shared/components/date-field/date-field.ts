import {
  ChangeDetectionStrategy,
  Component,
  computed,
  forwardRef,
  inject,
  input,
  linkedSignal,
  output,
  signal,
} from '@angular/core';
import { NG_VALUE_ACCESSOR, type ControlValueAccessor } from '@angular/forms';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { HlmDatePicker, HlmDatePickerInput } from '@lazykoins/ui/date-picker';
import {
  dateToIso,
  formatDay,
  isoToDate,
  parseDay,
} from '../../format/date-only';
import { displayFormat } from '../../format/locale-format';

/**
 * The app's single date input (ported from etx-working-time-manager's `etx-date-field`): the
 * spartan date picker (`@lazykoins/ui/date-picker`) wearing a `yyyy-MM-dd` string as its value —
 * forms, page services and the API keep ISO days; the `Date` exists only between here and the
 * calendar (local midnight, never `toISOString()`, so no day shifts in any zone).
 *
 * Typing and display follow the user's date format (F11.2: `dd.MM.yyyy`, `yyyy-MM-dd`, …; ISO
 * typed or pasted is always understood); month/weekday names and the week start come from the
 * app-wide calendar texts (`core/i18n/calendar-i18n.ts`). Keyboard: type a date, ↓ or the calendar
 * button opens the calendar (arrow keys, Page Up/Down, Home/End, Enter), Escape closes it.
 *
 * Use it with a form control **or** `[value]` + `(changed)`, never both:
 *
 * ```html
 * <lk-date-field inputId="rate-date" formControlName="date" />
 * <lk-date-field inputId="mark-date" [max]="today()" [value]="date()" (changed)="date.set($event)" />
 * ```
 */
@Component({
  selector: 'lk-date-field',
  imports: [TranslatePipe, HlmDatePicker, HlmDatePickerInput],
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => DateField),
      multi: true,
    },
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block min-w-36' },
  template: `
    <hlm-date-picker
      align="start"
      [captionLayout]="captionLayout()"
      [formatDate]="formatDate()"
      [date]="picked()"
      [minDate]="minPicked()"
      [maxDate]="maxPicked()"
      [disabled]="isDisabled()"
      (dateChange)="onPicked($event)"
    >
      <hlm-date-picker-input
        class="w-full"
        [inputId]="inputId()"
        [placeholder]="placeholder()"
        [formatInputDate]="formatDate()"
        [parseDate]="parseDate()"
        [calendarAriaLabel]="'dateField.open' | translate"
        [clearAriaLabel]="'dateField.clear' | translate"
        [showClear]="clearable()"
      />
    </hlm-date-picker>
    @if (outOfRange()) {
      <p class="text-destructive mt-1 text-xs" role="alert">
        {{ boundsKey() | translate: bounds() }}
      </p>
    }
  `,
})
export class DateField implements ControlValueAccessor {
  private readonly translate = inject(TranslateService);

  /** Wired to the `<label for="…">` that names this field. */
  readonly inputId = input.required<string>();

  /** `'dropdown'`: a date is often months or years away — month/year selects, not paging. */
  readonly captionLayout = input<
    'dropdown' | 'label' | 'dropdown-months' | 'dropdown-years'
  >('dropdown');

  /** The day, for a caller that keeps it in a signal instead of a form control. */
  readonly value = input<string>('');

  /** Bounds as `yyyy-MM-dd` (inclusive) — days outside are disabled in the calendar. */
  readonly min = input<string>('');
  readonly max = input<string>('');

  /** Whether the field offers a clear button (an optional date). */
  readonly clearable = input(false);

  /** Locks the field without touching the form control. */
  readonly readonly = input(false);

  /** Fires after the value changed: the new `yyyy-MM-dd`, `''` when cleared. */
  readonly changed = output<string>();

  private readonly current = linkedSignal(() => this.value());
  private readonly disabledByForm = signal(false);

  protected readonly isDisabled = computed(
    () => this.disabledByForm() || this.readonly(),
  );

  protected readonly picked = computed(() => isoToDate(this.current()));
  protected readonly minPicked = computed(() => isoToDate(this.min()));
  protected readonly maxPicked = computed(() => isoToDate(this.max()));

  /** Display and edit format are the same, so focusing never reformats what is in the field. */
  protected readonly formatDate = computed(() => {
    const format = displayFormat().dateFormat;
    return (date: Date) => formatDay(date, format);
  });

  protected readonly parseDate = computed(() => {
    const format = displayFormat().dateFormat;
    return (raw: string) => parseDay(raw, format);
  });

  /** `TT.MM.JJJJ` / `DD.MM.YYYY` / `YYYY-MM-DD` — the format in the language's letters. */
  protected readonly placeholder = computed(() => {
    this.translate.currentLang();
    const letters = {
      d: this.translate.instant('dateField.letter.day'),
      M: this.translate.instant('dateField.letter.month'),
      y: this.translate.instant('dateField.letter.year'),
    } as Record<string, string>;
    return displayFormat().dateFormat.replace(
      /[dMy]/g,
      (letter) => letters[letter] ?? letter,
    );
  });

  /** A typed day outside min/max: not committed (the value becomes empty) and explained. */
  protected readonly outOfRange = signal(false);

  protected readonly bounds = computed(() => {
    const format = displayFormat().dateFormat;
    const min = this.minPicked();
    const max = this.maxPicked();
    return {
      min: min ? formatDay(min, format) : '–',
      max: max ? formatDay(max, format) : '–',
    };
  });

  private onChange: (value: string) => void = () => undefined;
  private onTouched: () => void = () => undefined;

  /** Which sentence explains the bounds: both, only a latest or only an earliest day. */
  protected readonly boundsKey = computed(() =>
    this.min() && this.max()
      ? 'dateField.outOfRange'
      : this.max()
        ? 'dateField.notAfter'
        : 'dateField.notBefore',
  );

  /** The value last handed to the form / `changed` (re-seeded by the `value` input). */
  private readonly committed = linkedSignal(() => this.value());

  protected onPicked(date: Date | null): void {
    const day = date ? dateToIso(date) : '';
    const outside =
      day !== '' &&
      ((this.min() !== '' && day < this.min()) ||
        (this.max() !== '' && day > this.max()));
    this.outOfRange.set(outside);
    // The field keeps showing what was typed, so a typo can be fixed; the form gets ''.
    this.current.set(day);
    const next = outside ? '' : day;
    if (next === this.committed()) return;
    this.committed.set(next);
    this.onChange(next);
    this.onTouched();
    this.changed.emit(next);
  }

  writeValue(value: unknown): void {
    const next = typeof value === 'string' ? value : '';
    this.outOfRange.set(false);
    this.committed.set(next);
    this.current.set(next);
  }

  registerOnChange(fn: (value: string) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(isDisabled: boolean): void {
    this.disabledByForm.set(isDisabled);
  }
}
