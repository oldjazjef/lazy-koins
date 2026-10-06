/**
 * A project = one tax year of one person (F4.1). Hand-written domain types — never a re-export of
 * a generated Prisma model (see CLAUDE.md, "Persistence architecture").
 */

/** F4.1: in Arbeit / geprüft / abgeschlossen. Mirrored by a CHECK in the init migration. */
export const PROJECT_STATUSES = ['in_progress', 'reviewed', 'closed'] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

/** F7.7: country rules are exchangeable, but only Switzerland exists so far. */
export const COUNTRIES = ['CH'] as const;
export type Country = (typeof COUNTRIES)[number];

/** The 26 Swiss cantons, as their official two-letter codes. */
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

/** Oldest tax year a project may cover; earlier crypto history is imported, not declared. */
export const MIN_TAX_YEAR = 2009;
export const MAX_TAX_YEAR = 2100;

export interface Project {
  readonly id: string;
  readonly ownerId: string;
  readonly name: string;
  readonly taxYear: number;
  readonly country: Country;
  /** Two-letter canton code (`ZH`); which ones are valid depends on the country. */
  readonly canton: string;
  readonly status: ProjectStatus;
  readonly notes: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreateProjectInput {
  readonly name: string;
  readonly taxYear: number;
  readonly country: Country;
  readonly canton: string;
  readonly notes: string;
}

/** Year and country are fixed once a project exists: its files and rates belong to them. */
export interface UpdateProjectInput {
  readonly name?: string;
  readonly notes?: string;
  readonly status?: ProjectStatus;
  readonly canton?: string;
}

/**
 * F4.5: a closed project is read-only. The only change it accepts is being reopened — a status
 * other than `closed`, and nothing else in the same request (the app asks for confirmation
 * first). Returns the reason a change is refused, or `undefined` when it may go ahead.
 */
export function closedProjectProblem(
  project: Pick<Project, 'status'>,
  input: UpdateProjectInput,
): string | undefined {
  if (project.status !== 'closed') return undefined;
  const { status, ...rest } = input;
  const otherFields = Object.values(rest).some((value) => value !== undefined);
  if (status !== undefined && status !== 'closed' && !otherFields) {
    return undefined;
  }
  return 'The project is closed: reopen it first, then change it';
}

/** Whether a canton code exists in the given country. */
export function isCanton(country: Country, canton: string): boolean {
  return country === 'CH' && (CH_CANTONS as readonly string[]).includes(canton);
}
