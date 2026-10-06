/**
 * The API's response and request shapes, hand-mirrored from apps/api's DTOs (generating them from
 * `/api/openapi.json` is an open decision — see CLAUDE.md). Keep in step with:
 *
 * - `users/dto/me-response.dto.ts`
 * - `projects/dto/project.dto.ts`, `projects/domain/project.ts`
 *
 * Quantities and amounts will arrive as decimal **strings** — never declare them as `number`.
 */

export interface Me {
  id: string;
  email: string;
  displayName: string;
  signInProvider: string;
  createdAt: string;
}

/** F4.1: in Arbeit / geprüft / abgeschlossen. */
export const PROJECT_STATUSES = ['in_progress', 'reviewed', 'closed'] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const COUNTRIES = ['CH'] as const;
export type Country = (typeof COUNTRIES)[number];

/** The 26 Swiss cantons (official two-letter codes), as the API validates them. */
export const CH_CANTONS = [
  'AG',
  'AI',
  'AR',
  'BE',
  'BL',
  'BS',
  'FR',
  'GE',
  'GL',
  'GR',
  'JU',
  'LU',
  'NE',
  'NW',
  'OW',
  'SG',
  'SH',
  'SO',
  'SZ',
  'TG',
  'TI',
  'UR',
  'VD',
  'VS',
  'ZG',
  'ZH',
] as const;
export type Canton = (typeof CH_CANTONS)[number];

export const MIN_TAX_YEAR = 2009;
export const MAX_TAX_YEAR = 2100;

export interface Project {
  id: string;
  name: string;
  taxYear: number;
  country: Country;
  canton: string;
  status: ProjectStatus;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

/** `POST /api/projects` */
export interface CreateProjectRequest {
  name: string;
  taxYear: number;
  country: Country;
  canton: string;
  notes?: string;
}

/** `PATCH /api/projects/:id` — a closed project accepts only `status` (reopening). */
export interface UpdateProjectRequest {
  name?: string;
  notes?: string;
  status?: ProjectStatus;
  canton?: string;
}
