import { inject, Injectable, signal } from '@angular/core';
import { Router } from '@angular/router';
import type { ChatContext, ChatContextTab } from '../api/assistant.types';

/** What the API accepts as `context.route`. */
const ROUTE_PATTERN = /^\/[A-Za-z0-9/_.#?=&%-]*$/;
const MAX_ROUTE = 300;

/**
 * Where the user is while asking (F11.14): the route, plus the project and workspace tab that the
 * project workspace publishes while it is on screen (and clears when it goes).
 */
@Injectable({ providedIn: 'root' })
export class ChatContextService {
  private readonly router = inject(Router);

  readonly projectId = signal<string | null>(null);
  readonly tab = signal<ChatContextTab | null>(null);

  context(): ChatContext {
    const projectId = this.projectId();
    const tab = this.tab();
    return {
      route: chatRoute(this.router.url),
      ...(projectId ? { projectId } : {}),
      ...(projectId && tab ? { tab } : {}),
    };
  }

  /** The workspace leaves: no project, no tab. */
  clear(projectId: string): void {
    if (this.projectId() !== projectId) return;
    this.projectId.set(null);
    this.tab.set(null);
  }
}

/** The path only (no query or fragment), cut to the API's limit; anything odd becomes `/app`. */
export function chatRoute(url: string): string {
  const path = url.split(/[?#]/)[0]?.slice(0, MAX_ROUTE) ?? '';
  return ROUTE_PATTERN.test(path) ? path : '/app';
}
