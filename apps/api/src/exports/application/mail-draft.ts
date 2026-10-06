import type { ExportData } from './export-data';
import { chf, describeItem } from './export-texts';
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
 * kind; the internal check report is never listed by default (F10.2a).
 */
export function mailDraft(
  data: ExportData,
  exports: readonly ProjectExportMeta[],
): MailDraft {
  const greeting = data.advisorName
    ? `Guten Tag ${data.advisorName}`
    : 'Guten Tag';
  const latest = new Map<string, ProjectExportMeta>();
  for (const item of exports)
    if (!isInternalKind(item.kind) && !latest.has(item.kind))
      latest.set(item.kind, item);
  const attachments =
    latest.size > 0
      ? [...latest.values()].map((item) => `- ${item.fileName}`)
      : ['- (noch kein Auszug erstellt)'];
  const questions = data.items
    .filter((item) => !item.done)
    .map(
      (item) => `- ${describeItem(item)}${item.note ? ` (${item.note})` : ''}`,
    );
  const lines = [
    `${greeting}`,
    '',
    `Anbei meine Unterlagen zu den Kryptowährungen für das Steuerjahr ${data.taxYear} (Kanton ${data.canton}):`,
    '',
    `- ${data.rules.labels.wealthTitle}${data.taxYear}: CHF ${chf(data.result.totals.wealthChf)}`,
    `- ${data.rules.labels.incomeTitle} ${data.taxYear}: CHF ${chf(data.result.totals.incomeChf)}`,
    '',
    'Anhänge:',
    ...attachments,
    '',
    'Offene Fachfragen (in den Auszügen nicht enthalten):',
    ...(questions.length > 0 ? questions : ['- keine']),
    '- Annahme: Launchpool-/HODLer-Airdrops als Ertrag deklariert (konservativ).',
    '- Annahme: Erträge netto nach Gebühr deklariert.',
    '',
    'Freundliche Grüsse',
    data.ownerName,
  ];
  return {
    to: data.advisorEmail,
    subject: `Steuern ${data.taxYear}: Krypto-Vermögen und Ertrag`,
    body: lines.join('\n'),
  };
}
