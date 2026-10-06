import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { CalculateProjectCommand } from '../../calculation/application/calculation.handlers';
import type { CalculationService } from '../../calculation/calculation.service';
import { calculationSetup } from '../../calculation/testing/calculation-fixture';
import { SecretBox } from '../../common/crypto/secret-box';
import type { Env } from '../../config/env';
import { ExportDataService } from '../../exports/application/exports.handlers';
import { InMemoryProjectExportRepository } from '../../exports/testing/in-memory-project-export.repository';
import { InMemoryHintStateRepository } from '../../files/testing/in-memory-hint-state.repository';
import { InMemoryProjectSentRepository } from '../../projects/testing/in-memory-project-sent.repository';
import {
  SettingsReader,
  SettingsSecrets,
} from '../../settings/application/settings.handlers';
import { InMemoryUserSettingsRepository } from '../../settings/testing/in-memory-user-settings.repository';
import type { UserRepositoryPort } from '../../users/ports/user.repository.port';
import { MAX_ATTACHMENT_BYTES } from '../domain/mail-log';
import { DEFAULT_MAIL_TEMPLATES } from '../domain/mail-template';
import {
  FakeMailTransport,
  InMemoryMailLogRepository,
  InMemoryMailSettingsRepository,
  InMemoryMailTemplateRepository,
} from '../testing/mail-doubles';
import { MailGate, MailRuntime } from './mail-gate';
import {
  GetMailSettingsHandler,
  GetMailSettingsQuery,
  SaveMailSettingsCommand,
  SaveMailSettingsHandler,
  type SaveMailSettingsInput,
  SendTestMailCommand,
  SendTestMailHandler,
} from './mail-settings.handlers';
import {
  GetMailTemplateHandler,
  GetMailTemplateQuery,
  MailTemplates,
  PreviewMailTemplateHandler,
  PreviewMailTemplateQuery,
  ResetMailTemplateCommand,
  ResetMailTemplateHandler,
  SaveMailTemplateCommand,
  SaveMailTemplateHandler,
} from './mail-template.handlers';
import {
  ComposeMailHandler,
  ComposeMailQuery,
  ListMailLogHandler,
  ListMailLogQuery,
  SendMailCommand,
  SendMailHandler,
  type SendMailInput,
} from './send-mail.handlers';

const PASSWORD = 'Sm7p-Passw0rd';

const MAILER: SaveMailSettingsInput = {
  enabled: true,
  host: 'smtp.example.ch',
  port: 587,
  security: 'starttls',
  username: 'anna@example.ch',
  password: PASSWORD,
  fromName: 'Anna Muster',
  fromAddress: 'anna@example.ch',
};

async function setup(options: { allowPrivate?: boolean; key?: string } = {}) {
  const t = await calculationSetup();
  const settingsRepo = new InMemoryUserSettingsRepository();
  await settingsRepo.save('anna', {
    displayName: 'Anna Muster',
    advisorName: 'Treuhand Beispiel AG',
    advisorEmail: 'treuhand@example.ch',
  });
  const config = { get: () => '' } as unknown as ConfigService<Env, true>;
  const settings = new SettingsReader(
    settingsRepo,
    new SettingsSecrets(config),
  );
  const users = {
    findById: async (id: string) =>
      id === 'anna'
        ? { id, email: 'anna@lazykoins.dev', displayName: 'Anna' }
        : undefined,
  } as unknown as UserRepositoryPort;
  const calculation = {
    calculate: (userId: string, projectId: string) =>
      t.calculate.execute(new CalculateProjectCommand(userId, projectId)),
  } as unknown as CalculationService;
  const exports = new InMemoryProjectExportRepository();
  const data = new ExportDataService(
    t.snapshots,
    t.states,
    settings,
    users,
    t.files,
    t.inputs,
    calculation,
    new InMemoryHintStateRepository(),
  );
  const runtime = new MailRuntime(
    new SecretBox(options.key ?? 'test-encryption-key'),
    options.allowPrivate ?? false,
  );
  const mailSettings = new InMemoryMailSettingsRepository();
  const templateRepo = new InMemoryMailTemplateRepository();
  const transport = new FakeMailTransport();
  const log = new InMemoryMailLogRepository();
  const sent = new InMemoryProjectSentRepository();
  const gate = new MailGate(mailSettings, runtime, transport);
  const templates = new MailTemplates(templateRepo);
  return {
    ...t,
    exports,
    runtime,
    mailSettings,
    templateRepo,
    transport,
    log,
    sent,
    getSettings: new GetMailSettingsHandler(gate, runtime, users),
    saveSettings: new SaveMailSettingsHandler(
      mailSettings,
      gate,
      runtime,
      users,
    ),
    test: new SendTestMailHandler(gate, users),
    getTemplate: new GetMailTemplateHandler(templates),
    saveTemplate: new SaveMailTemplateHandler(templateRepo),
    resetTemplate: new ResetMailTemplateHandler(templateRepo, templates),
    preview: new PreviewMailTemplateHandler(),
    compose: new ComposeMailHandler(
      t.projects,
      exports,
      t.snapshots,
      data,
      settings,
      users,
      gate,
      templates,
    ),
    send: new SendMailHandler(t.projects, exports, users, gate, log, sent),
    listLog: new ListMailLogHandler(t.projects, log),
  };
}

