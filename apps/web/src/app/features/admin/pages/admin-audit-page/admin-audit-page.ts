import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { HlmBadgeImports } from '@lazykoins/ui/badge';
import { HlmButtonImports } from '@lazykoins/ui/button';
import { HlmSkeletonImports } from '@lazykoins/ui/skeleton';
import { HlmTableImports } from '@lazykoins/ui/table';
import { EmptyState } from '../../../../shared/components/empty-state';
import { PageHeader } from '../../../../shared/components/page-header';
import { paginate, Paginator } from '../../../../shared/components/paginator';
import { Truncate } from '../../../../shared/components/truncate';
import { LkDatePipe } from '../../../../shared/format/date.pipe';
import { AdminAuditPageService } from './admin-audit-page.service';

/** `/app/admin/audit`: who did what to which account or library entry, and why. */
@Component({
  selector: 'lk-admin-audit-page',
  imports: [
    TranslatePipe,
    LkDatePipe,
    PageHeader,
    EmptyState,
    Paginator,
    Truncate,
    ...HlmBadgeImports,
    ...HlmButtonImports,
    ...HlmSkeletonImports,
    ...HlmTableImports,
  ],
  templateUrl: './admin-audit-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminAuditPage {
  protected readonly service = inject(AdminAuditPageService);
  protected readonly skeletonRows = [1, 2, 3];
  protected readonly pager = paginate(this.service.rows, {
    storageKey: 'admin-audit',
  });

  constructor() {
    this.service.follow();
  }
}
