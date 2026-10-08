import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import type { CommandBus } from '@nestjs/cqrs';
import { validateMappingSpec } from '@lazykoins/engine';
import type { AiGate } from '../../ai/application/ai-gate';
import { InMemoryUserRateRepository } from '../../carryover/testing/in-memory-carryover.repositories';
import { calculationSetup } from '../../calculation/testing/calculation-fixture';
import { DashboardInputService } from '../../dashboard/application/dashboard-input.service';
import { FileAnalysisService } from '../../files/application/file-analysis.service';
import {
  UploadMyFileCommand,
  UploadMyFileHandler,
} from '../../files/application/my-files.handlers';
import { SourceFileReader } from '../../files/application/source-file-reader';
import type {
  AiCompletion,
  AiCompletionPort,
  AiCompletionRequest,
} from '../../integrations/ai/ai-completion.port';
import {
  UpdateMappingCommand,
  UpdateMappingHandler,
} from '../../mappings/application/commands/mapping.commands';
import { TransactionLedgerService } from './transaction-ledger.service';
import {
  AddKindRuleCommand,
  AddKindRuleHandler,
  DecideSuggestionsCommand,
  DecideSuggestionsHandler,
  EditTransactionsCommand,
  EditTransactionsHandler,
  GetTransactionHandler,
  GetTransactionQuery,
  ListUserTransactionsHandler,
  ListUserTransactionsQuery,
  SetTransactionEditUndoneCommand,
  SetTransactionEditUndoneHandler,
  SuggestTransactionsCommand,
  SuggestTransactionsHandler,
  TransactionAiPayloadHandler,
  TransactionAiPayloadQuery,
} from './transactions.handlers';

/** The engine's synthetic fixtures — never real data (CLAUDE.md, Private data). */
const ENGINE = resolve(__dirname, '../../../../../libs/engine/src');
const KRAKEN = new Uint8Array(
  readFileSync(resolve(ENGINE, 'mapping/fixtures/kraken-ledger-2024.csv')),
);
const KRAKEN_SPEC: unknown = JSON.parse(
  readFileSync(
    resolve(ENGINE, 'mapping/fixtures/kraken-ledger.mapping.json'),
    'utf8',
  ),
);

class ScriptedAi {
  readonly requests: AiCompletionRequest[] = [];
  constructor(
    private readonly answer: (request: AiCompletionRequest) => unknown,
  ) {}

  async complete(
    _connection: unknown,
    request: AiCompletionRequest,
  ): Promise<AiCompletion> {
    this.requests.push(request);
    const json = this.answer(request);
    return { json, text: JSON.stringify(json), model: 'fake' };
  }
}

async function setup(answer: (r: AiCompletionRequest) => unknown = () => ({})) {
  const t = await calculationSetup();
  const dashboard = new DashboardInputService(
    t.projects,
    t.files,
    t.mappings,
    t.rates,
    t.corrections,
    new InMemoryUserRateRepository(),
    t.inputs,
    t.userSettings,
    t.transactionEdits,
    t.market,
  );
  const ledger = new TransactionLedgerService(
    t.files,
    t.mappings,
    t.projects,
    t.inputs,
    dashboard,
    t.transactionEdits,
  );
  const ai = new ScriptedAi(answer);
  const gate = {
    connect: async () => ({
      kind: 'openai_compatible',
      baseUrl: 'https://ai.example',
      model: 'fake',
    }),
    call: <T>(work: () => Promise<T>) => work(),
  } as unknown as AiGate;
  const commands = {
    execute: (command: unknown) =>
      new UpdateMappingHandler(t.mappings, t.files).execute(
        command as UpdateMappingCommand,
      ),
  } as unknown as CommandBus;
  const list = (
    filter: ConstructorParameters<typeof ListUserTransactionsQuery>[1] = {},
  ) =>
    new ListUserTransactionsHandler(ledger).execute(
      new ListUserTransactionsQuery('anna', filter),
    );
  return {
    ...t,
    ai,
    list,
    detail: (key: string, user = 'anna') =>
      new GetTransactionHandler(ledger).execute(
        new GetTransactionQuery(user, key),
      ),
    edit: (keys: string[], changes: unknown, reason: unknown, user = 'anna') =>
      new EditTransactionsHandler(ledger, t.transactionEdits).execute(
        new EditTransactionsCommand(user, keys, changes, reason),
      ),
    undo: (editId: string, undone: boolean, user = 'anna') =>
      new SetTransactionEditUndoneHandler(ledger, t.transactionEdits).execute(
        new SetTransactionEditUndoneCommand(user, editId, undone),
      ),
    payload: (keys: string[]) =>
      new TransactionAiPayloadHandler(ledger).execute(
        new TransactionAiPayloadQuery('anna', keys),
      ),
    suggest: (keys: string[]) =>
      new SuggestTransactionsHandler(
        ledger,
        t.transactionEdits,
        gate,
        ai as unknown as AiCompletionPort,
      ).execute(new SuggestTransactionsCommand('anna', keys, true)),
    decide: (ids: string[], accept: boolean) =>
      new DecideSuggestionsHandler(ledger, t.transactionEdits).execute(
        new DecideSuggestionsCommand('anna', ids, accept),
      ),
    kindRule: (key: string) =>
      new AddKindRuleHandler(ledger, t.mappings, commands).execute(
        new AddKindRuleCommand('anna', key, 'income_staking'),
      ),
    uploadMine: (name: string, bytes: Uint8Array) =>
      new UploadMyFileHandler(
        t.files,
        t.projects,
        t.mappings,
        new FileAnalysisService(new SourceFileReader(), t.mappings),
      ).execute(new UploadMyFileCommand('anna', name, bytes)),
  };
}

