import { Injectable, signal } from '@angular/core';

/**
 * A tick whenever something may have changed a project's F4.7 state ("An Treuhänder gesendet",
 * "seit dem Versand geändert"): a send, a manual mark or undo, a new export or calculation. The
 * project page's status resource reads it, so the badge in its header follows the workspace tabs.
 */
@Injectable({ providedIn: 'root' })
export class ProjectSentEvents {
  private readonly tick = signal(0);
  readonly version = this.tick.asReadonly();

  changed(): void {
    this.tick.update((value) => value + 1);
  }
}
