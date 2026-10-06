/**
 * The text template of the mail to the Treuhänder (F11.10): subject and body with `{{name}}`-style
 * placeholders, rendered by a **logic-less** renderer — no expressions, no loops, no code: a known
 * placeholder is replaced by its value in one pass (a value is never searched for placeholders
 * again), an unknown one stays as typed and is reported. The result is plain text.
 */

/** Languages with a built-in template (F11.2); mirrored by a CHECK in the migration. */
export const MAIL_LANGUAGES = ['de-CH'] as const;
export type MailLanguage = (typeof MAIL_LANGUAGES)[number];

/** Every placeholder there is; the app explains each (`mail.placeholders.<name>`). */
export const MAIL_PLACEHOLDERS = [
  'name',
  'treuhaender',
  'steuerjahr',
  'kanton',
  'vermoegen',
  'ertrag',
  'anhaenge',
  'offene_punkte',
  'datum',
  'projekt',
] as const;
export type MailPlaceholder = (typeof MAIL_PLACEHOLDERS)[number];
export type MailValues = Readonly<Record<MailPlaceholder, string>>;

export const SUBJECT_MAX = 300;
export const BODY_MAX = 20_000;

export interface MailTemplateText {
  readonly subject: string;
  readonly body: string;
}

/**
 * The default per language — the F10.6 mail draft as a template: the two figures, the
 * attachments and the open technical questions with the two standing assumptions.
 */
export const DEFAULT_MAIL_TEMPLATES: Readonly<
  Record<MailLanguage, MailTemplateText>
> = {
  'de-CH': {
    subject: 'Steuern {{steuerjahr}}: Krypto-Vermögen und Ertrag',
    body: [
      'Guten Tag {{treuhaender}}',
      '',
      'Anbei meine Unterlagen zu den Kryptowährungen für das Steuerjahr {{steuerjahr}} (Kanton {{kanton}}):',
      '',
      '- Steuerwert per 31.12.{{steuerjahr}}: CHF {{vermoegen}}',
      '- Ertrag aus beweglichem Vermögen {{steuerjahr}}: CHF {{ertrag}}',
      '',
      'Anhänge:',
      '{{anhaenge}}',
      '',
      'Offene Fachfragen:',
      '{{offene_punkte}}',
      '- Annahme: Launchpool-/HODLer-Airdrops als Ertrag deklariert (konservativ).',
      '- Annahme: Erträge netto nach Gebühr deklariert.',
      '',
      'Freundliche Grüsse',
      '{{name}}',
    ].join('\n'),
  },
};

/** Values for the live preview in the settings — invented, never a user's data. */
export const SAMPLE_MAIL_VALUES: MailValues = {
  name: 'Anna Muster',
  treuhaender: 'Beat Treuhand',
  steuerjahr: '2025',
  kanton: 'ZH',
  vermoegen: "12'345.65",
  ertrag: '234.10',
  anhaenge: [
    '- Steuern-2025_einfach_2026-02-01.pdf',
    '- Steuern-2025_ausfuehrlich_2026-02-01.xlsx',
  ].join('\n'),
  offene_punkte: '- kraken / spot / DOT: negative Earn-Lücke – bitte prüfen',
  datum: '01.02.2026',
  projekt: 'Steuern 2025',
};

const TOKEN = /\{\{\s*([^{}]*?)\s*\}\}/g;

function isPlaceholder(name: string): name is MailPlaceholder {
  return (MAIL_PLACEHOLDERS as readonly string[]).includes(name);
}

/** The placeholders a text uses, split into known and unknown (in order, without repeats). */
export function placeholdersIn(text: string): {
  readonly known: MailPlaceholder[];
  readonly unknown: string[];
} {
  const known = new Set<MailPlaceholder>();
  const unknown = new Set<string>();
  for (const match of text.matchAll(TOKEN)) {
    const name = match[1] ?? '';
    if (isPlaceholder(name)) known.add(name);
    else unknown.add(name);
  }
  return { known: [...known], unknown: [...unknown] };
}

/**
 * A value made safe for plain text: no control characters but newline and tab, line breaks
 * normalised; in a subject (a mail header) no line breaks at all.
 */
export function plainTextValue(value: string, singleLine: boolean): string {
  const text = value
    .replace(/\r\n?/g, '\n')
    // eslint-disable-next-line no-control-regex -- removing control characters is the point
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '');
  return singleLine ? text.replace(/\s*\n\s*/g, ' ').trim() : text;
}

export interface RenderedText {
  readonly text: string;
  /** Placeholders that do not exist — left as typed. */
  readonly unknown: string[];
}

/** One pass over the template: known placeholders → their (escaped) values. */
export function renderTemplate(
  template: string,
  values: MailValues,
  kind: 'subject' | 'body',
): RenderedText {
  const singleLine = kind === 'subject';
  const unknown = new Set<string>();
  const replaced = template.replace(TOKEN, (whole, name: string) => {
    if (!isPlaceholder(name)) {
      unknown.add(name);
      return whole;
    }
    return plainTextValue(values[name], singleLine);
  });
  const text = plainTextValue(replaced, singleLine);
  return {
    text: singleLine
      ? text
      : text
          .split('\n')
          .map((line) => line.replace(/[ \t]+$/, ''))
          .join('\n'),
    unknown: [...unknown],
  };
}

export interface RenderedMail {
  readonly subject: string;
  readonly body: string;
  readonly unknownPlaceholders: string[];
}

export function renderMail(
  template: MailTemplateText,
  values: MailValues,
): RenderedMail {
  const subject = renderTemplate(template.subject, values, 'subject');
  const body = renderTemplate(template.body, values, 'body');
  return {
    subject: subject.text,
    body: body.text,
    unknownPlaceholders: [...new Set([...subject.unknown, ...body.unknown])],
  };
}

/** A user's stored template, or the default of the language. */
export interface MailTemplate extends MailTemplateText {
  readonly language: MailLanguage;
  /** `null` = the built-in default (nothing stored). */
  readonly updatedAt: string | null;
}
