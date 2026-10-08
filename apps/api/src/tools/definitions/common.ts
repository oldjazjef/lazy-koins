import type { TransactionsService } from '../../transactions/transactions.service';
import { z } from 'zod';
import type { AiGate } from '../../ai/application/ai-gate';
import type { CalculationService } from '../../calculation/calculation.service';
import type { ExportsService } from '../../exports/exports.service';
import type { FilesService } from '../../files/files.service';
import type { LibraryService } from '../../library/library.service';
import type { MailService } from '../../mail/mail.service';
import type { MappingsService } from '../../mappings/mappings.service';
import type { ProjectsService } from '../../projects/projects.service';
import type { RatesService } from '../../rates/rates.service';
import type { SettingsService } from '../../settings/settings.service';
import type { WalletsService } from '../../wallets/wallets.service';

/** The application services the tools call — the same façades the controllers use. */
export interface ToolServices {
  readonly projects: ProjectsService;
  readonly files: FilesService;
  readonly mappings: MappingsService;
  readonly calculation: CalculationService;
  readonly rates: RatesService;
  readonly exports: ExportsService;
  readonly wallets: WalletsService;
  readonly settings: SettingsService;
  readonly mail: MailService;
  readonly ai: AiGate;
  /** F5.15–F5.17: the mapping library — its tools exist only where it is enabled (web). */
  readonly library?: LibraryService;
  /** F9.12: the global transactions (absent in specs that do not build the slice). */
  readonly transactions?: TransactionsService;
}

export const id = (what: string) =>
  z.string().trim().min(1).max(64).describe(`The ${what} id.`);

export const projectId = id('project').describe(
  'The project id (from list_projects or the page context).',
);

export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .describe('A date as YYYY-MM-DD.');

export const decimalText = z
  .string()
  .trim()
  .regex(/^[+-]?(\d+(\.\d*)?|\.\d+)$/)
  .describe('A plain decimal number as text, "." as the decimal point.');

/** The `reason` every change carries (F9.4: "jede Korrektur mit Begründung"). */
export const reason = z
  .string()
  .trim()
  .min(3)
  .max(500)
  .describe('Why — shown in the correction history. In German.');

/** Where in the web app: relative `/app/…` links the chat renders and the MCP client may show. */
export const link = z.string();

export const WORKSPACE_TABS = [
  'files',
  'hints',
  'wallets',
  'rates',
  'transactions',
  'result',
  'checks',
  'corrections',
  'exports',
] as const;
export type WorkspaceTab = (typeof WORKSPACE_TABS)[number];

export function projectLink(projectId: string, tab?: WorkspaceTab): string {
  return `/app/projects/${encodeURIComponent(projectId)}${tab ? `?tab=${tab}` : ''}`;
}

/** F7.5: a figure's drill-down (records → file + row) opens on the project page. */
export function figureLink(projectId: string, figureId: string): string {
  return `${projectLink(projectId, 'result')}&figure=${encodeURIComponent(figureId)}`;
}

/** The file's row in the files tab is scrolled to and marked (`#file-<id>`). */
export function fileLink(projectId: string, projectFileId: string): string {
  return `${projectLink(projectId, 'files')}#file-${encodeURIComponent(projectFileId)}`;
}

/** Cuts a list for the model (data minimisation) and says how many there were. */
export function capped<T>(
  items: readonly T[],
  limit: number,
): { items: T[]; total: number; truncated: boolean } {
  return {
    items: items.slice(0, limit),
    total: items.length,
    truncated: items.length > limit,
  };
}

export const limit = (fallback: number, max: number) =>
  z
    .number()
    .int()
    .min(1)
    .max(max)
    .default(fallback)
    .describe(`How many entries at most (default ${fallback}, max ${max}).`);
