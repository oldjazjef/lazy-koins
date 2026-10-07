import { LkDatePipe } from '../../../../shared/format/date.pipe';
import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { HlmBadgeImports } from '@lazykoins/ui/badge';

/**
 * F4.7 as a badge: "An Treuhänder gesendet am …", and "seit dem Versand geändert" when data or
 * statements changed afterwards. Renders nothing when the project was never sent.
 */
@Component({
  selector: 'lk-project-sent-badge',
  imports: [LkDatePipe, TranslatePipe, ...HlmBadgeImports],
  template: `
    @if (sentAt(); as at) {
      <span class="inline-flex flex-wrap items-center gap-1">
        <span hlmBadge variant="secondary">{{
          'projects.sent.badge' | translate: { date: (at | lkDate) }
        }}</span>
        @if (changedSince()) {
          <span hlmBadge variant="outline" class="lk-warning-text">{{
            'projects.sent.changedSince' | translate
          }}</span>
        }
      </span>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProjectSentBadge {
  readonly sentAt = input<string | null>(null);
  readonly changedSince = input(false);
}
