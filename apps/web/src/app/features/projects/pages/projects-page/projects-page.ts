import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucidePlus } from '@ng-icons/lucide';
import { TranslatePipe } from '@ngx-translate/core';
import { HlmButtonImports } from '@lazykoins/ui/button';
import { HlmSkeletonImports } from '@lazykoins/ui/skeleton';
import { HlmTableImports } from '@lazykoins/ui/table';
import { EmptyState } from '../../../../shared/components/empty-state';
import { ChfPipe } from '../../../../shared/format/number-format';
import { PageHeader } from '../../../../shared/components/page-header';
import { ProjectStatusBadge } from '../../components/project-status-badge';
import { ProjectsPageService } from './projects-page.service';

@Component({
  selector: 'lk-projects-page',
  imports: [
    RouterLink,
    NgIcon,
    TranslatePipe,
    PageHeader,
    EmptyState,
    ChfPipe,
    ProjectStatusBadge,
    ...HlmButtonImports,
    ...HlmSkeletonImports,
    ...HlmTableImports,
  ],
  providers: [provideIcons({ lucidePlus })],
  templateUrl: './projects-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProjectsPage {
  protected readonly service = inject(ProjectsPageService);
  private readonly router = inject(Router);
  protected readonly skeletonRows = [1, 2, 3];

  constructor() {
    this.service.refresh();
  }

  protected open(id: string): void {
    void this.router.navigate(['/app/projects', id]);
  }
}
