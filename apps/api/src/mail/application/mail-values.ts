import type { ExportData } from '../../exports/application/export-data';
import {
  type ExportKit,
  exportKit,
} from '../../exports/application/export-texts';
import type { Project } from '../../projects/domain/project';
import type { MailValues } from '../domain/mail-template';

/** Today in Swiss time as an ISO date (`2026-10-06`). */
function swissIsoToday(now: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Zurich',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).formatToParts(now);
  const part = (type: string) => parts.find((p) => p.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

/** `06.10.2026` in Swiss time. */
export function swissToday(now: Date): string {
  return exportKit('de-CH').date(swissIsoToday(now));
}

/** An amount with its tax currency (F4.1a: "EUR 12'345.65"); `–` before the first calculation. */
function amount(
  data: ExportData | null,
  value: string | null,
  kit: ExportKit,
): string {
  if (!data || value === null) return kit.chf(null);
  return `${data.rules.homeCurrency} ${kit.chf(value)}`;
}

/**
 * The placeholder values of one project's mail (F11.10): names from the settings, the two
 * figures of the latest calculation (`–` before the first one), the chosen attachments and the
 * open items not ticked off (F8.2) — in the mail's language and the user's formats (F11.2).
 */
export function mailValues(input: {
  readonly project: Project;
  readonly data: ExportData | null;
  readonly ownerName: string;
  readonly advisorName: string;
  readonly attachmentNames: readonly string[];
  readonly now: Date;
  /** Default: German, Swiss formats. */
  readonly kit?: ExportKit;
}): MailValues {
  const { project, data } = input;
  const kit = input.kit ?? exportKit('de-CH');
  const questions = (data?.items ?? [])
    .filter((item) => !item.done)
    .map(
      (item) =>
        `- ${kit.describeItem(item)}${item.note ? ` (${item.note})` : ''}`,
    );
  return {
    name: input.ownerName,
    treuhaender: input.advisorName,
    steuerjahr: String(project.taxYear),
    kanton: project.canton,
    vermoegen: amount(data, data?.result.totals.wealthChf ?? null, kit),
    ertrag: amount(data, data?.result.totals.incomeChf ?? null, kit),
    anhaenge:
      input.attachmentNames.length > 0
        ? input.attachmentNames.map((name) => `- ${name}`).join('\n')
        : kit.t.mail.noAttachments,
    offene_punkte:
      questions.length > 0 ? questions.join('\n') : kit.t.mail.none,
    datum: kit.date(swissIsoToday(input.now)),
    projekt: project.name,
  };
}
