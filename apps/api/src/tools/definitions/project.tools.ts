import { z } from 'zod';
import { TAX_CURRENCIES } from '@lazykoins/engine';
import {
  CH_CANTONS,
  MAX_TAX_YEAR,
  MIN_TAX_YEAR,
  PROJECT_STATUSES,
  type ProjectStatus,
} from '../../projects/domain/project';
import { type AnyTool, defineTool, type ToolChange } from '../domain/tool';
import { enumText, previewText } from '../domain/preview-texts';
import { link, projectId, projectLink, type ToolServices } from './common';

const projectOut = z.object({
  id: z.string(),
  name: z.string(),
  taxYear: z.number(),
  canton: z.string(),
  status: z.enum(PROJECT_STATUSES),
  notes: z.string(),
  /** F4.1a: every amount of the project is in this currency (the `…Chf` names are historical). */
  currency: z.string(),
  link,
});

const projectSummaryOut = projectOut.extend({
  wealthChf: z.string().nullable(),
  incomeChf: z.string().nullable(),
  calculatedAt: z.string().nullable(),
});

function asOut(project: {
  id: string;
  name: string;
  taxYear: number;
  canton: string;
  status: (typeof PROJECT_STATUSES)[number];
  notes: string;
  taxCurrency?: string;
}) {
  return {
    id: project.id,
    name: project.name,
    taxYear: project.taxYear,
    canton: project.canton,
    status: project.status,
    notes: project.notes,
    currency: project.taxCurrency ?? 'CHF',
    link: projectLink(project.id),
  };
}

/** Projects (F4.1, F4.2, F4.5). */
export function projectTools(s: ToolServices): AnyTool[] {
  return [
    defineTool({
      name: 'list_projects',
      title: 'Projekte auflisten',
      description:
        "Lists all tax-year projects of the user (newest first) with status and the latest calculated wealth (Vermögen) and income (Ertrag) in the project's tax currency (field `currency`; the `…Chf` field names are historical).",
      area: 'projects',
      effect: 'readOnly',
      input: z.object({}),
      output: z.object({ projects: z.array(projectSummaryOut) }),
      async run(ctx) {
        const projects = await s.projects.listMine(ctx.userId);
        return {
          projects: projects.map((p) => ({
            ...asOut(p),
            wealthChf: p.figures?.wealthChf ?? null,
            incomeChf: p.figures?.incomeChf ?? null,
            calculatedAt: p.figures?.calculatedAt ?? null,
          })),
        };
      },
    }),
    defineTool({
      name: 'get_project',
      title: 'Projekt anzeigen',
      description:
        'One project: name, tax year, canton, status (in_progress | reviewed | closed — closed projects are read-only) and notes.',
      area: 'projects',
      effect: 'readOnly',
      input: z.object({ projectId }),
      output: projectOut,
      async run(ctx, input) {
        return asOut(await s.projects.get(ctx.userId, input.projectId));
      },
    }),
    defineTool({
      name: 'create_project',
      title: 'Projekt anlegen',
      description:
        'Creates a new project for one tax year (Switzerland, canton = two upper-case letters).',
      area: 'projects',
      effect: 'write',
      input: z.object({
        name: z.string().trim().min(1).max(120),
        taxYear: z.number().int().min(MIN_TAX_YEAR).max(MAX_TAX_YEAR),
        canton: z.enum(CH_CANTONS),
        taxCurrency: z
          .enum(TAX_CURRENCIES)
          .optional()
          .describe('F4.1a: the tax currency; absent = CHF.'),
        notes: z.string().max(2000).default(''),
      }),
      output: projectOut,
      async run(ctx, input) {
        return asOut(
          await s.projects.create(ctx.userId, {
            name: input.name,
            taxYear: input.taxYear,
            country: 'CH',
            canton: input.canton,
            ...(input.taxCurrency ? { taxCurrency: input.taxCurrency } : {}),
            notes: input.notes,
          }),
        );
      },
      async preview(_ctx, input) {
        return {
          summary: previewText('chat.preview.createProject', {
            name: input.name,
            year: input.taxYear,
            canton: input.canton,
          }),
          changes: [
            {
              label: previewText('chat.preview.label.name'),
              before: null,
              after: input.name,
            },
            {
              label: previewText('chat.preview.label.taxYear'),
              before: null,
              after: String(input.taxYear),
            },
            {
              label: previewText('chat.preview.label.canton'),
              before: null,
              after: input.canton,
            },
          ],
        };
      },
    }),
    defineTool({
      name: 'update_project',
      title: 'Projekt ändern',
      description:
        'Changes name, notes, canton or status of a project. Status "closed" makes it read-only; a closed project only accepts reopening (status alone).',
      area: 'projects',
      effect: 'write',
      input: z.object({
        projectId,
        name: z.string().trim().min(1).max(120).optional(),
        notes: z.string().max(2000).optional(),
        canton: z.enum(CH_CANTONS).optional(),
        status: z.enum(PROJECT_STATUSES).optional(),
        taxCurrency: z
          .enum(TAX_CURRENCIES)
          .optional()
          .describe('F4.1a: changing it makes the calculation stale.'),
      }),
      output: projectOut,
      async run(ctx, { projectId: id, ...changes }) {
        return asOut(await s.projects.update(ctx.userId, id, changes));
      },
      async preview(ctx, { projectId: id, ...changes }) {
        const before = await s.projects.get(ctx.userId, id);
        const status = (value: ProjectStatus | undefined) =>
          value === undefined ? undefined : enumText('projectStatus', value);
        const lines: ToolChange[] = (
          [
            ['chat.preview.label.name', before.name, changes.name],
            ['chat.preview.label.notes', before.notes, changes.notes],
            ['chat.preview.label.canton', before.canton, changes.canton],
            [
              'chat.preview.label.status',
              status(before.status),
              status(changes.status),
            ],
            [
              'chat.preview.label.taxCurrency',
              before.taxCurrency,
              changes.taxCurrency,
            ],
          ] as const
        )
          .filter(([, , after]) => after !== undefined)
          .map(([label, old, after]) => ({
            label: previewText(label),
            before: old ?? null,
            after: after ?? null,
          }));
        return {
          summary: previewText('chat.preview.updateProject', {
            name: before.name,
          }),
          changes: lines,
          projectId: id,
        };
      },
    }),
    defineTool({
      name: 'delete_project',
      title: 'Projekt löschen',
      description:
        'Deletes a project with its files, corrections, rates and exports. Irreversible. Closed projects cannot be deleted.',
      area: 'projects',
      effect: 'destructive',
      input: z.object({ projectId }),
      output: z.object({ deleted: z.boolean() }),
      async run(ctx, input) {
        await s.projects.remove(ctx.userId, input.projectId);
        return { deleted: true };
      },
      async preview(ctx, input) {
        const project = await s.projects.get(ctx.userId, input.projectId);
        return {
          summary: previewText('chat.preview.deleteProject', {
            name: project.name,
            year: project.taxYear,
          }),
          changes: [
            {
              label: previewText('chat.preview.label.project'),
              before: `${project.name} (${project.taxYear})`,
              after: null,
            },
          ],
        };
      },
    }),
  ];
}
