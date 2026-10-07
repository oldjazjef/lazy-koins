import { z } from 'zod';
import type { ProjectFileView } from '../../files/application/file-views';
import { PROJECT_FILE_STATUSES } from '../../files/domain/project-file';
import { HINT_STATUSES } from '../../files/domain/project-hint';
import { type AnyTool, defineTool, ToolError } from '../domain/tool';
import { enumText, previewText } from '../domain/preview-texts';
import {
  fileLink,
  id,
  limit,
  link,
  projectId,
  projectLink,
  type ToolServices,
} from './common';

/** Largest upload through MCP (base64 in a JSON body; the web upload allows 20 MB). */
export const MCP_UPLOAD_MAX_BYTES = 5 * 1024 * 1024;

const fileOut = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.string(),
  status: z.enum(PROJECT_FILE_STATUSES),
  platform: z.string().nullable(),
  mappingId: z.string().nullable(),
  mappingName: z.string().nullable(),
  period: z.object({ from: z.string(), to: z.string() }).nullable(),
  bookings: z.number(),
  holdings: z.number(),
  rowErrors: z.number(),
  origin: z.string(),
  addedAt: z.string(),
  link,
});

function fileOf(file: ProjectFileView) {
  return {
    id: file.id,
    name: file.displayName,
    kind: file.kind,
    status: file.status,
    platform: file.platform,
    mappingId: file.mappingId,
    mappingName: file.mappingName,
    period: file.period,
    bookings: file.bookingCount,
    holdings: file.holdingCount,
    rowErrors: file.errorCount,
    origin: file.origin,
    addedAt: file.addedAt,
    link: fileLink(file.projectId, file.id),
  };
}

const hintOut = z.object({
  key: z.string(),
  kind: z.string(),
  severity: z.string(),
  platform: z.string().nullable(),
  accountId: z.string(),
  date: z.string().nullable(),
  fileId: z.string().nullable(),
  fileName: z.string().nullable(),
  count: z.number().nullable(),
  status: z.enum(HINT_STATUSES),
  note: z.string(),
});

