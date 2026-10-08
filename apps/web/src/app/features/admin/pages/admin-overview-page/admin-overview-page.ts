import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { HlmButtonImports } from '@lazykoins/ui/button';
import { HlmSkeletonImports } from '@lazykoins/ui/skeleton';
import { AppVersionService } from '../../../../core/version/app-version.service';
import { EmptyState } from '../../../../shared/components/empty-state';
import { PageHeader } from '../../../../shared/components/page-header';
import { LkDatePipe } from '../../../../shared/format/date.pipe';
import { NumberPipe } from '../../../../shared/format/number-format';
import { formatBytes } from '../../../../shared/mail/mail-error';
import { AdminOverviewPageService } from './admin-overview-page.service';

/**
 * `/app/admin`: how the deployment is doing — accounts, activity, projects, storage, the
 * library, the database, the version and the ESTV Kursliste. Counts only, never content.
 */
@Component({
  selector: 'lk-admin-overview-page',
  imports: [
    RouterLink,
    TranslatePipe,
    LkDatePipe,
    NumberPipe,
    PageHeader,
    EmptyState,
    ...HlmButtonImports,
    ...HlmSkeletonImports,
  ],
  templateUrl: './admin-overview-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminOverviewPage {
  protected readonly service = inject(AdminOverviewPageService);
  protected readonly version = inject(AppVersionService);
  protected readonly bytes = formatBytes;

  constructor() {
    this.service.follow();
  }
}
