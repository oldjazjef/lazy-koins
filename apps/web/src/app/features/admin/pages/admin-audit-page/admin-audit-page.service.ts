import { httpResource } from '@angular/common/http';
import { computed, inject, Injectable } from '@angular/core';
import type {
  AdminAuditEntry,
  AdminPage,
} from '../../../../core/api/admin.types';
import { apiUrl } from '../../../../core/api/api-url';
import { DataChanges, reloadOn } from '../../../../core/data/data-changes';

export const AUDIT_LIMIT = 200;

/** `/app/admin/audit`: every admin action, newest first (the latest 200; the table pages them). */
@Injectable({ providedIn: 'root' })
export class AdminAuditPageService {
  private readonly changes = inject(DataChanges);

  readonly audit = httpResource<AdminPage<AdminAuditEntry>>(() => ({
    url: apiUrl('/admin/audit'),
    params: { limit: AUDIT_LIMIT },
  }));

  readonly rows = computed(() =>
    this.audit.hasValue() ? this.audit.value().items : [],
  );
  readonly total = computed(() =>
    this.audit.hasValue() ? this.audit.value().total : 0,
  );

  follow(): void {
    this.audit.reload();
    reloadOn(() => this.changes.globalVersion('admin'), [this.audit]);
  }
}
