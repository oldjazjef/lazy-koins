import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucidePlus, lucideUpload } from '@ng-icons/lucide';
import { TranslatePipe } from '@ngx-translate/core';
import { HlmButtonImports } from '@lazykoins/ui/button';
import { HlmSkeletonImports } from '@lazykoins/ui/skeleton';
import { HlmTableImports } from '@lazykoins/ui/table';
import { EmptyState } from '../../../../shared/components/empty-state';
import { ChfPipe } from '../../../../shared/format/number-format';
import { PageHeader } from '../../../../shared/components/page-header';
import { paginate, Paginator } from '../../../../shared/components/paginator';
import { Truncate } from '../../../../shared/components/truncate';
import { ProjectSentBadge } from '../../components/project-sent-badge';
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
    ProjectSentBadge,
    Paginator,
    Truncate,
    ...HlmButtonImports,
    ...HlmSkeletonImports,
    ...HlmTableImports,
  ],
  providers: [provideIcons({ lucidePlus, lucideUpload })],
  templateUrl: './projects-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProjectsPage {
  protected readonly service = inject(ProjectsPageService);
  private readonly router = inject(Router);
  protected readonly skeletonRows = [1, 2, 3];
  protected readonly pager = paginate(
    computed(() =>
      this.service.projects.hasValue() ? this.service.projects.value() : [],
    ),
    { storageKey: 'projects' },
  );

  constructor() {
    this.service.follow();
  }

  protected importPackage(input: HTMLInputElement): void {
    const file = input.files?.[0];
    input.value = '';
    if (file) void this.service.importPackage(file).catch(() => undefined);
  }

  protected open(id: string): void {
    void this.router.navigate(['/app/projects', id]);
  }
}