type Setup = Awaited<ReturnType<typeof setup>>;

async function configured(t: Setup) {
  await t.saveSettings.execute(new SaveMailSettingsCommand('anna', MAILER));
}

async function addExport(
  t: Setup,
  kind: string,
  size = 10,
  fileName = `${kind}.bin`,
) {
  return t.exports.create(t.project.id, {
    kind: kind as never,
    fileName,
    bytes: new Uint8Array(size),
    snapshotId: null,
    wealthChf: '1',
    incomeChf: '1',
  });
}

const sendInput = (over: Partial<SendMailInput> = {}): SendMailInput => ({
  to: 'treuhand@example.ch',
  ccMe: true,
  subject: 'Steuern 2025',
  body: 'Guten Tag\n\nAnbei.',
  exportIds: [],
  confirmed: true,
  ...over,
});

async function rejection(promise: Promise<unknown>) {
  return promise.then(
    () => {
      throw new Error('expected a rejection');
    },
    (error: unknown) => error,
  );
}

describe('mailer settings (F11.10)', () => {
  it('seals the password and returns only a hint', async () => {
    const t = await setup();
    const view = await t.saveSettings.execute(
      new SaveMailSettingsCommand('anna', {
        ...MAILER,
        host: ' SMTP.Example.CH ',
      }),
    );
    expect(view).toMatchObject({
      host: 'smtp.example.ch',
      hasPassword: true,
      passwordHint: `…${PASSWORD.slice(-4)}`,
      ready: true,
      testRecipient: 'anna@lazykoins.dev',
    });
    expect(JSON.stringify(view)).not.toContain(PASSWORD);
    const row = t.mailSettings.rows.get('anna');
    expect(row?.passwordCipher).toMatch(/^enc:v1:/);
    expect(row?.passwordCipher).not.toContain(PASSWORD);
    expect(t.runtime.box.open(row?.passwordCipher ?? '')).toBe(PASSWORD);
  });

  it('keeps the password when none is sent and removes it with ""', async () => {
    const t = await setup();
    await configured(t);
    const { password: _p, ...withoutPassword } = MAILER;
    const kept = await t.saveSettings.execute(
      new SaveMailSettingsCommand('anna', { ...withoutPassword, port: 465 }),
    );
    expect(kept).toMatchObject({ hasPassword: true, port: 465 });
    const removed = await t.saveSettings.execute(
      new SaveMailSettingsCommand('anna', { ...MAILER, password: '' }),
    );
    expect(removed).toMatchObject({ hasPassword: false, passwordHint: null });
  });

  it('refuses private hosts on a server, bad hosts and bad senders (422)', async () => {
    const t = await setup({ allowPrivate: false });
    for (const [input, code] of [
      [{ host: '127.0.0.1' }, 'privateHost'],
      [{ host: 'smtp://x.ch' }, 'invalidHost'],
      [{ fromAddress: 'not-an-address' }, 'invalidAddress'],
    ] as const) {
      const error = (await rejection(
        t.saveSettings.execute(
          new SaveMailSettingsCommand('anna', { ...MAILER, ...input }),
        ),
      )) as UnprocessableEntityException;
      expect(error).toBeInstanceOf(UnprocessableEntityException);
      expect(error.getResponse()).toMatchObject({ code });
    }
    const local = await setup({ allowPrivate: true });
    await expect(
      local.saveSettings.execute(
        new SaveMailSettingsCommand('anna', { ...MAILER, host: 'localhost' }),
      ),
    ).resolves.toMatchObject({ host: 'localhost' });
  });

  it('cannot store a password without SETTINGS_ENCRYPTION_KEY', async () => {
    const t = await setup({ key: '' });
    const error = (await rejection(
      t.saveSettings.execute(new SaveMailSettingsCommand('anna', MAILER)),
    )) as UnprocessableEntityException;
    expect(error.getResponse()).toMatchObject({
      code: 'encryptionUnavailable',
    });
    const { password: _p, ...withoutPassword } = MAILER;
    await expect(
      t.saveSettings.execute(
        new SaveMailSettingsCommand('anna', withoutPassword),
      ),
    ).resolves.toMatchObject({ canStorePassword: false, hasPassword: false });
  });

  it('reads defaults before the first save', async () => {
    const t = await setup();
    await expect(
      t.getSettings.execute(new GetMailSettingsQuery('anna')),
    ).resolves.toMatchObject({
      enabled: false,
      port: 587,
      security: 'starttls',
      ready: false,
      hasPassword: false,
    });
  });
});

