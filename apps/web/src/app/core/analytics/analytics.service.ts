import { DOCUMENT, inject, Injectable } from '@angular/core';
import { runtimeEnv, type RuntimeEnv } from '../config/runtime-env';

/**
 * Page-view statistics through a self-hosted Umami (cookieless, no personal data) — as in
 * surf-lend. Off unless the deployment sets both `umamiUrl` and `umamiWebsiteId`, and never in the
 * desktop app (`authMode: 'local'`: its data stays on the machine, F1.2). Umami's tracker follows
 * the router's `history.pushState` itself, so nothing else needs to call it. Query strings and
 * fragments (`?tab=`, `&figure=`, `#file-<id>`) are not sent — only the path.
 */
@Injectable({ providedIn: 'root' })
export class AnalyticsService {
  private readonly document = inject(DOCUMENT);

  init(): void {
    const tracker = umamiTracker(runtimeEnv());
    if (!tracker) return;

    const script = this.document.createElement('script');
    script.defer = true;
    script.src = tracker.src;
    script.dataset['websiteId'] = tracker.websiteId;
    script.dataset['excludeSearch'] = 'true';
    script.dataset['excludeHash'] = 'true';
    this.document.head.appendChild(script);
  }
}

/** The tracker script to load, or null when statistics are off. Exported for the spec. */
export function umamiTracker(
  env: Pick<RuntimeEnv, 'authMode' | 'umamiUrl' | 'umamiWebsiteId'>,
): { src: string; websiteId: string } | null {
  if (env.authMode === 'local' || !env.umamiUrl || !env.umamiWebsiteId) {
    return null;
  }
  return { src: `${env.umamiUrl}/script.js`, websiteId: env.umamiWebsiteId };
}
