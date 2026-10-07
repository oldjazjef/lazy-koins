import { isInternalExportKind } from './mail-log';
import {
  checkSmtpHost,
  isMailAddress,
  mailReady,
  defaultMailSettings,
  ownAddress,
} from './mail-settings';
import {
  DEFAULT_MAIL_TEMPLATES,
  MAIL_PLACEHOLDERS,
  type MailValues,
  placeholdersIn,
  plainTextValue,
  renderMail,
  renderTemplate,
  SAMPLE_MAIL_VALUES,
  SAMPLE_MAIL_VALUES_BY_LANGUAGE,
} from './mail-template';

const values = (over: Partial<MailValues> = {}): MailValues => ({
  ...SAMPLE_MAIL_VALUES,
  ...over,
});

describe('mail template renderer (F11.10)', () => {
  it('replaces every known placeholder, also with spaces inside the braces', () => {
    const text = MAIL_PLACEHOLDERS.map((name) => `{{ ${name} }}`).join('|');
    const rendered = renderTemplate(text, values(), 'body');
    expect(rendered.unknown).toEqual([]);
    expect(rendered.text).toBe(
      MAIL_PLACEHOLDERS.map((name) => SAMPLE_MAIL_VALUES[name]).join('|'),
    );
  });

  it('drops the "CHF" a template from before F4.1a wrote before the amounts', () => {
    const rendered = renderTemplate(
      'Vermögen: CHF {{vermoegen}}, Ertrag: CHF {{ ertrag }}, CHF {{name}}',
      values({ vermoegen: "EUR 1'000.00", ertrag: 'EUR 5.00' }),
      'body',
    );
    expect(rendered.text).toBe(
      "Vermögen: EUR 1'000.00, Ertrag: EUR 5.00, CHF Anna Muster",
    );
  });

  it('leaves unknown placeholders as typed and reports them once', () => {
    const rendered = renderTemplate(
      'Hallo {{vorname}} {{name}} {{vorname}} {{ x.y }}',
      values({ name: 'Anna' }),
      'body',
    );
    expect(rendered.text).toBe('Hallo {{vorname}} Anna {{vorname}} {{ x.y }}');
    expect(rendered.unknown).toEqual(['vorname', 'x.y']);
  });

  it('is one pass: a value that looks like a placeholder is not expanded', () => {
    const rendered = renderTemplate(
      'Gruss {{name}}',
      values({ name: '{{treuhaender}} {{ertrag}}' }),
      'body',
    );
    expect(rendered.text).toBe('Gruss {{treuhaender}} {{ertrag}}');
    expect(rendered.unknown).toEqual([]);
  });

  it('runs no code: expressions and helpers are just unknown names', () => {
    const rendered = renderTemplate(
      '{{constructor}} {{#each x}} {{name.toUpperCase()}} {{__proto__}}',
      values(),
      'body',
    );
    expect(rendered.unknown).toEqual([
      'constructor',
      '#each x',
      'name.toUpperCase()',
      '__proto__',
    ]);
    expect(rendered.text).toContain('{{constructor}}');
  });

  it('escapes values for plain text: control characters out, CRLF normalised', () => {
    const rendered = renderTemplate(
      'A{{name}}B',
      values({ name: 'x\u0000y\u001b[31mz\r\nzwei' }),
      'body',
    );
    expect(rendered.text).toBe('Axy[31mz\nzweiB');
  });

  it('keeps a subject on one line (no header injection)', () => {
    const rendered = renderTemplate(
      'Steuern {{steuerjahr}}',
      values({ steuerjahr: '2025\r\nBcc: evil@example.com' }),
      'subject',
    );
    expect(rendered.text).toBe('Steuern 2025 Bcc: evil@example.com');
    expect(rendered.text).not.toMatch(/[\r\n]/);
    expect(plainTextValue('a\n\nb\r\nc', true)).toBe('a b c');
  });

  it('trims trailing spaces left by an empty value (Guten Tag {{treuhaender}})', () => {
    const rendered = renderTemplate(
      'Guten Tag {{treuhaender}}\nText',
      values({ treuhaender: '' }),
      'body',
    );
    expect(rendered.text).toBe('Guten Tag\nText');
  });

  it('renders the default template without unknown placeholders', () => {
    const mail = renderMail(DEFAULT_MAIL_TEMPLATES['de-CH'], values());
    expect(mail.unknownPlaceholders).toEqual([]);
    expect(mail.subject).toBe('Steuern 2025: Krypto-Vermögen und Ertrag');
    expect(mail.body).toContain("CHF 12'345.65");
    expect(mail.body).toContain('Offene Fachfragen:');
    expect(mail.body).toContain('- Steuern-2025_einfach_2026-02-01.pdf');
    expect(mail.body.endsWith('Anna Muster')).toBe(true);
  });

  it('lists the placeholders a text uses', () => {
    expect(placeholdersIn('{{name}} {{foo}} {{name}} {{datum}}')).toEqual({
      known: ['name', 'datum'],
      unknown: ['foo'],
    });
  });
});

