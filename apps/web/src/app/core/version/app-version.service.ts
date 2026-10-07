import { httpResource } from '@angular/common/http';
import { computed, Injectable } from '@angular/core';
import { apiUrl } from '../api/api-url';

/** `GET /api/version` — fixed when the API was built (scripts/build/version.mjs). */
export interface AppVersion {
  version: string;
  commit: string;
  full: string;
  builtAt: string | null;
}

/**
 * The version shown in the app (badge next to the name in the sidebar). Read from the API rather than baked into the web
 * bundle: web and API are always built from the same commit (one image pair per commit, one
 * desktop package), so the API's answer is the app's version — and env.js-style runtime config
 * stays free of build data. Absent (older API, offline) = nothing shown.
 */
@Injectable({ providedIn: 'root' })
export class AppVersionService {
  private readonly resource = httpResource<AppVersion>(() =>
    apiUrl('/version'),
  );

  readonly info = computed(() =>
    this.resource.hasValue() ? this.resource.value() : null,
  );
}
