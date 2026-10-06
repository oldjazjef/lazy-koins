import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { CommandBus } from '@nestjs/cqrs';
import { SecretBox } from '../../common/crypto/secret-box';
import {
  AddDerivedFileCommand,
  AddDerivedFileHandler,
} from '../../files/application/commands/add-derived-file.command';
import {
  ChangeProjectFileCommand,
  ChangeProjectFileHandler,
} from '../../files/application/commands/change-project-file.command';
import {
  UploadProjectFileCommand,
  UploadProjectFileHandler,
} from '../../files/application/commands/upload-project-file.command';
import { FileAnalysisService } from '../../files/application/file-analysis.service';
import { FileViews } from '../../files/application/file-views';
import { PdfTextExtractor } from '../../files/application/pdf-text-extractor';
import { SourceFileReader } from '../../files/application/source-file-reader';
import { InMemoryProjectFileRepository } from '../../files/testing/in-memory-project-file.repository';
import {
  type AiCompletion,
  AiCompletionPort,
  type AiCompletionRequest,
  type AiConnection,
  AiProviderError,
} from '../../integrations/ai/ai-completion.port';
import { sampleFileOf } from '../../mappings/application/sample-file';
import { InMemoryImportMappingRepository } from '../../mappings/testing/in-memory-import-mapping.repository';
import { InMemoryProjectRepository } from '../../projects/testing/in-memory-project.repository';
import { InMemoryAiSettingsRepository } from '../testing/in-memory-ai-settings.repository';
import { STATEMENT_PAGES, syntheticPdf } from '../testing/synthetic-pdf';
import { AiGate, AiRuntime } from './ai-gate';
import { AiSources } from './ai-sources';
import {
  AcceptAiMappingCommand,
  AcceptAiMappingHandler,
  AcceptSampleMappingCommand,
  AcceptSampleMappingHandler,
  GenerateMappingCommand,
  GenerateMappingHandler,
  GenerateSampleMappingCommand,
  GenerateSampleMappingHandler,
  GetMappingPayloadHandler,
  GetMappingPayloadQuery,
  GetSampleMappingPayloadHandler,
  GetSampleMappingPayloadQuery,
} from './mapping.handlers';
import {
  GetAiSettingsHandler,
  GetAiSettingsQuery,
  SaveAiSettingsCommand,
  SaveAiSettingsHandler,
  TestAiConnectionCommand,
  TestAiConnectionHandler,
} from './settings.handlers';
import {
  AcceptStatementCommand,
  AcceptStatementHandler,
  ExtractStatementCommand,
  ExtractStatementHandler,
  GetStatementPayloadHandler,
  GetStatementPayloadQuery,
} from './statement.handlers';

/** The engine's synthetic fixtures — never real data. */
const FIXTURES = resolve(
  __dirname,
  '../../../../../libs/engine/src/mapping/fixtures',
);
const BITFINEX = new Uint8Array(
  readFileSync(resolve(FIXTURES, 'bitfinex-ledger.csv')),
);
const BITFINEX_SPEC = JSON.parse(
  readFileSync(resolve(FIXTURES, 'bitfinex-ledger.mapping.json'), 'utf8'),
) as Record<string, unknown>;

/** A provider double: answers queued in order, records every request. Never touches a network. */
class FakeAi extends AiCompletionPort {
  readonly requests: {
    connection: AiConnection;
    request: AiCompletionRequest;
  }[] = [];
  private readonly answers: (unknown | Error)[] = [];

  answer(...values: unknown[]): this {
    this.answers.push(...values);
    return this;
  }

  async complete(
    connection: AiConnection,
    request: AiCompletionRequest,
  ): Promise<AiCompletion> {
    this.requests.push({ connection, request });
    const next = this.answers.shift();
    if (next instanceof Error) throw next;
    if (next === undefined) throw new Error('FakeAi: no answer queued');
    return {
      json: next,
      text: JSON.stringify(next),
      model: 'fake-model',
      usage: { inputTokens: 100, outputTokens: 20 },
    };
  }
}