/** Files and hints (F5.1–F5.8). */
export function fileTools(s: ToolServices): AnyTool[] {
  return [
    defineTool({
      name: 'list_files',
      title: 'Dateien auflisten',
      description:
        'The files of a project: status (standard | mapped | needs_mapping | evidence_only), platform, mapping, period, counts of bookings/holdings/row errors, and a link to the file in the app.',
      area: 'files',
      effect: 'readOnly',
      input: z.object({ projectId }),
      output: z.object({ files: z.array(fileOut), link }),
      async run(ctx, input) {
        const overview = await s.files.list(ctx.userId, input.projectId);
        return {
          files: overview.files.map(fileOf),
          link: projectLink(input.projectId, 'files'),
        };
      },
    }),
    defineTool({
      name: 'preview_file',
      title: 'Datei-Vorschau',
      description:
        'The first rows of a CSV/XLSX file as text (header first) — to understand its columns, e.g. before writing a mapping. Keep `rows` small.',
      area: 'files',
      effect: 'readOnly',
      input: z.object({
        projectId,
        fileId: id('project file'),
        rows: limit(10, 30),
      }),
      output: z.object({
        kind: z.enum(['table', 'pdf']),
        sheets: z.array(
          z.object({
            name: z.string(),
            rows: z.array(z.array(z.string())),
            totalRows: z.number(),
          }),
        ),
      }),
      async run(ctx, input) {
        const preview = await s.files.preview(
          ctx.userId,
          input.projectId,
          input.fileId,
          input.rows,
        );
        return preview.kind === 'pdf'
          ? { kind: 'pdf' as const, sheets: [] }
          : {
              kind: 'table' as const,
              sheets: preview.sheets.map((sheet) => ({
                name: sheet.name,
                rows: sheet.rows.map((row) => [...row]),
                totalRows: sheet.totalRows,
              })),
            };
      },
    }),
    defineTool({
      name: 'list_row_errors',
      title: 'Zeilenfehler',
      description:
        'Rows of a file its reader could not read: row number, error code, column (never cell values).',
      area: 'files',
      effect: 'readOnly',
      input: z.object({
        projectId,
        fileId: id('project file'),
        limit: limit(20, 100),
      }),
      output: z.object({
        total: z.number(),
        errors: z.array(
          z.object({
            row: z.number(),
            code: z.string(),
            column: z.string().optional(),
            sheet: z.string().optional(),
          }),
        ),
      }),
      async run(ctx, input) {
        const result = await s.files.rowErrors(
          ctx.userId,
          input.projectId,
          input.fileId,
          input.limit,
        );
        return { total: result.total, errors: [...result.errors] };
      },
    }),
    defineTool({
      name: 'list_hints',
      title: 'Hinweise',
      description:
        'F5.8 hints of a project: missing files (noYearData, startsLate, endsEarly, noYearEndBalance), unrecognised files and row errors, each with a stable key, severity and status (open | done | ignored).',
      area: 'checks',
      effect: 'readOnly',
      input: z.object({ projectId }),
      output: z.object({
        open: z.number(),
        hints: z.array(hintOut),
        link,
      }),
      async run(ctx, input) {
        const hints = await s.files.hints(ctx.userId, input.projectId);
        return {
          open: hints.open,
          hints: hints.hints.map((hint) => ({
            key: hint.key,
            kind: hint.kind,
            severity: hint.severity,
            platform: hint.platform,
            accountId: hint.accountId,
            date: hint.date,
            fileId: hint.fileId,
            fileName: hint.fileName,
            count: hint.count,
            status: hint.status,
            note: hint.note,
          })),
          link: projectLink(input.projectId, 'hints'),
        };
      },
    }),
    defineTool({
      name: 'set_hint_status',
      title: 'Hinweis erledigen',
      description:
        'Marks a hint (by its key from list_hints) as done or ignored, or opens it again, with an optional note.',
      area: 'checks',
      effect: 'write',
      input: z.object({
        projectId,
        key: z.string().min(1).max(600),
        status: z.enum(HINT_STATUSES),
        note: z.string().max(500).default(''),
      }),
      output: z.object({ key: z.string(), status: z.enum(HINT_STATUSES) }),
      async run(ctx, input) {
        await s.files.updateHint(
          ctx.userId,
          input.projectId,
          input.key,
          input.status,
          input.note,
        );
        return { key: input.key, status: input.status };
      },
      async preview(ctx, input) {
        const hints = await s.files.hints(ctx.userId, input.projectId);
        const hint = hints.hints.find((h) => h.key === input.key);
        return {
          summary: previewText('chat.preview.hintStatus', {
            hint: hint?.platform ?? input.key,
            status: enumText('hintStatus', input.status),
          }),
          changes: [
            {
              label: previewText('chat.preview.label.status'),
              before: hint?.status ? enumText('hintStatus', hint.status) : null,
              after: enumText('hintStatus', input.status),
            },
            ...(input.note
              ? [
                  {
                    label: previewText('chat.preview.label.note'),
                    before: hint?.note || null,
                    after: input.note,
                  },
                ]
              : []),
          ],
          projectId: input.projectId,
        };
      },
    }),
    defineTool({
      name: 'assign_file',
      title: 'Datei zuordnen',
      description:
        'How a file is read: "automatic" (standard format or the best matching mapping), "mapping" (a given mapping id) or "evidenceOnly" (kept as a receipt, not read).',
      area: 'files',
      effect: 'write',
      input: z.object({
        projectId,
        fileId: id('project file'),
        mode: z.enum(['automatic', 'mapping', 'evidenceOnly']),
        mappingId: z
          .string()
          .max(64)
          .optional()
          .describe('Required when mode = mapping.'),
      }),
      output: fileOut,
      async run(ctx, input) {
        if (input.mode === 'mapping' && !input.mappingId) {
          throw new ToolError(
            'invalidArguments',
            'mode "mapping" needs a mappingId',
          );
        }
        const file = await s.files.change(
          ctx.userId,
          input.projectId,
          input.fileId,
          input.mode === 'mapping'
            ? { mode: 'mapping', mappingId: input.mappingId ?? '' }
            : { mode: input.mode },
        );
        return fileOf(file);
      },
    }),
    defineTool({
      name: 'remove_file',
      title: 'Datei entfernen',
      description:
        'Removes a file from a project (the stored bytes go when no project uses them any more).',
      area: 'files',
      effect: 'destructive',
      input: z.object({ projectId, fileId: id('project file') }),
      output: z.object({ removed: z.boolean() }),
      async run(ctx, input) {
        await s.files.remove(ctx.userId, input.projectId, input.fileId);
        return { removed: true };
      },
      async preview(ctx, input) {
        const overview = await s.files.list(ctx.userId, input.projectId);
        const file = overview.files.find((f) => f.id === input.fileId);
        return {
          summary: previewText('chat.preview.removeFile', {
            file: file?.displayName ?? input.fileId,
          }),
          changes: [
            {
              label: previewText('chat.preview.label.file'),
              before: file?.displayName ?? input.fileId,
              after: null,
            },
          ],
          projectId: input.projectId,
        };
      },
    }),
    defineTool({
      name: 'upload_file',
      title: 'Datei hochladen',
      description: `Uploads a file (CSV, XLSX or PDF) into a project: base64 bytes, at most ${MCP_UPLOAD_MAX_BYTES / 1024 / 1024} MB. It is recognised like an upload in the app (standard format, a mapping by fingerprint, or needs_mapping).`,
      area: 'files',
      effect: 'write',
      channels: ['mcp'],
      input: z.object({
        projectId,
        name: z.string().trim().min(1).max(200).describe('The file name.'),
        contentBase64: z.string().min(1),
      }),
      output: fileOut,
      async run(ctx, input) {
        const bytes = Buffer.from(input.contentBase64, 'base64');
        if (bytes.length === 0 || bytes.length > MCP_UPLOAD_MAX_BYTES) {
          throw new ToolError(
            'invalidArguments',
            `The file must be 1 byte to ${MCP_UPLOAD_MAX_BYTES} bytes`,
          );
        }
        return fileOf(
          await s.files.upload(
            ctx.userId,
            input.projectId,
            input.name,
            new Uint8Array(bytes),
          ),
        );
      },
    }),
    defineTool({
      name: 'request_file_upload',
      title: 'Datei anfordern',
      description:
        'Shows the user an upload drop zone in the chat that uploads into the given project. Use it when a file is missing (e.g. "Kraken-Kontoauszug Dezember"); say which file in `message`.',
      area: 'ui',
      effect: 'readOnly',
      channels: ['chat'],
      input: z.object({
        projectId,
        message: z
          .string()
          .trim()
          .min(1)
          .max(300)
          .describe('Which file is needed, in German.'),
      }),
      output: z.object({ shown: z.boolean(), projectId: z.string() }),
      async run(ctx, input) {
        await s.projects.get(ctx.userId, input.projectId);
        return { shown: true, projectId: input.projectId };
      },
    }),
  ];
}
