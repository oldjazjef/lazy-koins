import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
} from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { HlmToasterImports } from '@lazykoins/ui/sonner';
import { ThemeService } from './core/theme/theme.service';

@Component({
  selector: 'lk-root',
  imports: [RouterOutlet, ...HlmToasterImports],
  templateUrl: './app.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {
  private readonly theme = inject(ThemeService);
  protected readonly toasterTheme = computed(() => this.theme.current());
}
