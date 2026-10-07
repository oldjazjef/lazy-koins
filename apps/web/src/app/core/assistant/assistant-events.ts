import { Injectable, signal } from '@angular/core';

/**
 * App-wide tick of the assistant settings (F11.14): `settingsChanged` after the AI or assistant
 * settings changed — the chat reloads its status. Data the assistant changed (a confirmed
 * proposal, a chat upload) goes to `DataChanges` like every other change.
 */
@Injectable({ providedIn: 'root' })
export class AssistantEvents {
  private readonly settingsTick = signal(0);

  readonly settingsVersion = this.settingsTick.asReadonly();

  settingsChanged(): void {
    this.settingsTick.update((value) => value + 1);
  }
}
