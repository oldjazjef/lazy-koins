import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { HlmBadgeImports } from '@lazykoins/ui/badge';
import { HlmButtonImports } from '@lazykoins/ui/button';
import { StorageSettingsPageService } from '../../../settings/pages/storage-settings-page/storage-settings-page.service';
import { provideSetupStep, SetupStepComponent } from '../setup-step';

/**
 * Speicherort (desktop only, F3.1): where the database and the files live — the default folder or
 * any folder, also a sync folder (with the F3.4 warning). The settings page's own service: the
 * native folder picker, then the app restarts on the new folder.
 */
@Component({
  selector: 'lk-setup-storage-step',
  imports: [TranslatePipe, ...HlmBadgeImports, ...HlmButtonImports],
  providers: [StorageSettingsPageService, provideSetupStep(() => StorageStep)],
  template: `
    @if (service.info(); as info) {
      <div class="flex flex-col gap-4">
        <dl class="lk-facts">
          <dt>{{ 'settings.storage.folder' | translate }}</dt>
          <dd class="flex flex-wrap items-center gap-2 font-mono break-all">
            {{ info.dataDir }}
            @if (info.isDefault) {
              <span hlmBadge variant="secondary">{{
                'settings.storage.default' | translate
              }}</span>
            }
            @if (info.syncProvider; as provider) {
              <span hlmBadge variant="outline">{{
                'settings.storage.synced' | translate: { provider }
              }}</span>
            }
          </dd>
        </dl>
        @if (info.syncProvider) {
          <p class="lk-warning-text text-sm" role="note">
            {{ 'setup.storage.syncHint' | translate }}
          </p>
        }
        <p class="text-muted-foreground text-sm">
          {{ 'setup.storage.restartHint' | translate }}
        </p>
        <div class="flex flex-wrap gap-2">
          <button
            hlmBtn
            variant="outline"
            type="button"
            [disabled]="service.busy()"
            (click)="service.choose()"
          >
            {{ 'settings.storage.choose' | translate }}
          </button>
          @if (!info.isDefault) {
            <button
              hlmBtn
              variant="ghost"
              type="button"
              [disabled]="service.busy()"
              (click)="service.useDefault()"
            >
              {{ 'settings.storage.useDefault' | translate }}
            </button>
          }
        </div>
      </div>
    } @else {
      <p class="text-muted-foreground text-sm">
        {{ 'setup.storage.webOnly' | translate }}
      </p>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StorageStep extends SetupStepComponent {
  protected readonly service = inject(StorageSettingsPageService);

  constructor() {
    super();
    void this.service.load();
  }

  async submit(): Promise<boolean> {
    return true;
  }
}
