import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { HlmBadgeImports } from '@lazykoins/ui/badge';
import type { ProjectStatus } from '../../../../core/api/api.types';

/** F4.1 status as a badge: in Arbeit (outline), geprüft (secondary), abgeschlossen (solid). */
@Component({
  selector: 'lk-project-status-badge',
  imports: [TranslatePipe, ...HlmBadgeImports],
  template: `
    <span hlmBadge [variant]="variant()">{{
      'projects.status.' + status() | translate
    }}</span>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProjectStatusBadge {
  readonly status = input.required<ProjectStatus>();

  protected readonly variant = computed(() => {
    switch (this.status()) {
      case 'closed':
        return 'default';
      case 'reviewed':
        return 'secondary';
      default:
        return 'outline';
    }
  });
}
