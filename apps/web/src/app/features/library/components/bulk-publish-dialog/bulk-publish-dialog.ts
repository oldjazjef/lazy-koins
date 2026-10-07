import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideShieldAlert } from '@ng-icons/lucide';
import { TranslatePipe } from '@ngx-translate/core';
import { HlmBadgeImports } from '@lazykoins/ui/badge';
import { HlmButtonImports } from '@lazykoins/ui/button';
import { HlmDialogImports } from '@lazykoins/ui/dialog';
import { HlmInputImports } from '@lazykoins/ui/input';
import { HlmLabelImports } from '@lazykoins/ui/label';
import { HlmSkeletonImports } from '@lazykoins/ui/skeleton';
import { Truncate } from '../../../../shared/components/truncate';
import {
  blockOf,
  type BulkItem,
  type BulkMode,
  BulkPublishService,
} from './bulk-publish.service';

/**
 * F5.20: the review of several mappings before they are published — per mapping its findings
 * (removable as in the single dialog), new entry / new version / skip, the exact JSON on demand;
 * the pseudonym once, the quota warning, the explicit confirmation; then the per-item results.
 * State in `BulkPublishService` (provided by the host page).
 */
@Component({
  selector: 'lk-bulk-publish-dialog',
  imports: [
    FormsModule,
    RouterLink,
    NgIcon,
    TranslatePipe,
    Truncate,
    ...HlmBadgeImports,
    ...HlmButtonImports,
    ...HlmDialogImports,
    ...HlmInputImports,
    ...HlmLabelImports,
    ...HlmSkeletonImports,
  ],
  providers: [provideIcons({ lucideShieldAlert })],
  templateUrl: './bulk-publish-dialog.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BulkPublishDialog {
  protected readonly bulk = inject(BulkPublishService);
  protected readonly blockOf = blockOf;

  protected state(): 'open' | 'closed' {
    return this.bulk.open() ? 'open' : 'closed';
  }

  protected changed(state: 'open' | 'closed'): void {
    if (state === 'closed') this.bulk.close();
  }

  protected json(item: BulkItem): string {
    return item.review ? JSON.stringify(item.review.spec, null, 2) : '';
  }

  protected setMode(item: BulkItem, mode: string): void {
    if (mode === 'new' || mode === 'version' || mode === 'skip') {
      this.bulk.setMode(item.mapping.id, mode as BulkMode);
    }
  }

  /** The reason of a refusal: its own text for the codes that need one, else the API's. */
  protected refusalKey(code: string | null, fallback: string | null): string {
    switch (code) {
      case 'publishLimit':
        return 'library.bulk.refused.publishLimit';
      case 'rateLimited':
        return 'library.bulk.refused.rateLimited';
      case 'libraryCopy':
        return 'library.bulk.block.libraryCopy';
      default:
        return fallback ?? 'library.publish.failed';
    }
  }
}