describe('mailer settings', () => {
  it('accepts host names and IPs, refuses URLs and garbage', () => {
    expect(checkSmtpHost('smtp.example.ch', false)).toBeUndefined();
    expect(checkSmtpHost('mail-1.example.co.uk', false)).toBeUndefined();
    expect(checkSmtpHost('203.0.113.7', false)).toBeUndefined();
    for (const bad of [
      'smtp://smtp.example.ch',
      'smtp.example.ch:587',
      'a b',
      'smtp.example.ch/x',
      '-bad.example.ch',
    ]) {
      expect(checkSmtpHost(bad, true)).toBe('invalidHost');
    }
  });

  it('refuses private and loopback hosts unless allowed (SSRF guard)', () => {
    for (const host of [
      'localhost',
      '127.0.0.1',
      '10.0.0.5',
      '192.168.1.10',
      '169.254.169.254',
      'mailhog',
      '[::1]',
    ]) {
      expect(checkSmtpHost(host, false)).toBe('privateHost');
      expect(checkSmtpHost(host, true)).toBeUndefined();
    }
  });

  it('validates one plain address', () => {
    expect(isMailAddress('anna@example.ch')).toBe(true);
    for (const bad of [
      'anna',
      'anna@',
      'Anna <anna@example.ch>',
      'a@example.ch, b@example.ch',
      'a@example.ch\nBcc: x@y.z',
    ]) {
      expect(isMailAddress(bad)).toBe(false);
    }
  });

  it('is ready only when on, with a server and a sender', () => {
    const base = defaultMailSettings('u');
    expect(mailReady(base)).toBe(false);
    expect(mailReady({ ...base, enabled: true, host: 'smtp.example.ch' })).toBe(
      false,
    );
    expect(
      mailReady({
        ...base,
        enabled: true,
        host: 'smtp.example.ch',
        fromAddress: 'anna@example.ch',
      }),
    ).toBe(true);
  });

  it('writes "an mich" to the account, or the sender for the desktop user', () => {
    expect(ownAddress('anna@example.ch', 'from@example.ch')).toBe(
      'anna@example.ch',
    );
    expect(ownAddress('local@lazykoins.local', 'from@example.ch')).toBe(
      'from@example.ch',
    );
  });

  it('treats internal reports as internal', () => {
    expect(isInternalExportKind('internal_report_pdf')).toBe(true);
    expect(isInternalExportKind('internal_report_xlsx')).toBe(true);
    expect(isInternalExportKind('simple_pdf')).toBe(false);
  });
});

describe('default templates per language (F11.10, F11.2)', () => {
  it('has one for every language, with the same placeholders', () => {
    expect(Object.keys(DEFAULT_MAIL_TEMPLATES).sort()).toEqual(['de-CH', 'en']);
    const used = (language: keyof typeof DEFAULT_MAIL_TEMPLATES) => {
      const { subject, body } = DEFAULT_MAIL_TEMPLATES[language];
      return placeholdersIn(`${subject}\n${body}`);
    };
    expect(used('en').unknown).toEqual([]);
    expect(used('en').known.sort()).toEqual(used('de-CH').known.sort());
    const english = renderMail(
      DEFAULT_MAIL_TEMPLATES.en,
      SAMPLE_MAIL_VALUES_BY_LANGUAGE.en,
    );
    expect(english.subject).toBe('Taxes 2025: crypto wealth and income');
    expect(english.body).toContain('Dear Beat Treuhand');
    expect(english.body).toContain('Tax value at 31.12.2025: CHF 12,345.65');
    expect(english.unknownPlaceholders).toEqual([]);
  });
});
