import {
  ChangeDetectionStrategy,
  Component,
  inject,
  type OnInit,
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { HlmBadgeImports } from '@lazykoins/ui/badge';
import { HlmButtonImports } from '@lazykoins/ui/button';
import { HlmCardImports } from '@lazykoins/ui/card';
import { HlmSkeletonImports } from '@lazykoins/ui/skeleton';
import { EmptyState } from '../../../../shared/components/empty-state';
import { PageHeader } from '../../../../shared/components/page-header';
import { StorageSettingsPageService } from './storage-settings-page.service';

/**
 * Einstellungen → Speicherort (desktop app, F3.1): where the database and the original files
 * live — by default in the app's own folder, or any folder, including the sync folder of
 * OneDrive, Google Drive or Proton Drive (with the F3.4 warning).
 */
@Component({
  selector: 'lk-storage-settings-page',
  imports: [
    TranslatePipe,
    PageHeader,
    EmptyState,
    ...HlmBadgeImports,
    ...HlmButtonImports,
    ...HlmCardImports,
    ...HlmSkeletonImports,
  ],
  providers: [StorageSettingsPageService],
  templateUrl: './storage-settings-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StorageSettingsPage implements OnInit {
  protected readonly service = inject(StorageSettingsPageService);

  ngOnInit(): void {
    void this.service.load();
  }
}
