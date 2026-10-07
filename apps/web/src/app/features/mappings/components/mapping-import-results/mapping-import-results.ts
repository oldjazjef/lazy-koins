import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { HlmBadgeImports } from '@lazykoins/ui/badge';
import { HlmButtonImports } from '@lazykoins/ui/button';
import { HlmDialogImports } from '@lazykoins/ui/dialog';
import type { SpecIssue } from '../../../../core/api/api.types';
import { Truncate } from '../../../../shared/components/truncate';
import {
  type MappingImportOutcome,
  MappingImportService,
  MAX_MAPPING_FILES,
} from '../../mapping-import.service';

/**
 * F11.0u: the result of uploading several mapping files — per file stored (link to its page),
 * skipped as a duplicate (link to the mapping I already have), or refused with the reason (not
 * JSON, too large, beyond the batch limit, invalid with the schema issues). State in the root
 * `MappingImportService`; placed by the pages that upload (Mappings page, a project's mappings).
 */
@Component({
  selector: 'lk-mapping-import-results',
  imports: [
    RouterLink,
    TranslatePipe,
    Truncate,
    ...HlmBadgeImports,
    ...HlmButtonImports,
    ...HlmDialogImports,
  ],
  templateUrl: './mapping-import-results.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MappingImportResults {
  protected readonly service = inject(MappingImportService);
  protected readonly limit = MAX_MAPPING_FILES;

  protected state(): 'open' | 'closed' {
    return this.service.results() ? 'open' : 'closed';
  }

  protected changed(state: 'open' | 'closed'): void {
    if (state === 'closed') this.service.close();
  }

  protected variant(
    outcome: MappingImportOutcome,
  ): 'secondary' | 'outline' | 'destructive' {
    switch (outcome.state) {
      case 'stored':
        return 'secondary';
      case 'duplicate':
        return 'outline';
      default:
        return 'destructive';
    }
  }

  protected issues(outcome: MappingImportOutcome): readonly SpecIssue[] {
    return outcome.state === 'invalid' ? outcome.issues.slice(0, 8) : [];
  }

  protected moreIssues(outcome: MappingImportOutcome): number {
    return outcome.state === 'invalid'
      ? Math.max(0, outcome.issues.length - 8)
      : 0;
  }
}
