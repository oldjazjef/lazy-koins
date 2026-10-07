import { computed, linkedSignal, type Signal } from '@angular/core';

/** The page sizes a table offers; the first one is the default (user rule: 10 per page). */
export const PAGE_SIZES = [10, 25, 50, 100] as const;
export const DEFAULT_PAGE_SIZE = PAGE_SIZES[0];

export interface PaginateOptions {
  /** Rows per page; default 10. */
  readonly pageSize?: number;
  /**
   * Remembers the chosen page size per table in localStorage (`lk.pageSize.<key>`). Optional —
   * a blocked storage simply falls back to the default.
   */
  readonly storageKey?: string;
  /**
   * Back to the first page whenever this changes — pass the filters/search/sort the list
   * depends on (`() => [this.search(), this.kind()]`). Compared by value (JSON).
   */
  readonly resetOn?: () => unknown;
}

/** One table's paging state (client-side): what `lk-paginator` renders and controls. */
export interface Pagination<T> {
  /** All rows (after filters), the paginator's "von N". */
  readonly total: Signal<number>;
  /** Zero-based; always valid — clamped when rows disappear. */
  readonly page: Signal<number>;
  readonly pageSize: Signal<number>;
  readonly pageCount: Signal<number>;
  /** The rows of the current page. */
  readonly visible: Signal<readonly T[]>;
  /** One-based index of the first and last visible row (0/0 when empty). */
  readonly from: Signal<number>;
  readonly to: Signal<number>;
  /** False when everything fits on the smallest page — the paginator hides itself. */
  readonly needed: Signal<boolean>;
  setPage(page: number): void;
  setPageSize(size: number): void;
  /** Shows the page that holds the first row matching `predicate` (e.g. a `#file-<id>` link). */
  reveal(predicate: (item: T) => boolean): boolean;
}

/**
 * Client-side paging over a signal of rows: `paginate(rows, { storageKey: 'files' })`. Rows
 * stay a plain signal (filters, sorting and search happen before), the template renders
 * `pager.visible()` and `<lk-paginator [pager]="pager" />`.
 */
export function paginate<T>(
  items: Signal<readonly T[]>,
  options: PaginateOptions = {},
): Pagination<T> {
  const resetKey = computed(() => {
    const value = options.resetOn?.();
    return value === undefined ? '' : JSON.stringify(value);
  });
  const pageSize = linkedSignal<number>(
    () => readSize(options.storageKey) ?? options.pageSize ?? DEFAULT_PAGE_SIZE,
  );
  // Back to page 1 when the filters change (resetKey) or the page size does.
  const requested = linkedSignal<{ key: string; size: number }, number>({
    source: () => ({ key: resetKey(), size: pageSize() }),
    computation: () => 0,
  });
  const total = computed(() => items().length);
  const pageCount = computed(() =>
    Math.max(1, Math.ceil(total() / pageSize())),
  );
  const page = computed(() =>
    Math.min(Math.max(0, requested()), pageCount() - 1),
  );
  const visible = computed(() => {
    const start = page() * pageSize();
    return items().slice(start, start + pageSize());
  });
  const from = computed(() => (total() === 0 ? 0 : page() * pageSize() + 1));
  const to = computed(() => Math.min(total(), (page() + 1) * pageSize()));
  const needed = computed(() => total() > PAGE_SIZES[0]);

  return {
    total,
    page,
    pageSize,
    pageCount,
    visible,
    from,
    to,
    needed,
    setPage: (next) =>
      requested.set(Math.min(Math.max(0, next), pageCount() - 1)),
    setPageSize: (size) => {
      if (!Number.isFinite(size) || size <= 0) return;
      pageSize.set(size);
      writeSize(options.storageKey, size);
    },
    reveal: (predicate) => {
      const index = items().findIndex(predicate);
      if (index < 0) return false;
      requested.set(Math.floor(index / pageSize()));
      return true;
    },
  };
}

const STORAGE_PREFIX = 'lk.pageSize.';

function readSize(key: string | undefined): number | undefined {
  if (!key) return undefined;
  try {
    const value = Number(
      globalThis.localStorage?.getItem(STORAGE_PREFIX + key),
    );
    return (PAGE_SIZES as readonly number[]).includes(value)
      ? value
      : undefined;
  } catch {
    return undefined;
  }
}

function writeSize(key: string | undefined, size: number): void {
  if (!key) return;
  try {
    globalThis.localStorage?.setItem(STORAGE_PREFIX + key, String(size));
  } catch {
    // Private mode / blocked storage: the size just isn't remembered.
  }
}