async function setup(
  options: { allowPrivate?: boolean; encryptionKey?: string } = {},
) {
  const projects = new InMemoryProjectRepository();
  const files = new InMemoryProjectFileRepository();
  const mappings = new InMemoryImportMappingRepository(files);
  const settings = new InMemoryAiSettingsRepository();
  const reader = new SourceFileReader();
  const analysis = new FileAnalysisService(reader, mappings);
  const views = new FileViews(projects, mappings, files);
  const runtime = new AiRuntime(
    new SecretBox(options.encryptionKey ?? 'unit-test-settings-key'),
    options.allowPrivate ?? true,
  );
  const gate = new AiGate(settings, runtime);
  const sources = new AiSources(files, reader, new PdfTextExtractor());
  const ai = new FakeAi();
  const change = new ChangeProjectFileHandler(
    projects,
    files,
    mappings,
    analysis,
  );
  const derive = new AddDerivedFileHandler(projects, files, analysis);
  const bus = {
    execute: (command: unknown) => {
      if (command instanceof ChangeProjectFileCommand)
        return change.execute(command);
      if (command instanceof AddDerivedFileCommand)
        return derive.execute(command);
      throw new Error('unexpected command');
    },
  } as unknown as CommandBus;
  const project = await projects.create('anna', {
    name: 'Steuern 2025',
    taxYear: 2025,
    country: 'CH',
    canton: 'ZH',
    notes: '',
  });
  const upload = (name: string, bytes: Uint8Array) =>
    new UploadProjectFileHandler(projects, files, analysis).execute(
      new UploadProjectFileCommand('anna', project.id, name, bytes),
    );
  const save = new SaveAiSettingsHandler(settings, gate, runtime);
  return {
    projects,
    files,
    mappings,
    settings,
    ai,
    views,
    project,
    upload,
    getSettings: (user = 'anna') =>
      new GetAiSettingsHandler(gate, runtime).execute(
        new GetAiSettingsQuery(user),
      ),
    save: (input: Partial<SaveAiSettingsCommand['input']> = {}) =>
      save.execute(
        new SaveAiSettingsCommand('anna', {
          enabled: true,
          provider: 'openai_compatible',
          baseUrl: 'http://localhost:11434/v1',
          model: 'llama3.1',
          ...input,
        }),
      ),
    testConnection: (draft?: TestAiConnectionCommand['draft']) =>
      new TestAiConnectionHandler(gate, ai).execute(
        new TestAiConnectionCommand('anna', draft),
      ),
    settings,
    mappingPayload: (fileId: string, user = 'anna') =>
      new GetMappingPayloadHandler(projects, files, gate, sources).execute(
        new GetMappingPayloadQuery(user, project.id, fileId),
      ),
    generate: (fileId: string, consent = true) =>
      new GenerateMappingHandler(
        projects,
        files,
        gate,
        sources,
        analysis,
        ai,
      ).execute(
        new GenerateMappingCommand('anna', project.id, fileId, consent),
      ),
    accept: (fileId: string, spec: unknown) =>
      new AcceptAiMappingHandler(projects, files, mappings, bus).execute(
        new AcceptAiMappingCommand('anna', project.id, fileId, spec),
      ),
    samplePayload: (bytes: Uint8Array) =>
      new GetSampleMappingPayloadHandler(gate, sources).execute(
        new GetSampleMappingPayloadQuery(
          'anna',
          sampleFileOf('bitfinex.csv', bytes),
        ),
      ),
    generateSample: (bytes: Uint8Array, consent = true) =>
      new GenerateSampleMappingHandler(gate, sources, analysis, ai).execute(
        new GenerateSampleMappingCommand(
          'anna',
          sampleFileOf('bitfinex.csv', bytes),
          consent,
        ),
      ),
    acceptSample: (spec: unknown) =>
      new AcceptSampleMappingHandler(mappings).execute(
        new AcceptSampleMappingCommand('anna', spec),
      ),
    statementPayload: (fileId: string) =>
      new GetStatementPayloadHandler(projects, files, gate, sources).execute(
        new GetStatementPayloadQuery('anna', project.id, fileId),
      ),
    extract: (fileId: string, consent = true) =>
      new ExtractStatementHandler(projects, files, gate, sources, ai).execute(
        new ExtractStatementCommand('anna', project.id, fileId, consent),
      ),
    acceptStatement: (
      fileId: string,
      holdings: AcceptStatementCommand['holdings'],
    ) =>
      new AcceptStatementHandler(projects, files, sources, bus).execute(
        new AcceptStatementCommand('anna', project.id, fileId, holdings),
      ),
  };
}

