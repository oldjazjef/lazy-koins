import { provideHttpClient, withInterceptors } from '@angular/common/http';
import type { EnvironmentProviders } from '@angular/core';
import { dataChangesInterceptor } from './data-changes.interceptor';

/**
 * For specs: the HttpClient as the app wires it for data — every successful change reports itself
 * to `DataChanges`, so a page service's resources reload exactly as in the app.
 */
export function provideAppHttpClient(): EnvironmentProviders {
  return provideHttpClient(withInterceptors([dataChangesInterceptor]));
}
