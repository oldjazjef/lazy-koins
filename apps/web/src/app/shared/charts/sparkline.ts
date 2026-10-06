import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';

/**
 * A price trend in a table cell (F11.8): one thin line, up = positive colour, down = negative;
 * gaps where a day had no price. Decorative next to the price column — the accessible name
 * states first and last value.
 */
@Component({
  selector: 'lk-sparkline',
  template: `
    <svg
      class="block h-6 w-24"
      viewBox="0 0 100 24"
      [attr.preserveAspectRatio]="'none'"
      role="img"
      [attr.aria-label]="label()"
    >
      <title>{{ label() }}</title>
      <path
        class="lk-spark"
        [class.lk-spark-up]="trend() >= 0"
        [class.lk-spark-down]="trend() < 0"
        [attr.d]="path()"
      />
    </svg>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Sparkline {
  /** Decimal strings (null = no price that day) — numbers only for drawing. */
  readonly values = input.required<readonly (string | null)[]>();
  readonly label = input.required<string>();

  private readonly numbers = computed(() =>
    this.values().map((v) => {
      if (v === null) return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    }),
  );

  protected readonly trend = computed(() => {
    const known = this.numbers().filter((n): n is number => n !== null);
    if (known.length < 2) return 0;
    return (known[known.length - 1] as number) - (known[0] as number);
  });

  protected readonly path = computed(() => {
    const values = this.numbers();
    const known = values.filter((n): n is number => n !== null);
    if (known.length === 0) return '';
    const min = Math.min(...known);
    const max = Math.max(...known);
    const span = max - min || 1;
    const step = values.length <= 1 ? 0 : 100 / (values.length - 1);
    let path = '';
    let pen = false;
    values.forEach((v, i) => {
      if (v === null) {
        pen = false;
        return;
      }
      const x = (i * step).toFixed(2);
      const y = (21 - ((v - min) / span) * 18).toFixed(2);
      path += `${pen ? 'L' : 'M'}${x},${y} `;
      pen = true;
    });
    return path.trim();
  });
}