const codeOf = (error: unknown) =>
  (
    (error as { getResponse?: () => unknown }).getResponse?.() as {
      code?: string;
    }
  )?.code;

describe('AI settings (F5.13)', () => {
  it('starts switched off and never returns the key', async () => {
    const t = await setup();
    expect(await t.getSettings()).toMatchObject({
      enabled: false,
      ready: false,
      hasApiKey: false,
      canStoreKey: true,
    });
    const saved = await t.save({
      provider: 'anthropic',
      baseUrl: '',
      model: '',
      apiKey: 'sk-ant-secret-9876',
    });
    expect(saved).toMatchObject({
      ready: true,
      hasApiKey: true,
      apiKeyHint: '…9876',
    });
    expect(JSON.stringify(saved)).not.toContain('secret');
    const row = t.settings.rows.get('anna');
    expect(row?.apiKeyCipher?.startsWith('enc:v1:')).toBe(true);
    expect(row?.apiKeyCipher).not.toContain('sk-ant');
  });

  it('keeps the key when none is sent and removes it with ""', async () => {
    const t = await setup();
    await t.save({ apiKey: 'sk-one-1111' });
    expect((await t.save({ model: 'other' })).apiKeyHint).toBe('…1111');
    expect(await t.save({ apiKey: '' })).toMatchObject({
      hasApiKey: false,
      apiKeyHint: null,
    });
  });

  it('refuses a key without SETTINGS_ENCRYPTION_KEY, a private URL where not allowed', async () => {
    const noKey = await setup({ encryptionKey: '' });
    const error = await noKey.save({ apiKey: 'sk-x' }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UnprocessableEntityException);
    expect(codeOf(error)).toBe('encryptionUnavailable');
    // A local model without a key still works.
    expect((await noKey.save()).ready).toBe(true);

    const server = await setup({ allowPrivate: false });
    expect(codeOf(await server.save().catch((e: unknown) => e))).toBe(
      'privateUrl',
    );
  });

  it('tests the connection without user data', async () => {
    const t = await setup();
    await t.save();
    t.ai.answer({ ok: true });
    expect(await t.testConnection()).toMatchObject({
      ok: true,
      model: 'fake-model',
    });
    expect(t.ai.requests[0]?.request.messages).toEqual([
      { role: 'user', content: 'Connection test.' },
    ]);
  });

  it('tests the unsaved form values without saving them, typed key included', async () => {
    const t = await setup();
    t.ai.answer({ ok: true });
    await t.testConnection({
      provider: 'anthropic',
      baseUrl: '',
      model: 'claude-sonnet-5-5',
      apiKey: 'sk-typed-only',
    });
    expect(t.ai.requests[0]?.connection).toEqual({
      kind: 'anthropic',
      baseUrl: '',
      model: 'claude-sonnet-5-5',
      apiKey: 'sk-typed-only',
    });
    expect(await t.settings.find('anna')).toBeUndefined();
  });

  it('answers a failed test with the precise, redacted details (502)', async () => {
    const t = await setup();
    t.ai.answer(
      new AiProviderError('invalidKey', {
        status: 401,
        url: 'https://api.example.com/v1/chat/completions',
        providerMessage:
          'Incorrect API key provided: sk-typed-only-abcdef. Bearer sk-typed-only-abcdef',
        providerType: 'invalid_request_error',
        providerCode: 'invalid_api_key',
      }),
    );
    const error = await t
      .testConnection({
        provider: 'openai_compatible',
        baseUrl: 'https://api.example.com/v1',
        model: 'gpt-x',
        apiKey: 'sk-typed-only-abcdef',
      })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BadGatewayException);
    const body = (error as BadGatewayException).getResponse();
    expect(body).toMatchObject({
      statusCode: 502,
      code: 'invalidKey',
      status: 401,
      url: 'https://api.example.com/v1/chat/completions',
      model: 'gpt-x',
      providerType: 'invalid_request_error',
      providerCode: 'invalid_api_key',
    });
    expect((body as { providerMessage: string }).providerMessage).toContain(
      'Incorrect API key provided',
    );
    expect((body as { detail: string }).detail).toContain('HTTP 401');
    expect(JSON.stringify(body)).not.toContain('typed-only');
  });

  it('says what is missing when the plugin is not ready (409 detail)', async () => {
    const t = await setup();
    const notReady = await t
      .testConnection({ provider: 'anthropic', baseUrl: '', model: '' })
      .catch((e: unknown) => e);
    expect(codeOf(notReady)).toBe('aiNotConfigured');
    expect(
      (
        (notReady as ConflictException).getResponse() as {
          detail?: string;
        }
      ).detail,
    ).toContain('API key');
  });

  it('tests while the plugin is switched off (nothing of the user is sent)', async () => {
    const t = await setup();
    await t.save({ enabled: false });
    t.ai.answer({ ok: true });
    expect(await t.testConnection()).toMatchObject({ ok: true });
  });
});

