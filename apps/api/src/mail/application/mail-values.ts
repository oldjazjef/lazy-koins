import type { ExportData } from '../../exports/application/export-data';
import { chf, describeItem } from '../../exports/application/export-texts';
import type { Project } from '../../projects/domain/project';
import type { MailValues } from '../domain/mail-template';

/** `06.10.2026` in Swiss time. */
export function swissToday(now: Date): string {
  return new Intl.DateTimeFormat('de-CH', {
    timeZone: 'Europe/Zurich',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(now);
}

/**
 * The placeholder values of one project's mail (F11.10): names from the settings, the two
 * figures of the latest calculation (`–` before the first one), the chosen attachments and the
 * open items not ticked off (F8.2).
 */
export function mailValues(input: {
  readonly project: Project;
  readonly data: ExportData | null;
  readonly ownerName: string;
  readonly advisorName: string;
  readonly attachmentNames: readonly string[];
  readonly now: Date;
}): MailValues {
  const { project, data } = input;
  const questions = (data?.items ?? [])
    .filter((item) => !item.done)
    .map(
      (item) => `- ${describeItem(item)}${item.note ? ` (${item.note})` : ''}`,
    );
  return {
    name: input.ownerName,
    treuhaender: input.advisorName,
    steuerjahr: String(project.taxYear),
    kanton: project.canton,
    vermoegen: chf(data?.result.totals.wealthChf ?? null),
    ertrag: chf(data?.result.totals.incomeChf ?? null),
    anhaenge:
      input.attachmentNames.length > 0
        ? input.attachmentNames.map((name) => `- ${name}`).join('\n')
        : '- (keine Anhänge)',
    offene_punkte: questions.length > 0 ? questions.join('\n') : '- keine',
    datum: swissToday(input.now),
    projekt: project.name,
  };
}