describe('Test-Mail an mich senden', () => {
  it('sends to my own address with the unsaved form values and a typed password', async () => {
    const t = await setup();
    await configured(t);
    const result = await t.test.execute(
      new SendTestMailCommand('anna', {
        host: 'mail.other.ch',
        port: 465,
        security: 'tls',
        username: 'anna',
        password: 'typed-pw',
        fromName: 'Anna',
        fromAddress: 'anna@other.ch',
      }),
    );
    expect(result).toMatchObject({ ok: true, to: 'anna@lazykoins.dev' });
    const [sent] = t.transport.sent;
    expect(sent?.connection).toEqual({
      host: 'mail.other.ch',
      port: 465,
      security: 'tls',
      username: 'anna',
      password: 'typed-pw',
    });
    expect(sent?.mail.to).toEqual(['anna@lazykoins.dev']);
    expect(sent?.mail.attachments).toEqual([]);
    // Nothing of the draft was stored.
    expect(t.mailSettings.rows.get('anna')?.host).toBe('smtp.example.ch');
  });

  it('uses the saved password when the form leaves it empty', async () => {
    const t = await setup();
    await configured(t);
    await t.test.execute(new SendTestMailCommand('anna'));
    expect(t.transport.sent[0]?.connection.password).toBe(PASSWORD);
  });

  it('turns an SMTP failure into a 502 with redacted details', async () => {
    const t = await setup();
    await configured(t);
    t.transport.failWith = {
      kind: 'auth',
      host: 'smtp.example.ch',
      port: 587,
      smtpCode: 535,
      response: '535 5.7.8 Authentication failed',
      command: 'AUTH PLAIN',
      code: 'EAUTH',
    };
    const error = (await rejection(
      t.test.execute(new SendTestMailCommand('anna')),
    )) as BadGatewayException;
    expect(error).toBeInstanceOf(BadGatewayException);
    expect(error.getResponse()).toMatchObject({
      code: 'smtpFailed',
      smtp: { kind: 'auth', smtpCode: 535, host: 'smtp.example.ch' },
    });
    expect(JSON.stringify(error.getResponse())).not.toContain(PASSWORD);
  });

  it('refuses a private host in the draft on a server (SSRF)', async () => {
    const t = await setup({ allowPrivate: false });
    const error = (await rejection(
      t.test.execute(
        new SendTestMailCommand('anna', {
          host: '169.254.169.254',
          port: 25,
          security: 'none',
          username: '',
          fromName: '',
          fromAddress: 'anna@example.ch',
        }),
      ),
    )) as ConflictException;
    expect(error.getResponse()).toMatchObject({ code: 'privateHost' });
    expect(t.transport.sent).toHaveLength(0);
  });
});

