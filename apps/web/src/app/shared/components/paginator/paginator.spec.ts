import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideTranslateService } from '@ngx-translate/core';
import { paginate } from './paginate';
import { Paginator } from './paginator';

const rows = (count: number) => Array.from({ length: count }, (_, i) => i + 1);

describe('paginate', () => {
  afterEach(() => localStorage.clear());

  it('shows 10 rows per page by default and pages through them', () => {
    TestBed.runInInjectionContext(() => {
      const items = signal(rows(57));
      const pager = paginate(items);
      expect(pager.pageSize()).toBe(10);
      expect(pager.pageCount()).toBe(6);
      expect(pager.visible()).toEqual(rows(10));
      expect([pager.from(), pager.to(), pager.total()]).toEqual([1, 10, 57]);

      pager.setPage(5);
      expect(pager.visible()).toEqual([51, 52, 53, 54, 55, 56, 57]);
      expect([pager.from(), pager.to()]).toEqual([51, 57]);

      pager.setPage(99);
      expect(pager.page()).toBe(5);
      pager.setPage(-3);
      expect(pager.page()).toBe(0);
    });
  });

  it('is not needed while everything fits on one page of 10', () => {
    const items = signal(rows(10));
    const pager = paginate(items);
    expect(pager.needed()).toBe(false);
    items.set(rows(11));
    expect(pager.needed()).toBe(true);
    items.set([]);
    expect([pager.from(), pager.to(), pager.pageCount()]).toEqual([0, 0, 1]);
  });

  it('keeps the page valid when rows disappear', () => {
    const items = signal(rows(35));
    const pager = paginate(items);
    pager.setPage(3);
    expect(pager.visible()).toEqual([31, 32, 33, 34, 35]);
    items.set(rows(30));
    expect(pager.page()).toBe(2);
    expect(pager.visible()).toEqual(rows(30).slice(20));
  });

  it('returns to the first page when the filters change', () => {
    const items = signal(rows(57));
    const search = signal('');
    const pager = paginate(items, { resetOn: () => search() });
    pager.setPage(4);
    items.set(rows(56)); // a removed row is not a filter change
    expect(pager.page()).toBe(4);
    search.set('btc');
    expect(pager.page()).toBe(0);
  });

  it('changes the page size, back on page 1, and remembers it per table', () => {
    const items = signal(rows(57));
    const pager = paginate(items, { storageKey: 'spec' });
    pager.setPage(3);
    pager.setPageSize(25);
    expect([pager.page(), pager.pageCount(), pager.visible().length]).toEqual([
      0, 3, 25,
    ]);
    expect(localStorage.getItem('lk.pageSize.spec')).toBe('25');
    expect(paginate(items, { storageKey: 'spec' }).pageSize()).toBe(25);
    expect(paginate(items, { storageKey: 'other' }).pageSize()).toBe(10);
  });

  it('ignores a page size from storage it does not offer', () => {
    localStorage.setItem('lk.pageSize.spec', '7');
    expect(paginate(signal(rows(3)), { storageKey: 'spec' }).pageSize()).toBe(
      10,
    );
  });

  it('reveals the page that holds a row (a #file-<id> link)', () => {
    const items = signal(rows(57));
    const pager = paginate(items);
    expect(pager.reveal((row) => row === 42)).toBe(true);
    expect(pager.page()).toBe(4);
    expect(pager.reveal((row) => row === 999)).toBe(false);
    expect(pager.page()).toBe(4);
  });
});

@Component({
  imports: [Paginator],
  template: `<lk-paginator [pager]="pager" />`,
})
class Host {
  readonly items = signal(rows(57));
  readonly pager = paginate(this.items);
}

describe('Paginator', () => {
  function render() {
    TestBed.configureTestingModule({ providers: [provideTranslateService()] });
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    return fixture;
  }

  const button = (el: HTMLElement, label: string) =>
    el.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);

  it('renders the range and moves between pages', () => {
    const fixture = render();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('common.pagination.range');
    expect(button(el, 'common.pagination.first')?.disabled).toBe(true);
    expect(button(el, 'common.pagination.previous')?.disabled).toBe(true);

    button(el, 'common.pagination.next')?.click();
    fixture.detectChanges();
    expect(fixture.componentInstance.pager.page()).toBe(1);

    button(el, 'common.pagination.last')?.click();
    fixture.detectChanges();
    expect(fixture.componentInstance.pager.page()).toBe(5);
    expect(button(el, 'common.pagination.next')?.disabled).toBe(true);
  });

  it('offers 10 / 25 / 50 / 100 rows per page', () => {
    const fixture = render();
    const select = (fixture.nativeElement as HTMLElement).querySelector(
      'select',
    );
    expect([...(select?.options ?? [])].map((option) => option.value)).toEqual([
      '10',
      '25',
      '50',
      '100',
    ]);
    if (select) {
      select.value = '50';
      select.dispatchEvent(new Event('change'));
    }
    fixture.detectChanges();
    expect(fixture.componentInstance.pager.pageCount()).toBe(2);
  });

  it('hides itself when every row fits on one page', () => {
    const fixture = render();
    fixture.componentInstance.items.set(rows(4));
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('nav')).toBe(
      null,
    );
  });
});