describe('AI mapping from the editor sample file (F5.13, F5.14)', () => {
  it('previews and sends the same payload, only with consent, and stores nothing', async () => {
    const t = await setup();
    await t.save();
    const preview = await t.samplePayload(BITFINEX);
    expect(preview.consentGiven).toBe(false);
    expect(preview.payload.fileName).toBe('bitfinex.csv');

    const refused = await t
      .generateSample(BITFINEX, false)
      .catch((e: unknown) => e);
    expect(codeOf(refused)).toBe('consentRequired');
    expect(t.ai.requests).toHaveLength(0);

    t.ai.answer(BITFINEX_SPEC);
    const candidate = await t.generateSample(BITFINEX, true);
    expect(t.ai.requests[0]?.request.messages[0]?.content).toContain(
      JSON.stringify(preview.payload),
    );
    expect(candidate.valid).toBe(true);
    expect(candidate.preview?.totals.bookings).toBeGreaterThan(0);
    expect(t.files.stored.size).toBe(0);
    expect(t.mappings.rows.size).toBe(0);

    // The reviewed proposal is saved as an AI mapping; an invalid one is refused with its issues.
    const saved = await t.acceptSample(candidate.spec);
    expect(saved).toMatchObject({ origin: 'ai', platform: 'bitfinex' });
    const invalid = await t
      .acceptSample({ format: 'x' })
      .catch((e: unknown) => e);
    expect(invalid).toBeInstanceOf(BadRequestException);
    expect(t.mappings.rows.size).toBe(1);
  });

  it('refuses while the plugin is off', async () => {
    const t = await setup();
    const error = await t.samplePayload(BITFINEX).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConflictException);
    expect(codeOf(error)).toBe('aiDisabled');
  });
});

