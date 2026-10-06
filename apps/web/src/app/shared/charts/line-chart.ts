import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  signal,
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { ChfPipe, formatChf } from '../format/number-format';

export interface LinePoint {
  readonly date: string;
  /** Decimal string — turned into a number only here, for drawing (CLAUDE.md, Numbers). */
  readonly value: string;
  /** Assets without a price that day (F11.9): shown, never counted as 0. */
  readonly missing: readonly string[];
}

const WIDTH = 1000;
const HEIGHT = 240;

/** Drawing only: a decimal string → a number for a coordinate. Never used for arithmetic on money. */
function toNumber(value: string): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * The value over time as a line (F11.5): hand-rolled SVG, theme tokens only, a crosshair +
 * tooltip on hover and keyboard (arrow keys), a strip marking days with missing prices, and the
 * same data as a visually hidden table for screen readers.
 */
@Component({
  selector: 'lk-line-chart',
  imports: [DatePipe, TranslatePipe, ChfPipe],
  templateUrl: './line-chart.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LineChart {
  readonly points = input.required<readonly LinePoint[]>();
  /** Accessible name (already translated). */
  readonly label = input.required<string>();
  readonly compact = input(false);

  protected readonly width = WIDTH;
  protected readonly height = computed(() => (this.compact() ? 120 : HEIGHT));
  protected readonly active = signal<number | null>(null);

  private readonly numbers = computed(() =>
    this.points().map((p) => toNumber(p.value)),
  );

  protected readonly domain = computed(() => {
    const values = this.numbers();
    if (values.length === 0) return { min: 0, max: 1 };
    let min = Math.min(...values);
    let max = Math.max(...values);
    if (min === max) {
      min = min === 0 ? 0 : min * 0.95;
      max = max === 0 ? 1 : max * 1.05;
    }
    const pad = (max - min) * 0.08;
    return { min: Math.max(0, min - pad), max: max + pad };
  });

  private x(index: number): number {
    const count = this.points().length;
    return count <= 1 ? WIDTH / 2 : (index / (count - 1)) * WIDTH;
  }

  private y(value: number): number {
    const { min, max } = this.domain();
    const plot = this.height() - 16;
    return 8 + plot - ((value - min) / (max - min)) * plot;
  }

  protected readonly line = computed(() =>
    this.numbers()
      .map(
        (v, i) =>
          `${i === 0 ? 'M' : 'L'}${this.x(i).toFixed(2)},${this.y(v).toFixed(2)}`,
      )
      .join(' '),
  );

  protected readonly area = computed(() => {
    const count = this.numbers().length;
    if (count === 0) return '';
    const bottom = this.height();
    return `${this.line()} L${this.x(count - 1).toFixed(2)},${bottom} L0,${bottom} Z`;
  });

  protected readonly gridLines = computed(() => {
    const plot = this.height() - 16;
    return [0, 0.25, 0.5, 0.75, 1].map((f) => 8 + plot * f);
  });

  /** Axis labels: the top and bottom of the domain, formatted as CHF. */
  protected readonly yLabels = computed(() => {
    const { min, max } = this.domain();
    return [
      formatChf(String(Math.round(max))),
      formatChf(String(Math.round(min))),
    ];
  });

  /** Missing-price days as strip segments in viewBox units. */
  protected readonly missingBars = computed(() => {
    const count = this.points().length;
    const step = count <= 1 ? WIDTH : WIDTH / (count - 1);
    return this.points().flatMap((p, i) =>
      p.missing.length > 0
        ? [{ x: Math.max(0, this.x(i) - step / 2), width: step }]
        : [],
    );
  });

  protected readonly hasMissing = computed(() =>
    this.points().some((p) => p.missing.length > 0),
  );

  protected readonly activePoint = computed(() => {
    const index = this.active();
    if (index === null) return null;
    const point = this.points()[index];
    if (!point) return null;
    return {
      point,
      x: this.x(index),
      y: this.y(this.numbers()[index] ?? 0),
      leftPct: Math.min(88, Math.max(12, (this.x(index) / WIDTH) * 100)),
    };
  });

  protected readonly ticks = computed(() => {
    const points = this.points();
    if (points.length === 0) return [];
    const picks = [0, Math.floor((points.length - 1) / 2), points.length - 1];
    return [...new Set(picks)].map((i) => points[i]?.date ?? '');
  });

  protected move(event: MouseEvent): void {
    const target = event.currentTarget as SVGElement;
    const rect = target.getBoundingClientRect();
    const count = this.points().length;
    if (count === 0 || rect.width === 0) return;
    const ratio = (event.clientX - rect.left) / rect.width;
    this.active.set(
      Math.min(count - 1, Math.max(0, Math.round(ratio * (count - 1)))),
    );
  }

  protected key(event: KeyboardEvent): void {
    const count = this.points().length;
    if (count === 0) return;
    const current = this.active() ?? count - 1;
    if (event.key === 'ArrowLeft') this.active.set(Math.max(0, current - 1));
    else if (event.key === 'ArrowRight')
      this.active.set(Math.min(count - 1, current + 1));
    else if (event.key === 'Home') this.active.set(0);
    else if (event.key === 'End') this.active.set(count - 1);
    else if (event.key === 'Escape') this.active.set(null);
    else return;
    event.preventDefault();
  }

  protected leave(): void {
    this.active.set(null);
  }
}
