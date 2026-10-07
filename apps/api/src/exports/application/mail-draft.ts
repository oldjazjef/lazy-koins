import type { ExportData } from './export-data';
import { kitOf } from './export-texts';
import {
  isInternalKind,
  type ProjectExportMeta,
} from '../domain/project-export';

export interface MailDraft {
  readonly to: string;
  readonly subject: string;
  readonly body: string;
}

/**
 * F10.6: a mail to the Treuhänder with the two figures, the attachments and the open technical
 * questions — text to copy, nothing is sent. The questions belong here (the Treuhänder answers
 * them), never in a statement for the tax authority. Attachments: the latest statement of each
 * kind; the internal check report is never listed by default (F10.2a). In the user's language.
 */
export function mailDraft(
  data: ExportData,
  exports: readonly ProjectExportMeta[],
): MailDraft {
  const k = kitOf(data);
  const m = k.t.mail;
  const latest = new Map<string, ProjectExportMeta>();
  for (const item of exports)
    if (!isInternalKind(item.kind) && !latest.has(item.kind))
      latest.set(item.kind, item);
  const attachments =
    latest.size > 0
      ? [...latest.values()].map((item) => `- ${item.fileName}`)
      : [m.noStatementYet];
  const questions = data.items
    .filter((item) => !item.done)
    .map(
      (item) =>
        `- ${k.describeItem(item)}${item.note ? ` (${item.note})` : ''}`,
    );
  const lines = [
    m.greeting(data.advisorName),
    '',
    m.intro(data.taxYear, data.canton),
    '',
    `- ${data.rules.labels.wealthTitle}${data.taxYear}: ${data.rules.homeCurrency} ${k.chf(data.result.totals.wealthChf)}`,
    `- ${data.rules.labels.incomeTitle} ${data.taxYear}: ${data.rules.homeCurrency} ${k.chf(data.result.totals.incomeChf)}`,
    '',
    m.attachments,
    ...attachments,
    '',
    m.questions,
    ...(questions.length > 0 ? questions : [m.none]),
    ...m.assumptions,
    '',
    m.closing,
    data.ownerName,
  ];
  return {
    to: data.advisorEmail,
    subject: m.subject(data.taxYear),
    body: lines.join('\n'),
  };
}
