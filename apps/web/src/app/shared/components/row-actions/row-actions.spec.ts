import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { lucideDownload, lucideEye, lucideTrash2 } from '@ng-icons/lucide';
import { provideTranslateService } from '@ngx-translate/core';
import { type RowAction, RowActions } from './row-actions';

/** Counts clicks that reach the "row" (the host) — the actions must not let any through. */
@Component({
  imports: [RowActions],
  host: { '(click)': 'rowClicks = rowClicks + 1' },
  template: `<lk-row-actions
    [actions]="actions()"
    (selected)="picked.push($event)"
  />`,
})
class Host {
  readonly actions = signal<readonly RowAction[]>([]);
  readonly picked: string[] = [];
  rowClicks = 0;
}

const remove: RowAction = {
  id: 'remove',
  labelKey: 'files.actions.remove',
  icon: lucideTrash2,
  danger: true,
};
const preview: RowAction = {
  id: 'preview',
  labelKey: 'files.actions.preview',
  icon: lucideEye,
};
const download: RowAction = {
  id: 'download',
  labelKey: 'files.actions.download',
  icon: lucideDownload,
};

describe('RowActions', () => {
  function render(actions: readonly RowAction[]) {
    TestBed.configureTestingModule({ providers: [provideTranslateService()] });
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.actions.set(actions);
    fixture.detectChanges();
    return fixture;
  }

  afterEach(() => {
    document.querySelector('.cdk-overlay-container')?.replaceChildren();
  });

  it('shows one plain icon button when only one action is visible', () => {
    const fixture = render([preview, { ...remove, hidden: true }]);
    const buttons = (fixture.nativeElement as HTMLElement).querySelectorAll(
      'button',
    );
    expect(buttons).toHaveLength(1);
    expect(buttons[0]?.getAttribute('aria-label')).toBe(
      'files.actions.preview',
    );
    expect(buttons[0]?.hasAttribute('aria-haspopup')).toBe(false);
    buttons[0]?.click();
    expect(fixture.componentInstance.picked).toEqual(['preview']);
    expect(fixture.componentInstance.rowClicks).toBe(0);
  });

  it('renders nothing without a visible action', () => {
    const fixture = render([{ ...preview, hidden: true }]);
    expect((fixture.nativeElement as HTMLElement).querySelector('button')).toBe(
      null,
    );
  });

  it('puts several actions behind one "⋯" menu, destructive ones last', async () => {
    const fixture = render([remove, preview, download]);
    const trigger = (fixture.nativeElement as HTMLElement).querySelector(
      'button',
    );
    expect(
      (fixture.nativeElement as HTMLElement).querySelectorAll('button'),
    ).toHaveLength(1);
    expect(trigger?.getAttribute('aria-label')).toBe('common.actions');
    expect(trigger?.getAttribute('aria-haspopup')).toBe('menu');

    trigger?.click();
    fixture.detectChanges();
    await fixture.whenStable();

    const items = [
      ...document.querySelectorAll<HTMLButtonElement>(
        '[data-slot="dropdown-menu-item"]',
      ),
    ];
    expect(items.map((item) => item.textContent?.trim())).toEqual([
      'files.actions.preview',
      'files.actions.download',
      'files.actions.remove',
    ]);
    expect(items[2]?.getAttribute('data-variant')).toBe('destructive');
    expect(
      document.querySelector('[data-slot="dropdown-menu-separator"]'),
    ).not.toBe(null);

    items[1]?.click();
    fixture.detectChanges();
    expect(fixture.componentInstance.picked).toEqual(['download']);
    expect(fixture.componentInstance.rowClicks).toBe(0);
  });

  it('keeps disabled actions in the menu but not selectable', async () => {
    const fixture = render([preview, { ...download, disabled: true }]);
    (fixture.nativeElement as HTMLElement).querySelector('button')?.click();
    fixture.detectChanges();
    await fixture.whenStable();
    const disabled = document.querySelectorAll(
      '[data-slot="dropdown-menu-item"]',
    )[1];
    expect(disabled?.hasAttribute('data-disabled')).toBe(true);
  });
});
