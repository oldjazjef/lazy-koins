import { httpResource } from '@angular/common/http';
import {
  computed,
  inject,
  Injectable,
  linkedSignal,
  signal,
} from '@angular/core';
import { apiUrl } from '../../../../core/api/api-url';
import type {
  BookingTreatment,
  TransactionRow,
  TransactionsView,
} from '../../../../core/api/calculation.types';
import { DataChanges, reloadOn } from '../../../../core/data/data-changes';
import {
  PAGE_SIZES,
  type Pagination,
} from '../../../../shared/components/paginator';
import { ProjectWorkspaceService } from '../project-workspace/project-workspace.service';

const DEFAULT_SIZE = 25;
const STORAGE_KEY = `lk.pageSize.transactions`;

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
 * "Transaktionen": every booking of the project and how it counts in the tax calculation. The
 * API computes it from the live input and pages it (a ledger can have thousands of rows), so the
 * pager here is server-side. Changing a booking is a global transaction edit (F9.8) through the
 * shared dialogs — DataChanges then refreshes every project that uses it.
 */
@Injectable()
export class ProjectTransactionsService {
  private readonly workspace = inject(ProjectWorkspaceService);
  private readonly changes = inject(DataChanges);

  /** The search as applied (the component debounces the field). */
  readonly query = signal('');
  readonly treatment = signal<BookingTreatment | ''>('');
  readonly platform = signal('');
  /** F9.6: the tax year, or also earlier bookings that decide a balance at 31.12. */
  readonly scope = signal<'year' | 'all'>('year');

  readonly pageSize = signal(readSize());
  /** Zero-based; back to the first page whenever a filter or the page size changes. */
  private readonly requested = linkedSignal<unknown, number>({
    source: () => [
      this.query(),
      this.treatment(),
      this.platform(),
      this.scope(),
      this.pageSize(),
      this.workspace.projectId(),
    ],
    computation: () => 0,
  });

  readonly view = httpResource<TransactionsView>(() => {
    const id = this.workspace.projectId();
    if (!id || this.workspace.tab() !== 'transactions') return undefined;
    return {
      url: apiUrl(`/projects/${id}/transactions`),
      params: {
        offset: this.requested() * this.pageSize(),
        limit: this.pageSize(),
        ...(this.query().trim() ? { q: this.query().trim() } : {}),
        ...(this.treatment() ? { treatment: this.treatment() } : {}),
        ...(this.platform() ? { platform: this.platform() } : {}),
        ...(this.scope() === 'all' ? { scope: 'all' } : {}),
      },
    };
  });

  constructor() {
    // A correction, a file, rates … change how bookings count: refetch (keeps the rows on screen).
    reloadOn(
      () => this.changes.projectVersion(this.workspace.projectId()),
      [this.view],
    );
  }

  private readonly current = computed(() =>
    this.view.hasValue() ? this.view.value() : undefined,
  );
  readonly rows = computed<readonly TransactionRow[]>(
    () => this.current()?.rows ?? [],
  );
  readonly counts = computed(() => this.current()?.counts);
  readonly platforms = computed(() => this.current()?.platforms ?? []);
  readonly currency = computed(
    () => this.current()?.currency ?? this.workspace.currency(),
  );
  /** All bookings matching search + platform (the treatment chips' "Alle"). */
  readonly scopedTotal = computed(() => {
    const counts = this.counts();
    return counts ? Object.values(counts).reduce((a, b) => a + b, 0) : 0;
  });

  /** `lk-paginator` over the server's pages. */
  readonly pager: Pagination<TransactionRow> = (() => {
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

  showFigure(figureId: string, title: string): void {
    void this.workspace.showRecords(figureId, title);
  }
}
