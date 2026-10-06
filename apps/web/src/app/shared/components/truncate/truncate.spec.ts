import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { BrnTooltip } from '@spartan-ng/brain/tooltip';
import { By } from '@angular/platform-browser';
import { Truncate } from './truncate';

@Component({
  imports: [Truncate],
  template: `<span [lkTruncate]="text()">{{ text() }}</span>`,
})
class Host {
  readonly text = signal(
    'Kraken ledger 2025 (all accounts, incl. staking).csv',
  );
}

/** jsdom has no layout: fake the measured widths. */
function size(el: HTMLElement, scrollWidth: number, clientWidth: number) {
  Object.defineProperty(el, 'scrollWidth', {
    configurable: true,
    value: scrollWidth,
  });
  Object.defineProperty(el, 'clientWidth', {
    configurable: true,
    value: clientWidth,
  });
}

describe('Truncate', () => {
  function render() {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const debug = fixture.debugElement.query(By.directive(Truncate));
    return {
      el: debug.nativeElement as HTMLElement,
      tooltip: debug.injector.get(BrnTooltip),
    };
  }

  it('cuts the text to one line with an ellipsis', () => {
    const { el } = render();
    expect(el.classList).toContain('truncate');
    expect(el.classList).toContain('block');
  });

  it('offers the full text as a tooltip only when it is actually cut', () => {
    const { el, tooltip } = render();
    expect(tooltip.brnTooltip()).toBe(
      'Kraken ledger 2025 (all accounts, incl. staking).csv',
    );

    size(el, 120, 200);
    el.dispatchEvent(new Event('pointerenter'));
    expect(tooltip.mutableTooltipDisabled()).toBe(true);

    size(el, 480, 200);
    el.dispatchEvent(new Event('pointerenter'));
    expect(tooltip.mutableTooltipDisabled()).toBe(false);
  });
});
