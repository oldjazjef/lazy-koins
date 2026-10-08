import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { ListMyProjectsQuery } from '../../projects/application/queries/list-my-projects.query';
import { calculationSetup } from '../testing/calculation-fixture';
import {
  CalculateProjectCommand,
  CreateCorrectionCommand,
  GetChecksQuery,
  GetFigureRecordsQuery,
  GetResultQuery,
  GetResultStatusQuery,
  ListCorrectionsQuery,
  SetCorrectionUndoneCommand,
  UpdateOpenItemCommand,
} from './calculation.handlers';

describe('calculation handlers', () => {
  it('calculates from the stored files and rates, keeps a snapshot and reports staleness', async () => {
    const t = await calculationSetup();
    const before = await t.result.execute(
      new GetResultQuery('anna', t.project.id),
    );
    expect(before).toMatchObject({ snapshot: null, stale: true, result: null });

    const view = await t.calculate.execute(
      new CalculateProjectCommand('anna', t.project.id),
    );
    expect(view.result?.totals).toMatchObject({
      wealthChf: '858.7',
      incomeChf: '6.75',
    });
    expect(
      view.result?.positions.map((p) => [p.asset, p.quantitySource, p.status]),
    ).toEqual([
      ['BTC', 'statement', 'ok'],
      ['CHF', 'statement', 'ok'],
      ['DOT', 'statement', 'missingPrice'],
      ['ETH', 'statement', 'missingPrice'],
    ]);
    // The ledger agrees with the statement exactly.
    expect(
      view.result?.checks.find((c) => c.kind === 'ledgerVsStatement')?.light,
    ).toBe('green');

    const fresh = await t.result.execute(
      new GetResultQuery('anna', t.project.id),
    );
    expect(fresh.stale).toBe(false);
    expect(fresh.snapshot?.inputHash).toMatch(/^[0-9a-f]{64}$/);

    await t.rates.upsertMany(t.project.id, [
      {
        kind: 'price',
        asset: 'DOT',
        currency: 'CHF',
        date: '2025-12-31',
        value: '4',
        source: 'manual',
      },
    ]);
    expect(
      (await t.result.execute(new GetResultQuery('anna', t.project.id))).stale,
    ).toBe(true);

    const [entry] = await t.list.execute(new ListMyProjectsQuery('anna'));
    expect(entry?.figures).toMatchObject({
      wealthChf: '858.7',
      incomeChf: '6.75',
    });
  });

  it('gives the same input hash for the same data (F7.6)', async () => {
    const t = await calculationSetup();
    const a = await t.calculate.execute(
      new CalculateProjectCommand('anna', t.project.id),
    );
    const b = await t.calculate.execute(
      new CalculateProjectCommand('anna', t.project.id),
    );
    expect(b.snapshot?.inputHash).toBe(a.snapshot?.inputHash);
    expect(JSON.stringify(b.result)).toBe(JSON.stringify(a.result));
  });

  it('drills a figure down to file and row (F7.5)', async () => {
    const t = await calculationSetup();
    const view = await t.calculate.execute(
      new CalculateProjectCommand('anna', t.project.id),
    );
    const income = view.result?.income[0];
    const records = await t.records.execute(
      new GetFigureRecordsQuery('anna', t.project.id, income?.id ?? ''),
    );
    expect(records.records).toEqual([
      expect.objectContaining({
        projectFileId: t.bookingsFile.id,
        fileName: 'buchungen.csv',
        row: 5,
        asset: 'DOT',
        quantity: '2',
        fee: '0.5',
        raw: expect.objectContaining({ Art: 'income_staking' }),
      }),
    ]);
    const platform = await t.records.execute(
      new GetFigureRecordsQuery('anna', t.project.id, 'plat:kraken'),
    );
    expect(platform.total).toBe(4);
    await expect(
      t.records.execute(
        new GetFigureRecordsQuery('anna', t.project.id, 'pos:nope'),
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      t.records.execute(
        new GetFigureRecordsQuery('bruno', t.project.id, income?.id ?? ''),
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('lists checks with open items, ticked and annotated (F8.2)', async () => {
    const t = await calculationSetup();
    await t.calculate.execute(
      new CalculateProjectCommand('anna', t.project.id),
    );
    const checks = await t.checks.execute(
      new GetChecksQuery('anna', t.project.id),
    );
    const unclassified = checks.items.find((i) => i.check === 'unclassified');
    expect(unclassified).toMatchObject({
      done: false,
      note: '',
      params: { count: '1' },
    });
    await t.tick.execute(
      new UpdateOpenItemCommand('anna', t.project.id, unclassified?.key ?? '', {
        done: true,
        note: '  ist ein Geschenk  ',
      }),
    );
    const after = await t.checks.execute(
      new GetChecksQuery('anna', t.project.id),
    );
    expect(after.items.find((i) => i.key === unclassified?.key)).toMatchObject({
      done: true,
      note: 'ist ein Geschenk',
    });
  });

  it('applies corrections with history, undo and redo (F9)', async () => {
    const t = await calculationSetup();
    const first = await t.calculate.execute(
      new CalculateProjectCommand('anna', t.project.id),
    );
    const bookingId = first.result?.income[0]?.bookingId ?? '';
    const manual = {
      type: 'manual_booking' as const,
      booking: {
        platform: 'kraken',
        accountId: 'spot',
        timestamp: '2025-03-01T00:00:00Z',
        asset: 'DOT',
        quantity: '1',
        kind: 'income_staking' as const,
        priceUsd: '5',
      },
    };

    await expect(
      t.createCorrection.execute(
        new CreateCorrectionCommand(
          'anna',
          t.project.id,
          { type: 'reclassify', bookingId, kind: 'gift' },
          'x',
        ),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    // F9.11: reclassifying / hiding is a global transaction edit now.
    await expect(
      t.createCorrection.execute(
        new CreateCorrectionCommand(
          'anna',
          t.project.id,
          { type: 'reclassify', bookingId, kind: 'transfer' },
          'Umbuchung',
        ),
      ),
    ).rejects.toMatchObject({
      response: { code: 'useTransactionEdit' },
    });
    await expect(
      t.createCorrection.execute(
        new CreateCorrectionCommand('anna', t.project.id, manual, '   '),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    const correction = await t.createCorrection.execute(
      new CreateCorrectionCommand(
        'anna',
        t.project.id,
        manual,
        'Vergessene Staking-Belohnung',
      ),
    );
    const corrected = await t.calculate.execute(
      new CalculateProjectCommand('anna', t.project.id),
    );
    expect(corrected.result?.totals.incomeChf).toBe('11.25');
    const [listed] = await t.listCorrections.execute(
      new ListCorrectionsQuery('anna', t.project.id),
    );
    expect(listed).toMatchObject({
      reason: 'Vergessene Staking-Belohnung',
      undoneAt: null,
      applied: {
        status: 'applied',
        before: null,
        after: { kind: 'income_staking', asset: 'DOT' },
      },
    });

    await t.undo.execute(
      new SetCorrectionUndoneCommand('anna', t.project.id, correction.id, true),
    );
    const undone = await t.calculate.execute(
      new CalculateProjectCommand('anna', t.project.id),
    );
    expect(undone.result?.totals.incomeChf).toBe('6.75');
    const [history] = await t.listCorrections.execute(
      new ListCorrectionsQuery('anna', t.project.id),
    );
    expect(history?.undoneAt).not.toBeNull();

    await t.undo.execute(
      new SetCorrectionUndoneCommand(
        'anna',
        t.project.id,
        correction.id,
        false,
      ),
    );
    const redone = await t.calculate.execute(
      new CalculateProjectCommand('anna', t.project.id),
    );
    expect(redone.result?.totals.incomeChf).toBe('11.25');
  });

  it('applies global transaction edits in the calculation and makes it stale (F9.8)', async () => {
    const t = await calculationSetup();
    const first = await t.calculate.execute(
      new CalculateProjectCommand('anna', t.project.id),
    );
    const bookingId = first.result?.income[0]?.bookingId ?? '';
    const [edit] = await t.transactionEdits.add('anna', [
      {
        key: bookingId,
        changes: { kind: 'transfer' },
        reason: 'Umbuchung, kein Ertrag',
        source: 'user',
      },
    ]);
    const status = await t.status.execute(
      new GetResultStatusQuery('anna', t.project.id),
    );
    expect(status.stale).toBe(true);
    const corrected = await t.calculate.execute(
      new CalculateProjectCommand('anna', t.project.id),
    );
    expect(corrected.result?.totals.incomeChf).toBe('0');
    await t.transactionEdits.setStatus(edit?.id ?? '', 'undone');
    const undone = await t.calculate.execute(
      new CalculateProjectCommand('anna', t.project.id),
    );
    expect(undone.result?.totals.incomeChf).toBe('6.75');
  });

  it('keeps a closed project read-only (F4.5)', async () => {
    const t = await calculationSetup();
    await t.calculate.execute(
      new CalculateProjectCommand('anna', t.project.id),
    );
    await t.projects.update(t.project.id, { status: 'closed' });
    await expect(
      t.calculate.execute(new CalculateProjectCommand('anna', t.project.id)),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      t.createCorrection.execute(
        new CreateCorrectionCommand(
          'anna',
          t.project.id,
          {
            type: 'price_override',
            asset: 'DOT',
            date: '2025-12-31',
            priceChf: '4',
          },
          'ESTV',
        ),
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      t.tick.execute(
        new UpdateOpenItemCommand('anna', t.project.id, 'k', { done: true }),
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    // Reading still works.
    expect(
      (await t.result.execute(new GetResultQuery('anna', t.project.id))).result,
    ).not.toBeNull();
  });

  it("uses the previous year's closing figures for the opening check and the comparison (F8.3)", async () => {
    const t = await calculationSetup();
    const previous = await t.projects.create('anna', {
      name: 'Steuern 2024',
      taxYear: 2024,
      country: 'CH',
      canton: 'ZH',
      notes: '',
    });
    const current = async () => {
      const view = await t.calculate.execute(
        new CalculateProjectCommand('anna', t.project.id),
      );
      if (!view.result) throw new Error('no result');
      return view.result;
    };
    await t.snapshots.save(previous.id, {
      inputHash: 'a'.repeat(64),
      engineVersion: 1,
      records: {},
      result: {
        ...(await current()),
        taxYear: 2024,
        totals: {
          wealthChf: '100',
          incomeChf: '1',
          positions: 1,
          missingPrices: 0,
          openItems: 0,
        },
        positions: [],
      },
    });
    const view = await t.calculate.execute(
      new CalculateProjectCommand('anna', t.project.id),
    );
    expect(view.result?.comparison).toMatchObject({
      previousTaxYear: 2024,
      wealthDeltaChf: '758.7',
    });
    expect(
      view.result?.checks.find((c) => c.kind === 'openingBalance')?.light,
    ).toBe('green');
  });
});
