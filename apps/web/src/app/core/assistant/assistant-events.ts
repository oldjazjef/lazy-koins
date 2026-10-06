import { Injectable, signal } from '@angular/core';

/** Something the assistant changed: a confirmed proposal or an upload from the chat. */
export interface AssistantChange {
  readonly seq: number;
  /** The project it touched; null = unknown (refresh whatever is on screen). */
  readonly projectId: string | null;
}

/**
 * App-wide ticks from the assistant (F11.14): `changed` after a confirmed proposal or a chat
 * upload — the project page and its workspace reload their resources when it names their
 * project; `settings` after the AI or assistant settings changed — the chat reloads its status.
 */
@Injectable({ providedIn: 'root' })
export class AssistantEvents {
  private seq = 0;
  private readonly lastChange = signal<AssistantChange | null>(null);
  private readonly settingsTick = signal(0);

  readonly change = this.lastChange.asReadonly();
  readonly settingsVersion = this.settingsTick.asReadonly();

  changed(projectId: string | null): void {
    this.lastChange.set({ seq: ++this.seq, projectId });
  }

  settingsChanged(): void {
    this.settingsTick.update((value) => value + 1);
  }

  /** True when `change` happened after `since` and concerns `projectId`. */
  static concerns(
    change: AssistantChange | null,
    since: number,
    projectId: string | undefined,
  ): boolean {
    return (
      change !== null &&
      change.seq > since &&
      (change.projectId === null || change.projectId === projectId)
    );
  }
}
