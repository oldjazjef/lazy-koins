import { z } from 'zod';
import {
  EXPORT_KINDS,
  type ProjectExportMeta,
} from '../../exports/domain/project-export';
import { type AnyTool, defineTool } from '../domain/tool';
import { id, link, projectId, projectLink, type ToolServices } from './common';

const exportOut = z.object({
  id: z.string(),
  kind: z.enum(EXPORT_KINDS),
  fileName: z.string(),
  size: z.number(),
  wealthChf: z.string(),
  incomeChf: z.string(),
  /** F4.1a: the project's tax currency (the `…Chf` names are historical). */
  currency: z.string(),
  createdAt: z.string(),
  link,
});

function exportOf(meta: ProjectExportMeta, currency: string) {
  return {
    id: meta.id,
    kind: meta.kind,
    fileName: meta.fileName,
    size: meta.size,
    wealthChf: meta.wealthChf,
    incomeChf: meta.incomeChf,
    currency,
    createdAt: meta.createdAt,
    link: projectLink(meta.projectId, 'exports'),
  };
}

/** Statements and the internal report (F10), the Treuhänder mail (F10.6, F10.6a). */
export function exportTools(s: ToolServices): AnyTool[] {
  const currencyOf = async (userId: string, project: string) =>
    (await s.projects.get(userId, project)).taxCurrency ?? 'CHF';
  return [
    defineTool({
      name: 'list_exports',
      title: 'Exporte',
      description:
        'The stored exports of a project: statements for the tax authority (simple_* / detailed_*, PDF/Excel) and the internal check report (internal_report_*).',
      area: 'exports',
      effect: 'readOnly',
      input: z.object({ projectId }),
      output: z.object({ exports: z.array(exportOut) }),
      async run(ctx, input) {
        const list = await s.exports.list(ctx.userId, input.projectId);
        const currency = await currencyOf(ctx.userId, input.projectId);
        return { exports: list.map((meta) => exportOf(meta, currency)) };
      },
    }),
    defineTool({
      name: 'create_export',
      title: 'Auszug erstellen',
      description:
        'Creates a statement (simple_pdf, simple_xlsx, detailed_pdf, detailed_xlsx) or the internal report (internal_report_pdf/xlsx); recalculates first when the result is stale. Statements contain no open items — mention open items to the user before creating one.',
      area: 'exports',
      effect: 'write',
      input: z.object({ projectId, kind: z.enum(EXPORT_KINDS) }),
      output: exportOut,
      async run(ctx, input) {
        return exportOf(
          await s.exports.create(ctx.userId, input.projectId, input.kind),
          await currencyOf(ctx.userId, input.projectId),
        );
      },
      async preview(ctx, input) {
        const checks = await s.calculation.checks(ctx.userId, input.projectId);
        const open = checks.items.filter((item) => !item.done).length;
        return {
          summary: `Export ${input.kind} erstellen`,
          changes: [
            { label: 'Export', before: null, after: input.kind },
            ...(open > 0
              ? [
                  {
                    label: 'Offene Punkte',
                    before: String(open),
                    after: String(open),
                  },
                ]
              : []),
          ],
          projectId: input.projectId,
        };
      },
    }),
    defineTool({
      name: 'get_mail_draft',
      title: 'Mail an Treuhänder (Entwurf)',
      description:
        'The mail to the Treuhänder as it would be composed now: recipient, subject, body (from the template, with the figures and open questions) and the attachments offered. Nothing is sent.',
      area: 'mail',
      effect: 'readOnly',
      input: z.object({ projectId }),
      output: z.object({
        mailerReady: z.boolean(),
        to: z.string(),
        subject: z.string(),
        body: z.string(),
        attachments: z.array(
          z.object({
            id: z.string(),
            kind: z.string(),
            fileName: z.string(),
            internal: z.boolean(),
            selected: z.boolean(),
          }),
        ),
      }),
      async run(ctx, input) {
        const mail = await s.mail.compose(ctx.userId, input.projectId);
        return {
          mailerReady: mail.mailerReady,
          to: mail.to,
          subject: mail.subject,
          body: mail.body,
          attachments: mail.attachments.map((a) => ({
            id: a.id,
            kind: a.kind,
            fileName: a.fileName,
            internal: a.internal,
            selected: a.selected,
          })),
        };
      },
    }),
    defineTool({
      name: 'send_mail',
      title: 'Mail an Treuhänder senden',
      description:
        'Sends the mail to the Treuhänder through the configured mailer with the given statements attached (export ids from get_mail_draft / list_exports). Irreversible; logged in the project.',
      area: 'mail',
      effect: 'destructive',
      input: z.object({
        projectId,
        to: z.email(),
        ccMe: z.boolean().default(false),
        subject: z.string().trim().min(1).max(300),
        body: z.string().min(1).max(20000),
        exportIds: z.array(id('export')).max(20),
      }),
      output: z.object({
        status: z.string(),
        to: z.string(),
        subject: z.string(),
        error: z.string().nullable(),
      }),
      async run(ctx, input) {
        const result = await s.mail.send(ctx.userId, input.projectId, {
          to: input.to,
          ccMe: input.ccMe,
          subject: input.subject,
          body: input.body,
          exportIds: input.exportIds,
          confirmed: true,
        });
        return {
          status: result.log.status,
          to: result.log.to,
          subject: result.log.subject,
          error: result.log.error,
        };
      },
      async preview(ctx, input) {
        const exports = await s.exports.list(ctx.userId, input.projectId);
        const names = exports
          .filter((e) => input.exportIds.includes(e.id))
          .map((e) => e.fileName);
        return {
          summary: `Mail an ${input.to} senden`,
          changes: [
            { label: 'An', before: null, after: input.to },
            { label: 'Betreff', before: null, after: input.subject },
            {
              label: 'Anhänge',
              before: null,
              after: names.length > 0 ? names.join(', ') : '–',
            },
          ],
          projectId: input.projectId,
        };
      },
    }),
    defineTool({
      name: 'list_mail_log',
      title: 'Versandprotokoll',
      description:
        'Mails sent from a project (date, recipient, subject, status).',
      area: 'mail',
      effect: 'readOnly',
      input: z.object({ projectId }),
      output: z.object({
        mails: z.array(
          z.object({
            to: z.string(),
            subject: z.string(),
            status: z.string(),
            error: z.string().nullable(),
            createdAt: z.string(),
          }),
        ),
      }),
      async run(ctx, input) {
        const log = await s.mail.log(ctx.userId, input.projectId);
        return {
          mails: log.map((entry) => ({
            to: entry.to,
            subject: entry.subject,
            status: entry.status,
            error: entry.error,
            createdAt: entry.createdAt,
          })),
        };
      },
    }),
  ];
}
