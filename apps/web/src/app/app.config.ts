import {
  provideHttpClient,
  withFetch,
  withInterceptors,
} from '@angular/common/http';
import {
  type ApplicationConfig,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { provideSpartanHlm } from '@lazykoins/ui/utils';
import { appRoutes } from './app.routes';
import { authInterceptor } from './core/auth/auth.interceptor';
import { provideI18n } from './core/i18n/i18n.config';
import { unlockInterceptor } from './core/pin/unlock.interceptor';

/**
 * Zoneless: Angular 22 schedules change detection from signals and events, so there is no
 * `provideZoneChangeDetection` and no zone.js anywhere.
 */
export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(appRoutes, withComponentInputBinding()),
    provideHttpClient(
      withFetch(),
      // The bearer token first, then the PIN lock's unlock token (F11.0p).
      withInterceptors([authInterceptor, unlockInterceptor]),
    ),
    provideI18n(),
    provideSpartanHlm(),
  ],
};
