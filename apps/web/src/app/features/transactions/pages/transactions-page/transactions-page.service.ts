import { httpResource } from '@angular/common/http';
import {
  computed,
  inject,
  Injectable,
  linkedSignal,
  signal,
} from '@angular/core';
import type { BookingKind } from '../../../../core/api/api.types';
import { apiUrl } from '../../../../core/api/api-url';
import type {
  Transaction,
  TransactionsPage,
} from '../../../../core/api/transactions.types';
import { DataChanges, reloadOn } from '../../../../core/data/data-changes';
import type { DateRange } from '../../../../shared/components/date-range-picker';
import {
  PAGE_SIZES,
  type Pagination,
} from '../../../../shared/components/paginator';

const DEFAULT_SIZE = 25;
const STORAGE_KEY = `lk.pageSize.ledger`;

function readSize(): number {
  try {
    const value = Number(globalThis.localStorage?.getItem(STORAGE_KEY));
    return (PAGE_SIZES as readonly number[]).includes(value)
      ? value
      : DEFAULT_SIZE;
  } catch {
    return DEFAULT_SIZE;
  }
}

/**
 * F9.5 "Transaktionen" in the main navigation: every transaction of mine across all files and
 * wallets, filtered and paged by the API (a user can have tens of thousands), with a selection
 * on the current page for bulk edits (F9.8) and the AI review (F9.10).
 */
@Injectable({ providedIn: 'root' })
export class TransactionsPageService {
  private readonly changes = inject(DataChanges);

  readonly period = signal<DateRange>({ from: '', to: '' });
  readonly platform = signal('');
  readonly account = signal('');
  readonly asset = signal('');
  readonly kind = signal<BookingKind | ''>('');
  readonly changed = signal(false);
  readonly review = signal(false);
  /** The search as applied (the page debounces the field). */
  readonly query = signal('');

  readonly pageSize = signal(readSize());
  /** Zero-based; back to the first page whenever a filter or the page size changes. */
  private readonly requested = linkedSignal<unknown, number>({
    source: () => [
      this.period(),
      this.platform(),
      this.account(),
      this.asset(),
      this.kind(),
      this.changed(),
      this.review(),
      this.query(),
      this.pageSize(),
    ],
    computation: () => 0,
  });

  /** Keys ticked on the current page; cleared with every new page or filter. */
  readonly selected = linkedSignal<unknown, ReadonlySet<string>>({
    source: () => [this.requested(), this.view.value()],
    computation: () => new Set<string>(),
  });

  /** Off until the page is shown (`follow`). */
  private readonly active = signal(false);

  readonly view = httpResource<TransactionsPage>(() => {
    if (!this.active()) return undefined;
    const period = this.period();
    return {
      url: apiUrl('/transactions'),
      params: {
        offset: this.requested() * this.pageSize(),
        limit: this.pageSize(),
        ...(period.from ? { from: period.from } : {}),
        ...(period.to ? { to: period.to } : {}),
        ...(this.platform() ? { platform: this.platform() } : {}),
        ...(this.account() ? { account: this.account() } : {}),
        ...(this.asset() ? { asset: this.asset() } : {}),
        ...(this.kind() ? { kind: this.kind() } : {}),
        ...(this.changed() ? { changed: 'true' } : {}),
        ...(this.review() ? { review: 'true' } : {}),
        ...(this.query().trim() ? { q: this.query().trim() } : {}),
      },
    };
  });

  /** Reload on arrival and after every change while the page is on screen. */
  follow(): void {
    this.active.set(true);
    this.view.reload();
    reloadOn(
      () =>
        `${this.changes.globalVersion('transactions')}|${this.changes.globalVersion('files')}|${this.changes.globalVersion('projects')}`,
      [this.view],
    );
  }

  private readonly current = computed(() =>
    this.view.hasValue() ? this.view.value() : undefined,
  );
  readonly rows = computed<readonly Transaction[]>(
    () => this.current()?.rows ?? [],
  );
  readonly currency = computed(() => this.current()?.currency ?? 'CHF');
  readonly platforms = computed(() => this.current()?.platforms ?? []);
  readonly accounts = computed(() => this.current()?.accounts ?? []);
  readonly assets = computed(() => this.current()?.assets ?? []);
  readonly unreadable = computed(() => this.current()?.unreadable ?? 0);
  readonly filtered = computed(
    () =>
      !!(
        this.period().from ||
        this.period().to ||
        this.platform() ||
        this.account() ||
        this.asset() ||
        this.kind() ||
        this.changed() ||
        this.review() ||
        this.query().trim()
      ),
  );

  readonly selectedRows = computed(() =>
    this.rows().filter((r) => this.selected().has(r.key)),
  );
  readonly allSelected = computed(
    () =>
      this.rows().length > 0 &&
      this.rows().every((r) => this.selected().has(r.key)),
  );

  toggle(key: string): void {
    this.selected.update((set) => {
      const next = new Set(set);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  toggleAll(): void {
    this.selected.set(
      this.allSelected() ? new Set() : new Set(this.rows().map((r) => r.key)),
    );
  }

  clearSelection(): void {
    this.selected.set(new Set());
  }

  resetFilters(): void {
    this.period.set({ from: '', to: '' });
    this.platform.set('');
    this.account.set('');
    this.asset.set('');
    this.kind.set('');
    this.changed.set(false);
    this.review.set(false);
    this.query.set('');
  }

  /** `lk-paginator` over the server's pages. */
  readonly pager: Pagination<Transaction> = (() => {
    const total = computed(() => this.current()?.total ?? 0);
    const pageCount = computed(() =>
      Math.max(1, Math.ceil(total() / this.pageSize())),
    );
    const page = computed(() =>
      Math.min(Math.max(0, this.requested()), pageCount() - 1),
    );
    return {
      total,
      page,
      pageSize: this.pageSize.asReadonly(),
      pageCount,
      visible: this.rows,
      from: computed(() => (total() === 0 ? 0 : page() * this.pageSize() + 1)),
      to: computed(() => Math.min(total(), (page() + 1) * this.pageSize())),
      needed: computed(() => total() > PAGE_SIZES[0]),
      setPage: (next: number) =>
        this.requested.set(Math.min(Math.max(0, next), pageCount() - 1)),
      setPageSize: (size: number) => {
        if (!Number.isFinite(size) || size <= 0) return;
        this.pageSize.set(size);
        try {
          globalThis.localStorage?.setItem(STORAGE_KEY, String(size));
        } catch {
          // Blocked storage: the size just isn't remembered.
        }
      },
      reveal: () => false,
    };
  })();
}
