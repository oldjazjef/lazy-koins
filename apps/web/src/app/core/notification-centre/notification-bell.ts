import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  HostListener,
  inject,
  Injector,
  signal,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideBell,
  lucideCheck,
  lucideCheckCheck,
  lucideCircleCheck,
  lucideCircleX,
  lucideInfo,
  lucideTriangleAlert,
  lucideX,
} from '@ng-icons/lucide';
import { TranslatePipe } from '@ngx-translate/core';
import { HlmButtonImports } from '@lazykoins/ui/button';
import type {
  AppNotification,
  NotificationKind,
} from '../api/notifications.types';
import { NotificationCentreService } from './notification-centre.service';

/** Icon and colour class per kind (colours live in styles.css). */
export const KIND_ICONS: Readonly<Record<NotificationKind, string>> = {
  error: 'lucideCircleX',
  action: 'lucideTriangleAlert',
  info: 'lucideInfo',
  success: 'lucideCircleCheck',
};

export const KIND_CLASSES: Readonly<Record<NotificationKind, string>> = {
  error: 'lk-kind-error',
  action: 'lk-kind-action',
  info: 'lk-kind-info',
  success: 'lk-kind-success',
};

export const KIND_ICON_SET = {
  lucideCircleX,
  lucideTriangleAlert,
  lucideInfo,
  lucideCircleCheck,
};

/**
 * The bell in the header (F11.11): unread badge; a click opens the panel — newest first, grouped
 * by project, kind, relative time, text and the direct action; mark read, all read, dismiss,
 * "erledigte ausblenden", a link to the full page. Panel layout like a dialog: header, the only
 * scrolling body, footer with the actions. Escape or a click outside closes it and the focus goes
 * back to the bell.
 */
@Component({
  selector: 'lk-notification-bell',
  imports: [RouterLink, NgIcon, TranslatePipe, ...HlmButtonImports],
  providers: [
    provideIcons({
      lucideBell,
      lucideCheck,
      lucideCheckCheck,
      lucideX,
      ...KIND_ICON_SET,
    }),
  ],
  templateUrl: './notification-bell.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NotificationBell {
  protected readonly centre = inject(NotificationCentreService);
  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly injector = inject(Injector);
  private readonly bell = viewChild<ElementRef<HTMLButtonElement>>('bell');
  private readonly panel = viewChild<ElementRef<HTMLElement>>('panel');

  protected readonly open = signal(false);
  protected readonly icons = KIND_ICONS;
  protected readonly classes = KIND_CLASSES;
  protected readonly badge = computed(() => {
    const unread = this.centre.unread();
    return unread > 99 ? '99+' : String(unread);
  });

  protected toggle(): void {
    if (this.open()) {
      this.close();
      return;
    }
    this.open.set(true);
    void this.centre.refresh();
    afterNextRender(() => this.panel()?.nativeElement.focus(), {
      injector: this.injector,
    });
  }

  protected close(returnFocus = true): void {
    if (!this.open()) return;
    this.open.set(false);
    if (returnFocus) this.bell()?.nativeElement.focus();
  }

  protected async act(notification: AppNotification): Promise<void> {
    this.close(false);
    await this.centre.open(notification);
  }

  protected toggleResolved(event: Event): void {
    this.centre.setHideResolved((event.target as HTMLInputElement).checked);
  }

  @HostListener('document:click', ['$event'])
  protected outside(event: MouseEvent): void {
    const root = (this.host.nativeElement as HTMLElement).querySelector(
      '[data-notification-bell]',
    );
    if (root && !root.contains(event.target as Node)) this.close(false);
  }

  @HostListener('document:keydown.escape')
  protected escape(): void {
    this.close();
  }
}
