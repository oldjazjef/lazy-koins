import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideCircleHelp } from '@ng-icons/lucide';
import { TranslatePipe } from '@ngx-translate/core';

/**
 * "Welche Dateien brauche ich?" in a project's files area: what to download from every
 * exchange, broker and wallet for the tax year. Help text only — which file is read how is
 * still decided by the mapping specs, never by platform code.
 */
@Component({
  selector: 'lk-file-guide',
  imports: [NgIcon, TranslatePipe],
  providers: [provideIcons({ lucideCircleHelp })],
  templateUrl: './file-guide.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FileGuide {
  /** Open from the start (a project without files). */
  readonly open = input(false);
}