describe('template (F11.10)', () => {
  it('starts with the default and resets to it', async () => {
    const t = await setup();
    const initial = await t.getTemplate.execute(
      new GetMailTemplateQuery('anna', 'de-CH'),
    );
    expect(initial).toMatchObject({
      isDefault: true,
      subject: DEFAULT_MAIL_TEMPLATES['de-CH'].subject,
    });
    expect(initial.preview.unknownPlaceholders).toEqual([]);
    expect(initial.preview.subject).toBe(
      'Steuern 2025: Krypto-Vermögen und Ertrag',
    );

    const saved = await t.saveTemplate.execute(
      new SaveMailTemplateCommand('anna', 'de-CH', {
        subject: ' Unterlagen {{steuerjahr}} ',
        body: 'Hallo {{treuhaender}}\r\n{{anhaenge}}\n',
      }),
    );
    expect(saved).toMatchObject({
      isDefault: false,
      subject: 'Unterlagen {{steuerjahr}}',
      body: 'Hallo {{treuhaender}}\n{{anhaenge}}',
    });
    const reset = await t.resetTemplate.execute(
      new ResetMailTemplateCommand('anna', 'de-CH'),
    );
    expect(reset.isDefault).toBe(true);
  });

  it('refuses unknown placeholders and empty texts', async () => {
    const t = await setup();
    const error = (await rejection(
      t.saveTemplate.execute(
        new SaveMailTemplateCommand('anna', 'de-CH', {
          subject: 'x {{jahr}}',
          body: '{{name}} {{iban}}',
        }),
      ),
    )) as UnprocessableEntityException;
    expect(error.getResponse()).toMatchObject({
      code: 'unknownPlaceholders',
      placeholders: ['jahr', 'iban'],
    });
    await expect(
      t.saveTemplate.execute(
        new SaveMailTemplateCommand('anna', 'de-CH', {
          subject: ' ',
          body: 'x',
        }),
      ),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('previews unsaved text with sample values and flags unknown names', async () => {
    const t = await setup();
    await expect(
      t.preview.execute(
        new PreviewMailTemplateQuery({
          subject: '{{projekt}}',
          body: '{{name}} {{foo}}',
        }),
      ),
    ).resolves.toEqual({
      subject: 'Steuern 2025',
      body: 'Anna Muster {{foo}}',
      unknownPlaceholders: ['foo'],
    });
  });
});

describe('compose (F10.6a)', () => {
  it('renders my template with the project, preselecting the latest statement per kind', async () => {
    const t = await setup();
    await configured(t);
    await t.calculate.execute(
      new CalculateProjectCommand('anna', t.project.id),
    );
    const oldPdf = await addExport(t, 'simple_pdf', 10, 'alt.pdf');
    const pdf = await addExport(
      t,
      'simple_pdf',
      10,
      'Steuern-2025_einfach.pdf',
    );
    const xlsx = await addExport(
      t,
      'detailed_xlsx',
      10,
      'Steuern-2025_ausfuehrlich.xlsx',
    );
    const internal = await addExport(
      t,
      'internal_report_pdf',
      10,
      'intern.pdf',
    );

    const mail = await t.compose.execute(
      new ComposeMailQuery('anna', t.project.id),
    );
    expect(mail).toMatchObject({
      mailerReady: true,
      to: 'treuhand@example.ch',
      ownAddress: 'anna@lazykoins.dev',
      calculated: true,
      unknownPlaceholders: [],
      maxAttachmentBytes: MAX_ATTACHMENT_BYTES,
    });
    const selected = mail.attachments
      .filter((a) => a.selected)
      .map((a) => a.id);
    expect(selected.sort()).toEqual([pdf.id, xlsx.id].sort());
    expect(mail.attachments.find((a) => a.id === internal.id)).toMatchObject({
      internal: true,
      selected: false,
    });
    expect(mail.attachments.find((a) => a.id === oldPdf.id)?.selected).toBe(
      false,
    );
    expect(mail.subject).toBe('Steuern 2025: Krypto-Vermögen und Ertrag');
    expect(mail.body).toContain('Guten Tag Treuhand Beispiel AG');
    expect(mail.body).toContain('Kanton ZH');
    expect(mail.body).toContain('- Steuern-2025_einfach.pdf');
    expect(mail.body).not.toContain('intern.pdf');
    expect(mail.body).toMatch(/Steuerwert per 31\.12\.2025: CHF [\d']+\.\d\d/);
    expect(mail.body.endsWith('Anna Muster')).toBe(true);

    const chosen = await t.compose.execute(
      new ComposeMailQuery('anna', t.project.id, [internal.id]),
    );
    expect(chosen.body).toContain('- intern.pdf');
    expect(chosen.body).not.toContain('Steuern-2025_einfach.pdf');
  });

  it('works before the first calculation and without a mailer (copy + mailto)', async () => {
    const t = await setup();
    const mail = await t.compose.execute(
      new ComposeMailQuery('anna', t.project.id),
    );
    expect(mail).toMatchObject({ mailerReady: false, calculated: false });
    expect(mail.body).toContain('CHF –');
    expect(mail.body).toContain('- (keine Anhänge)');
  });

  it("reads someone else's project as 404", async () => {
    const t = await setup();
    await expect(
      t.compose.execute(new ComposeMailQuery('bruno', t.project.id)),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('send (F10.6a) and the automatic F4.7 mark', () => {
  it('sends with attachments and CC, logs it and marks the project as sent', async () => {
    const t = await setup();
    await configured(t);
    await t.calculate.execute(
      new CalculateProjectCommand('anna', t.project.id),
    );
    const pdf = await addExport(t, 'simple_pdf', 1234, 'a.pdf');
    const xlsx = await addExport(t, 'simple_xlsx', 99, 'a.xlsx');

    const result = await t.send.execute(
      new SendMailCommand(
        'anna',
        t.project.id,
        sendInput({
          subject: 'Steuern 2025\r\nBcc: x@evil.example',
          exportIds: [pdf.id, xlsx.id, pdf.id],
        }),
      ),
    );
    const [sent] = t.transport.sent;
    expect(sent?.mail).toMatchObject({
      from: { name: 'Anna Muster', address: 'anna@example.ch' },
      to: ['treuhand@example.ch'],
      cc: ['anna@lazykoins.dev'],
      subject: 'Steuern 2025 Bcc: x@evil.example',
    });
    expect(
      sent?.mail.attachments.map((a) => [a.fileName, a.contentType]),
    ).toEqual([
      ['a.pdf', 'application/pdf'],
      [
        'a.xlsx',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      ],
    ]);
    expect(sent?.connection.password).toBe(PASSWORD);

    expect(result.log).toMatchObject({
      status: 'sent',
      to: 'treuhand@example.ch',
      cc: 'anna@lazykoins.dev',
      error: null,
      attachments: [
        { exportId: pdf.id, fileName: 'a.pdf', size: 1234 },
        { exportId: xlsx.id, fileName: 'a.xlsx', size: 99 },
      ],
    });
    expect(JSON.stringify(t.log.rows)).not.toContain(PASSWORD);
    expect(result.sent.sent).toMatchObject({
      via: 'mail',
      sentTo: 'treuhand@example.ch',
      exportIds: [pdf.id, xlsx.id],
      mailLogId: result.log.id,
      sentAt: result.log.createdAt,
    });
    expect(result.sent.changes).toEqual([]);

    const log = await t.listLog.execute(
      new ListMailLogQuery('anna', t.project.id),
    );
    expect(log.map((entry) => entry.id)).toEqual([result.log.id]);
  });

  it('logs a failure with a redacted summary, leaves the project unsent and answers 502', async () => {
    const t = await setup();
    await configured(t);
    t.transport.failWith = {
      kind: 'rejected',
      host: 'smtp.example.ch',
      port: 587,
      smtpCode: 552,
      response: '552 5.3.4 Message size exceeds fixed limit',
      command: 'DATA',
      code: 'EMESSAGE',
    };
    const error = await rejection(
      t.send.execute(new SendMailCommand('anna', t.project.id, sendInput())),
    );
    expect(error).toBeInstanceOf(BadGatewayException);
    expect(t.log.rows).toHaveLength(1);
    expect(t.log.rows[0]).toMatchObject({
      status: 'failed',
      error: 'rejected – 552 – 552 5.3.4 Message size exceeds fixed limit',
    });
    expect(t.sent.rows.size).toBe(0);
  });

  it('refuses more than 20 MB of attachments before sending', async () => {
    const t = await setup();
    await configured(t);
    const big = await addExport(t, 'detailed_pdf', MAX_ATTACHMENT_BYTES - 10);
    const more = await addExport(t, 'detailed_xlsx', 11);
    const error = (await rejection(
      t.send.execute(
        new SendMailCommand(
          'anna',
          t.project.id,
          sendInput({ exportIds: [big.id, more.id] }),
        ),
      ),
    )) as UnprocessableEntityException;
    expect(error.getResponse()).toMatchObject({
      code: 'attachmentsTooLarge',
      totalBytes: MAX_ATTACHMENT_BYTES + 1,
    });
    expect(t.transport.sent).toHaveLength(0);
    expect(t.log.rows).toHaveLength(0);
  });

  it('refuses statements of other projects, bad recipients and unconfirmed sends', async () => {
    const t = await setup();
    await configured(t);
    const other = await t.projects.create('anna', {
      name: 'Steuern 2024',
      taxYear: 2024,
      country: 'CH',
      canton: 'ZH',
      notes: '',
    });
    const foreign = await t.exports.create(other.id, {
      kind: 'simple_pdf',
      fileName: 'x.pdf',
      bytes: new Uint8Array(1),
      snapshotId: null,
      wealthChf: '0',
      incomeChf: '0',
    });
    const cases: [Partial<SendMailInput>, string][] = [
      [{ exportIds: [foreign.id] }, 'unknownExport'],
      [{ to: 'a@x.ch, b@y.ch' }, 'invalidAddress'],
      [{ body: '  ' }, 'emptyMail'],
    ];
    for (const [input, code] of cases) {
      const error = (await rejection(
        t.send.execute(
          new SendMailCommand('anna', t.project.id, sendInput(input)),
        ),
      )) as UnprocessableEntityException;
      expect(error.getResponse()).toMatchObject({ code });
    }
    await expect(
      t.send.execute(
        new SendMailCommand(
          'anna',
          t.project.id,
          sendInput({ confirmed: false }),
        ),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(t.transport.sent).toHaveLength(0);
  });

  it('needs a configured, switched-on mailer (409)', async () => {
    const t = await setup();
    const error = (await rejection(
      t.send.execute(new SendMailCommand('anna', t.project.id, sendInput())),
    )) as ConflictException;
    expect(error.getResponse()).toMatchObject({ code: 'mailDisabled' });
    await t.saveSettings.execute(
      new SaveMailSettingsCommand('anna', { ...MAILER, host: '' }),
    );
    const missing = (await rejection(
      t.send.execute(new SendMailCommand('anna', t.project.id, sendInput())),
    )) as ConflictException;
    expect(missing.getResponse()).toMatchObject({ code: 'mailNotConfigured' });
  });

  it('asks for the password again when it cannot be decrypted', async () => {
    const t = await setup();
    await configured(t);
    const row = t.mailSettings.rows.get('anna');
    if (!row) throw new Error('no settings');
    t.mailSettings.rows.set('anna', {
      ...row,
      passwordCipher: new SecretBox('another-key').seal(PASSWORD),
    });
    const error = (await rejection(
      t.send.execute(new SendMailCommand('anna', t.project.id, sendInput())),
    )) as ConflictException;
    expect(error.getResponse()).toMatchObject({ code: 'passwordUnreadable' });
  });

  it('does not CC me twice when I am the recipient', async () => {
    const t = await setup();
    await configured(t);
    await t.send.execute(
      new SendMailCommand(
        'anna',
        t.project.id,
        sendInput({ to: 'anna@lazykoins.dev' }),
      ),
    );
    expect(t.transport.sent[0]?.mail.cc).toEqual([]);
  });
});
