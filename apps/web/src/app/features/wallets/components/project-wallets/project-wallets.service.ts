import { HttpClient, httpResource } from '@angular/common/http';
import { computed, inject, Injectable, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { apiUrl } from '../../../../core/api/api-url';
import { DataChanges, reloadOn } from '../../../../core/data/data-changes';
import type { ProjectFile, ProjectFiles } from '../../../../core/api/api.types';
import type {
  ManualBalanceRequest,
  ProjectWallets,
  Wallet,
} from '../../../../core/api/wallets.types';
import { NotificationService } from '../../../../core/notifications/notification.service';
import { walletError } from '../../wallet-errors';

/**
 * The project's "Wallets" tab: which wallets the project includes, their fetch status per network
 * (F6.3, F6.4), "Abrufen", and manual balances with a PDF receipt (F6.5). Everything the fetch
 * brings becomes a derived file of the project — the calculation reads it like any other file.
 */
@Injectable()
export class ProjectWalletsService {
  private readonly http = inject(HttpClient);
  private readonly notifications = inject(NotificationService);

  readonly projectId = signal<string | undefined>(undefined);

  readonly overview = httpResource<ProjectWallets>(() => {
    const id = this.projectId();
    return id ? apiUrl(`/projects/${id}/wallets`) : undefined;
  });
  private readonly files = httpResource<ProjectFiles>(() => {
    const id = this.projectId();
    return id ? apiUrl(`/projects/${id}/files`) : undefined;
  });

  constructor() {
    // Include/remove, fetch, check, balances, a wallet edited on its own page: DataChanges.
    const changes = inject(DataChanges);
    reloadOn(
      () =>
        changes.projectVersion(this.projectId()) +
        changes.globalVersion('wallets'),
      [this.overview, this.files],
    );
  }

  /** PDFs of the project — the possible receipts (F6.5). */
  readonly receipts = computed<ProjectFile[]>(() =>
    this.files.hasValue()
      ? this.files
          .value()
          .groups.flatMap((g) => g.files)
          .filter((f) => f.status === 'evidence_only')
      : [],
  );

  readonly busy = signal<string | null>(null);

  private id(): string {
    const id = this.projectId();
    if (!id) throw new Error('No project on screen');
    return id;
  }

  private fail(error: unknown): void {
    const { key, detail } = walletError(error);
    this.notifications.error(key, detail);
  }

  private async run(
    key: string,
    work: () => Promise<unknown>,
    success: string,
  ) {
    this.busy.set(key);
    try {
      await work();
      this.notifications.success(success);
      return true;
    } catch (error) {
      this.fail(error);
      return false;
    } finally {
      this.busy.set(null);
    }
  }

  add(walletId: string): Promise<boolean> {
    return this.run(
      'add',
      () =>
        firstValueFrom(
          this.http.post(apiUrl(`/projects/${this.id()}/wallets`), {
            walletId,
          }),
        ),
      'wallets.project.added',
    );
  }

  remove(walletId: string): Promise<boolean> {
    return this.run(
      `remove:${walletId}`,
      () =>
        firstValueFrom(
          this.http.delete(
            apiUrl(`/projects/${this.id()}/wallets/${walletId}`),
          ),
        ),
      'wallets.project.removed',
    );
  }

  checkNetworks(walletId: string): Promise<boolean> {
    return this.run(
      `check:${walletId}`,
      () =>
        firstValueFrom(
          this.http.post<Wallet>(
            apiUrl(`/wallets/${walletId}/check-networks`),
            {},
          ),
        ),
      'wallets.checked',
    );
  }

  fetch(walletId: string): Promise<boolean> {
    return this.run(
      `fetch:${walletId}`,
      () =>
        firstValueFrom(
          this.http.post<Wallet>(apiUrl(`/wallets/${walletId}/fetch`), {}),
        ),
      'wallets.fetched',
    );
  }

  /** F6.5: a PDF receipt goes to the project's files (evidence only). */
  async uploadReceipt(file: File): Promise<ProjectFile | undefined> {
    this.busy.set('upload');
    try {
      const stored = await firstValueFrom(
        this.http.post<ProjectFile>(
          apiUrl(`/projects/${this.id()}/files`),
          file,
          {
            params: { name: file.name },
            headers: { 'Content-Type': 'application/octet-stream' },
          },
        ),
      );
      return stored;
    } catch (error) {
      this.fail(error);
      return undefined;
    } finally {
      this.busy.set(null);
    }
  }

  addBalance(
    walletId: string,
    request: ManualBalanceRequest,
  ): Promise<boolean> {
    return this.run(
      'balance',
      () =>
        firstValueFrom(
          this.http.post(
            apiUrl(`/projects/${this.id()}/wallets/${walletId}/balances`),
            request,
          ),
        ),
      'wallets.balances.added',
    );
  }

  removeBalance(walletId: string, balanceId: string): Promise<boolean> {
    return this.run(
      `balance:${balanceId}`,
      () =>
        firstValueFrom(
          this.http.delete(
            apiUrl(
              `/projects/${this.id()}/wallets/${walletId}/balances/${balanceId}`,
            ),
          ),
        ),
      'wallets.balances.removed',
    );
  }
}
