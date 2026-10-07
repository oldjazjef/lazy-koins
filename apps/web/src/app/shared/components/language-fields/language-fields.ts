import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { HlmInputImports } from '@lazykoins/ui/input';
import { HlmLabelImports } from '@lazykoins/ui/label';
import { isSupportedLocale } from '../../../core/i18n/locales';
import {
  DATE_FORMAT_OPTIONS,
  LANGUAGE_OPTIONS,
  type LanguageChoice,
  NUMBER_FORMAT_OPTIONS,
  withLanguage,
} from '../../format/format-options';
import {
  DATE_FORMATS,
  type DateFormat,
  NUMBER_FORMATS,
  type NumberFormat,
} from '../../format/locale-format';

/**
 * F11.2: language, number format and date format — three selects, used by Profil and the setup
 * wizard's first step. A new language brings its own formats (`withLanguage`); the host decides
 * when to save. Emits on every change.
 */
@Component({
  selector: 'lk-language-fields',
  imports: [TranslatePipe, ...HlmInputImports, ...HlmLabelImports],
  template: `
    <div class="flex flex-col gap-2">
      <label hlmLabel [for]="idPrefix() + '-language'">{{
        'profile.fields.language' | translate
      }}</label>
      <select
        hlmInput
        [id]="idPrefix() + '-language'"
        [disabled]="disabled()"
        (change)="language($any($event.target).value)"
      >
        @for (option of languages; track option.value) {
          <option
            [value]="option.value"
            [lang]="option.value"
            [selected]="option.value === choice().locale"
          >
            {{ option.label }}
          </option>
        }
      </select>
    </div>
    <div class="flex flex-col gap-2">
      <label hlmLabel [for]="idPrefix() + '-number'">{{
        'profile.fields.numberFormat' | translate
      }}</label>
      <select
        hlmInput
        [id]="idPrefix() + '-number'"
        [disabled]="disabled()"
        (change)="number($any($event.target).value)"
      >
        @for (option of numberFormats; track option.value) {
          <option
            [value]="option.value"
            [selected]="option.value === choice().numberFormat"
          >
            {{ option.labelKey | translate }}
          </option>
        }
      </select>
    </div>
    <div class="flex flex-col gap-2">
      <label hlmLabel [for]="idPrefix() + '-date'">{{
        'profile.fields.dateFormat' | translate
      }}</label>
      <select
        hlmInput
        [id]="idPrefix() + '-date'"
        [disabled]="disabled()"
        (change)="date($any($event.target).value)"
      >
        @for (option of dateFormats; track option.value) {
          <option
            [value]="option.value"
            [selected]="option.value === choice().dateFormat"
          >
            {{ option.labelKey | translate }}
          </option>
        }
      </select>
    </div>
  `,
  host: { class: 'contents' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LanguageFields {
  readonly choice = input.required<LanguageChoice>();
  readonly idPrefix = input('language');
  readonly disabled = input(false);
  readonly choiceChange = output<LanguageChoice>();

  protected readonly languages = LANGUAGE_OPTIONS;
  protected readonly numberFormats = NUMBER_FORMAT_OPTIONS;
  protected readonly dateFormats = DATE_FORMAT_OPTIONS;

  protected language(value: string): void {
    if (!isSupportedLocale(value) || value === this.choice().locale) return;
    this.choiceChange.emit(withLanguage(this.choice(), value));
  }

  protected number(value: string): void {
    if (!(NUMBER_FORMATS as readonly string[]).includes(value)) return;
    this.choiceChange.emit({
      ...this.choice(),
      numberFormat: value as NumberFormat,
    });
  }

  protected date(value: string): void {
    if (!(DATE_FORMATS as readonly string[]).includes(value)) return;
    this.choiceChange.emit({
      ...this.choice(),
      dateFormat: value as DateFormat,
    });
  }
}
