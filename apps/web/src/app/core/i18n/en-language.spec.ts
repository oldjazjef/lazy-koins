// @vitest-environment node
// Reads the English message file from disk; no DOM involved.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * F11.2: the English message file contains no German — except the official Swiss terms that have
 * no English equivalent, which stay in parentheses after the English words ("tax advisor
 * (Treuhänder)", "ESTV rate list (Kursliste)"). A leftover German word, an umlaut outside those
 * parentheses or a bare official term fails here.
 */
const EN_FILE = fileURLToPath(
  new URL('../../../../public/i18n/en.json', import.meta.url),
);

/** Official German terms, allowed only inside parentheses. */
const OFFICIAL_TERMS = [
  'Treuhänder',
  'Kursliste',
  'Wertschriftenverzeichnis',
  'Wertschriften- und Guthabenverzeichnis',
  'Verrechnungssteuer',
];

/**
 * Words that are German, not English. Short and common on purpose — together with the umlaut
 * check they catch an untranslated sentence. (`Art`, `Menge` … are standard-format column names
 * and never appear in en.json.)
 */
const GERMAN_WORDS = [
  'und',
  'oder',
  'nicht',
  'der',
  'das',
  'ein',
  'eine',
  'einen',
  'mit',
  'für',
  'auf',
  'ist',
  'sind',
  'wird',
  'werden',
  'bitte',
  'noch',
  'kein',
  'keine',
  'zum',
  'zur',
  'vom',
  'beim',
  'nach',
  'Datei',
  'Dateien',
  'Konto',
  'Buchung',
  'Buchungen',
  'Bestand',
  'Bestände',
  'Kurs',
  'Kurse',
  'Steuer',
  'Steuern',
  'Steuerjahr',
  'Projekt',
  'Projekte',
  'Einstellungen',
  'Hinweis',
  'Hinweise',
  'Fehler',
  'Zeile',
  'Seite',
  'Vorlage',
  'Erklärung',
  'Beleg',
  'Auszug',
  'Abbrechen',
  'Speichern',
  'Löschen',
  'Ausführen',
  'Schlüssel',
];

/** Keys whose text may contain a listed word on purpose (with the reason). */
const ALLOWED: Readonly<Record<string, string>> = {
  // The CSV format of a Kursliste import names its own (German) columns.
  'rates.hint': 'file format asset;kurs_chf;datum',
};

function flatten(
  node: unknown,
  prefix = '',
  out = new Map<string, string>(),
): Map<string, string> {
  if (typeof node === 'string') out.set(prefix, node);
  else if (typeof node === 'object' && node !== null) {
    for (const [key, value] of Object.entries(node)) {
      flatten(value, prefix ? `${prefix}.${key}` : key, out);
    }
  }
  return out;
}

/** The text without its placeholders and without the allowed "(official term)" parentheses. */
function withoutAllowed(text: string): string {
  let out = text.replace(/\{\{[^}]*\}\}/g, ' ');
  for (const term of OFFICIAL_TERMS) {
    out = out.split(`(${term})`).join(' ');
    out = out.split(`(${term},`).join('(');
  }
  return out;
}

const germanWord = new RegExp(
  `(^|[^\\p{L}])(${GERMAN_WORDS.join('|')})(?=$|[^\\p{L}])`,
  'u',
);

/** What looks German in a text (empty = nothing). */
function germanIn(text: string): string[] {
  const rest = withoutAllowed(text);
  const found = new Set<string>();
  const umlaut = rest.match(/\p{L}*[äöüÄÖÜß]\p{L}*/u);
  if (umlaut) found.add(umlaut[0]);
  const word = rest.match(germanWord);
  if (word?.[2]) found.add(word[2]);
  // An official term outside its parentheses: the English words in front of it are missing.
  for (const term of OFFICIAL_TERMS) if (rest.includes(term)) found.add(term);
  return [...found];
}

describe('en.json is English (F11.2)', () => {
  const messages = flatten(JSON.parse(readFileSync(EN_FILE, 'utf8')));

  it('finds the texts it is supposed to check', () => {
    expect(messages.size).toBeGreaterThan(1000);
  });

  it('flags German words and umlauts, but not an official term in parentheses', () => {
    expect(germanIn('Tax advisor (Treuhänder)')).toEqual([]);
    expect(germanIn('ESTV rate list (Kursliste) {{year}}')).toEqual([]);
    expect(germanIn('Kursliste could not be imported')).toEqual(['Kursliste']);
    expect(germanIn('Datei hochladen')).toEqual(['Datei']);
    expect(germanIn('Send to the Treuhänder')).toEqual(['Treuhänder']);
    expect(germanIn('Rows per page')).toEqual([]);
  });

  it('has no German outside the allowed official terms', () => {
    const german = [...messages]
      .filter(([key]) => !(key in ALLOWED))
      .map(([key, text]) => [key, germanIn(text)] as const)
      .filter(([, found]) => found.length > 0)
      .map(([key, found]) => `${key}: ${found.join(', ')}`);
    expect(german).toEqual([]);
  });

  it('keeps the allow-list honest: every allowed key exists', () => {
    expect(Object.keys(ALLOWED).filter((key) => !messages.has(key))).toEqual(
      [],
    );
  });
});