describe('AI mapping (F5.13, F5.14)', () => {
  it('refuses while the plugin is off or not configured', async () => {
    const t = await setup();
    const file = await t.upload('bitfinex.csv', BITFINEX);
    expect(codeOf(await t.generate(file.id).catch((e: unknown) => e))).toBe(
      'aiDisabled',
    );
    await t.save({ baseUrl: '', apiKey: undefined });
    const error = await t.mappingPayload(file.id).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConflictException);
    expect(codeOf(error)).toBe('aiNotConfigured');
    expect(t.ai.requests).toHaveLength(0);
  });

  it('sends exactly the previewed payload, and only after consent', async () => {
    const t = await setup();
    await t.save();
    const file = await t.upload('bitfinex.csv', BITFINEX);
    expect(file.status).toBe('needs_mapping');

    const preview = await t.mappingPayload(file.id);
    expect(preview).toMatchObject({ consentGiven: false, model: 'llama3.1' });
    expect(preview.payload.rows[0]).toEqual([
      '#',
      'DESCRIPTION',
      'CURRENCY',
      'AMOUNT',
      'BALANCE',
      'DATE',
      'WALLET',
    ]);

    const refused = await t.generate(file.id, false).catch((e: unknown) => e);
    expect(codeOf(refused)).toBe('consentRequired');
    expect(t.ai.requests).toHaveLength(0);

    t.ai.answer(BITFINEX_SPEC);
    const candidate = await t.generate(file.id, true);
    expect(t.settings.rows.get('anna')?.consentAt).toBeTruthy();
    const sent = t.ai.requests[0]?.request;
    expect(sent?.messages[0]?.content).toContain(
      JSON.stringify(preview.payload),
    );
    expect(sent?.system).toContain('income_staking');
    expect(sent?.output.schema).toMatchObject({ type: 'object' });
    expect(candidate).toMatchObject({
      valid: true,
      rounds: 1,
      problems: [],
      model: 'fake-model',
      usage: { inputTokens: 100, outputTokens: 20 },
      kindCounts: { income_staking: 1, trade: 2, fee: 2, unknown: 1 },
    });
    expect(candidate.preview?.totals.bookings).toBe(9);

    // Consent is stored: the next request needs no tick (but still shows the payload).
    t.ai.answer(BITFINEX_SPEC);
    await expect(t.generate(file.id, false)).resolves.toMatchObject({
      valid: true,
    });
  });

  it('sends ONE repair round with the concrete problems', async () => {
    const t = await setup();
    await t.save();
    const file = await t.upload('bitfinex.csv', BITFINEX);
    const noRules = structuredClone(BITFINEX_SPEC) as {
      bookings: { kind: { rules: unknown[] } };
    };
    noRules.bookings.kind.rules = [];
    t.ai.answer(noRules, BITFINEX_SPEC);
    const candidate = await t.generate(file.id);
    expect(candidate.rounds).toBe(2);
    expect(candidate.problems).toEqual([]);
    expect(candidate.usage).toEqual({ inputTokens: 200, outputTokens: 40 });
    const repair = t.ai.requests[1]?.request.messages;
    expect(repair).toHaveLength(3);
    expect(repair?.[1]?.role).toBe('assistant');
    expect(repair?.[2]?.content).toContain(
      '9 of 9 bookings got kind "unknown"',
    );
    expect(repair?.[2]?.content).toContain(
      'Staking reward 0.12 DOT on wallet exchange',
    );
  });

  it('returns an invalid spec with its issues after the repair round failed too', async () => {
    const t = await setup();
    await t.save();
    const file = await t.upload('bitfinex.csv', BITFINEX);
    t.ai.answer({ format: 'nope' }, { format: 'still nope' });
    const candidate = await t.generate(file.id);
    expect(candidate).toMatchObject({ valid: false, preview: null, rounds: 2 });
    expect(candidate.issues.length).toBeGreaterThan(0);
    expect(t.ai.requests[1]?.request.messages[2]?.content).toContain(
      'Schema validation errors',
    );
  });

  it('maps a provider failure to 502 with its code', async () => {
    const t = await setup();
    await t.save();
    const file = await t.upload('bitfinex.csv', BITFINEX);
    t.ai.answer(new AiProviderError('rateLimited', { status: 429 }));
    const error = await t.generate(file.id).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BadGatewayException);
    expect(codeOf(error)).toBe('rateLimited');
  });

  it('saves the reviewed spec with origin ai; the next file with that layout needs no AI', async () => {
    const t = await setup();
    await t.save();
    const file = await t.upload('bitfinex.csv', BITFINEX);
    const { mapping, file: read } = await t.accept(file.id, BITFINEX_SPEC);
    expect(mapping.origin).toBe('ai');
    expect(read).toMatchObject({
      status: 'mapped',
      mappingId: mapping.id,
      bookingCount: 9,
    });

    // Same columns, other rows (a later export): recognised by its fingerprint on upload.
    const later = new TextEncoder().encode(
      '#,DESCRIPTION,CURRENCY,AMOUNT,BALANCE,DATE,WALLET\n' +
        '2001,Staking reward 0.2 DOT on wallet exchange,DOT,0.20000000,0.32000000,01-03-2025 00:00:00,exchange\n',
    );
    const second = await t.upload('bitfinex-march.csv', later);
    expect(second).toMatchObject({ status: 'mapped', mappingId: mapping.id });
    expect(t.ai.requests).toHaveLength(0);
  });

  it('refuses to save into a closed project', async () => {
    const t = await setup();
    const file = await t.upload('bitfinex.csv', BITFINEX);
    await t.projects.update(t.project.id, { status: 'closed' });
    await expect(t.accept(file.id, BITFINEX_SPEC)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});

describe('AI statement reading (PDF → Bestände)', () => {
  const holdings = [
    {
      asset: 'BTC',
      quantityAsPrinted: '0.123456789012345678',
      asOf: '2025-12-31',
      platform: 'synthetic',
      priceUsdAsPrinted: '97,123.45',
      page: 1,
    },
    {
      asset: 'DOT',
      quantityAsPrinted: '42.0',
      asOf: '2025-12-31',
      platform: 'synthetic',
      page: 2,
    },
  ];

  it('previews the page text, extracts, flags, and stores a derived standard CSV', async () => {
    const t = await setup();
    await t.save();
    const pdf = await t.upload(
      'statement.pdf',
      await syntheticPdf(STATEMENT_PAGES),
    );
    expect(pdf.status).toBe('evidence_only');

    const preview = await t.statementPayload(pdf.id);
    expect(preview.payload).toMatchObject({
      fileName: 'statement.pdf',
      pageCount: 2,
      truncated: false,
    });
    expect(preview.payload.pages[0]?.text).toContain('0.123456789012345678');

    // First answer breaks the schema → one repair round.
    t.ai.answer({ holdings: [{ asset: 'BTC' }] }, { holdings });
    const candidate = await t.extract(pdf.id);
    expect(candidate.rounds).toBe(2);
    expect(t.ai.requests[0]?.request.messages[0]?.content).toContain(
      JSON.stringify(preview.payload),
    );
    expect(
      candidate.holdings.map((h) => [h.asset, h.quantity, h.verbatim]),
    ).toEqual([
      ['BTC', '0.123456789012345678', true],
      ['DOT', '42.0', false],
    ]);

    const derived = await t.acceptStatement(pdf.id, holdings);
    expect(derived).toMatchObject({
      status: 'standard',
      holdingCount: 2,
      displayName: 'statement.bestaende.csv',
      origin: `derived_from:${pdf.id}`,
    });
    const view = await t.views.one('anna', derived);
    expect(view.derivedFromName).toBe('statement.pdf');
    // The PDF stays, unchanged, as evidence.
    expect((await t.files.findById(pdf.id))?.status).toBe('evidence_only');
  });

  it('refuses a text-less PDF and a non-PDF', async () => {
    const t = await setup();
    await t.save();
    const blank = await t.upload('scan.pdf', await syntheticPdf([[]]));
    expect(
      codeOf(await t.statementPayload(blank.id).catch((e: unknown) => e)),
    ).toBe('noText');
    const csv = await t.upload('bitfinex.csv', BITFINEX);
    await expect(t.statementPayload(csv.id)).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
  });
});
