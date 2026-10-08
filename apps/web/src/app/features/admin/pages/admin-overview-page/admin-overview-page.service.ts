import { httpResource } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type { AdminOverview } from '../../../../core/api/admin.types';
import { apiUrl } from '../../../../core/api/api-url';
import { DataChanges, reloadOn } from '../../../../core/data/data-changes';
import { EstvService } from '../../../../shared/estv/estv.service';

/** `/app/admin`: the counts, plus the deployment-wide ESTV Kursliste (start an update). */
@Injectable({ providedIn: 'root' })
export class AdminOverviewPageService {
  private readonly changes = inject(DataChanges);
  readonly estv = inject(EstvService);

  readonly overview = httpResource<AdminOverview>(() =>
    apiUrl('/admin/overview'),
  );

  /** Called by the page: reload on arrival and after every admin change while on screen. */
  follow(): void {
    this.overview.reload();
    this.estv.load();
    reloadOn(() => this.changes.globalVersion('admin'), [this.overview]);
  }

  async updateEstv(): Promise<void> {
    await this.estv.update().catch(() => undefined);
  }
}
