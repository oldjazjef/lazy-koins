import { HttpClient } from '@angular/common/http';
import { computed, DOCUMENT, inject, Injectable, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { defineAction } from '../../../../core/actions/action';
import { ActionRunner } from '../../../../core/actions/action-runner';
import { apiUrl } from '../../../../core/api/api-url';
import type { ImportedAccount } from '../../../../core/api/dashboard.types';
import { NotificationService } from '../../../../core/notifications/notification.service';
import { fileNameFrom, saveBlob } from '../../../../shared/files/save-blob';

/**
 * Profil › Daten (F10.9 = F2.3): all my data as an account package (no API keys), and importing
 * one — into this account or another one (later also the desktop app).
 */
@Injectable()
export class ProfilePageService {
  private readonly http = inject(HttpClient);
  private readonly actions = inject(ActionRunner);
  private readonly notifications = inject(NotificationService);
  private readonly document = inject(DOCUMENT);

  readonly downloading = signal(false);
  readonly lastImport = signal<ImportedAccount | null>(null);

  async downloadAll(): Promise<void> {
    this.downloading.set(true);
    try {
      const response = await firstValueFrom(
        this.http.get(apiUrl('/account/package'), {
          observe: 'response',
          responseType: 'blob',
        }),
      );
      saveBlob(
        this.document,
        response.body ?? new Blob(),
        fileNameFrom(
          response.headers.get('Content-Disposition'),
          'lazy-koins-konto.lkaccount.zip',
        ),
      );
    } catch {
      this.notifications.error('profile.data.downloadFailed');
    } finally {
      this.downloading.set(false);
    }
  }

  private readonly importAction = defineAction<File, ImportedAccount>({
    run: (file) =>
      firstValueFrom(
        this.http.post<ImportedAccount>(
          apiUrl('/account/import-package'),
          file,
          { headers: { 'Content-Type': 'application/octet-stream' } },
        ),
      ),
    messages: {
      success: 'profile.data.imported',
      error: 'profile.data.importFailed',
    },
  });

  private readonly status = this.actions.status<unknown>('account-import');
  readonly isImporting = computed(() => this.status()?.state === 'pending');

  async importPackage(file: File): Promise<void> {
    this.lastImport.set(
      await this.actions.run(this.importAction, file, {
        key: 'account-import',
      }),
    );
  }
}