describe('global transactions (F9.5–F9.10)', () => {
  it('lists every transaction of my files with key, source, projects and value', async () => {
    const t = await setup();
    const page = await t.list();
    expect(page.total).toBe(5);
    expect(page.currency).toBe('CHF');
    const staking = page.rows.find((r) => r.kind === 'income_staking');
    expect(staking).toMatchObject({
      key: `${t.bookingsFile.sha256}::5`,
      status: 'original',
      source: { fileName: 'buchungen.csv', row: 5, walletId: null },
      projects: [expect.objectContaining({ name: 'Steuern 2025' })],
      lockedBy: [],
      // 2 DOT × 5 USD × 0.9 USD/CHF (the record's own USD price).
      value: '9.00',
    });
    expect(page.platforms).toEqual(['kraken']);
    expect((await t.list({ review: true })).rows.map((r) => r.asset)).toEqual([
      'ETH',
    ]);
    expect((await t.list({ q: 'dot' })).total).toBe(1);
    expect((await t.list({ from: '2025-03-02' })).total).toBe(1);
  });

  it('also lists a file of mine that is in no project (F5.21)', async () => {
    const t = await setup();
    await t.mappings.create('anna', {
      spec: validateMappingSpec(KRAKEN_SPEC).spec as never,
      origin: 'manual',
    });
    await t.uploadMine('kraken.csv', KRAKEN);
    const page = await t.list({ platform: 'kraken', limit: 200 });
    const fromKraken = page.rows.filter(
      (r) => r.source.fileName === 'kraken.csv',
    );
    expect(fromKraken.length).toBeGreaterThan(0);
    expect(fromKraken[0]?.projects).toEqual([]);
  });

  it('edits several at once with a reason — globally, undoable (F9.8, F9.4)', async () => {
    const t = await setup();
    const keys = (await t.list()).rows
      .filter((r) => r.asset === 'ETH' || r.asset === 'DOT')
      .map((r) => r.key);
    await expect(t.edit(keys, { kind: 'gift' }, 'x')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(
      t.edit(keys, { kind: 'transfer' }, '  '),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      t.edit(['nope:1'], { kind: 'transfer' }, 'x'),
    ).rejects.toBeInstanceOf(NotFoundException);

    const result = await t.edit(keys, { kind: 'transfer' }, 'Umbuchung');
    expect(result).toEqual({ edited: 2, projectIds: [t.project.id] });
    const changed = await t.list({ changed: true });
    expect(changed.rows.map((r) => [r.kind, r.originalKind])).toEqual([
      ['transfer', 'unknown'],
      ['transfer', 'income_staking'],
    ]);
    const detail = await t.detail(keys[0] as string);
    expect(detail.history).toEqual([
      expect.objectContaining({ reason: 'Umbuchung', status: 'active' }),
    ]);
    expect(detail.raw).toMatchObject({ Asset: expect.any(String) });

    await t.undo(detail.history[0]?.id as string, true);
    expect((await t.list({ changed: true })).total).toBe(1);
    await expect(
      t.undo(detail.history[0]?.id as string, true),
    ).rejects.toBeInstanceOf(ConflictException);
    await t.undo(detail.history[0]?.id as string, false);
    expect((await t.list({ changed: true })).total).toBe(2);
    // Another user cannot see or undo it.
    await expect(
      t.undo(detail.history[0]?.id as string, true, 'bob'),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(t.detail(keys[0] as string, 'bob')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('hides and links: a hidden one stays listed, a link makes both transfers', async () => {
    const t = await setup();
    const rows = (await t.list()).rows;
    const deposit = rows.find((r) => r.kind === 'deposit');
    const eth = rows.find((r) => r.asset === 'ETH');
    await t.edit([eth?.key as string], { hidden: true }, 'Doppelt');
    const hidden = (await t.list()).rows.find((r) => r.key === eth?.key);
    expect(hidden).toMatchObject({ hidden: true, status: 'changed' });
    await expect(
      t.edit(
        [deposit?.key as string, eth?.key as string],
        { linkedKey: eth?.key },
        'x',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    await t.edit(
      [deposit?.key as string],
      { linkedKey: eth?.key },
      'Eigenes Konto',
    );
    const linked = (await t.list()).rows.find((r) => r.key === deposit?.key);
    expect(linked).toMatchObject({ kind: 'transfer', linkedKey: eth?.key });
  });

  it('locks transactions a closed project uses (F9.9)', async () => {
    const t = await setup();
    const [first] = (await t.list()).rows;
    const edited = await t.edit([first?.key as string], { note: 'n' }, 'x');
    expect(edited.edited).toBe(1);
    await t.projects.update(t.project.id, { status: 'closed' });
    expect((await t.list()).rows[0]?.lockedBy).toEqual([
      expect.objectContaining({ name: 'Steuern 2025' }),
    ]);
    await expect(
      t.edit([first?.key as string], { kind: 'spam' }, 'x'),
    ).rejects.toMatchObject({
      response: {
        code: 'transactionLocked',
        projects: [expect.objectContaining({ name: 'Steuern 2025' })],
      },
    });
    const [edit] = await t.transactionEdits.listByOwner('anna');
    await expect(t.undo(edit?.id as string, true)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('shows exactly what the AI gets, stores its suggestions, accepts them as edits (F9.10)', async () => {
    const t = await setup((request) => {
      const message = request.messages.at(-1)?.content ?? '';
      expect(message).not.toContain('buchungen.csv');
      return {
        suggestions: [
          {
            ref: 't1',
            kind: 'income_airdrop',
            confidence: 70,
            reason: 'Unsolicited arrival',
          },
          { ref: 'nope', kind: 'spam', confidence: 1, reason: 'ignored' },
        ],
      };
    });
    const preview = await t.payload([]);
    expect(preview.count).toBe(1);
    expect(preview.payload.transactions[0]).toMatchObject({
      ref: 't1',
      asset: 'ETH',
      kind: 'unknown',
    });
    expect(JSON.stringify(preview.payload)).not.toContain(
      t.bookingsFile.sha256,
    );
    const result = await t.suggest([]);
    expect(result.suggested).toBe(1);
    const review = await t.list({ review: true });
    const row = review.rows[0];
    expect(row).toMatchObject({
      status: 'aiSuggested',
      suggestion: { kind: 'income_airdrop', confidence: 70 },
    });
    await t.decide([row?.suggestion?.id as string], true);
    const after = (await t.list()).rows.find((r) => r.key === row?.key);
    expect(after).toMatchObject({ kind: 'income_airdrop', status: 'changed' });
    const [edit] = (await t.detail(row?.key as string)).history;
    expect(edit).toMatchObject({
      source: 'ai',
      reason: 'AI: Unsolicited arrival',
    });
  });

  it('takes a platform type → kind into the mapping that read the transaction (F9.10)', async () => {
    const t = await setup();
    await expect(
      t.kindRule((await t.list()).rows[0]?.key as string),
    ).rejects.toMatchObject({ response: { code: 'noMapping' } });
    const mapping = await t.mappings.create('anna', {
      spec: validateMappingSpec(KRAKEN_SPEC).spec as never,
      origin: 'manual',
    });
    await t.uploadMine('kraken.csv', KRAKEN);
    const row = (await t.list({ limit: 200 })).rows.find(
      (r) => r.source.fileName === 'kraken.csv',
    );
    const rule = await t.kindRule(row?.key as string);
    expect(rule.mappingId).toBe(mapping.id);
    const updated = await t.mappings.findById(mapping.id);
    expect(updated?.spec.bookings?.kind.rules[0]).toMatchObject({
      kind: 'income_staking',
    });
  });
});
