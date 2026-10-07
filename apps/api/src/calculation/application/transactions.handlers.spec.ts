import { NotFoundException } from '@nestjs/common';
import { calculationSetup } from '../testing/calculation-fixture';
import {
  CalculateProjectCommand,
  CreateCorrectionCommand,
  SetCorrectionUndoneCommand,
} from './calculation.handlers';
import { ListTransactionsQuery } from './transactions.handlers';

describe('ListTransactionsHandler (Transaktionen)', () => {
  it('lists every booking with its treatment, file and row, newest first', async () => {
    const t = await calculationSetup();
    const view = await t.transactions.execute(
      new ListTransactionsQuery('anna', t.project.id),
    );
    expect(view).toMatchObject({ taxYear: 2025, currency: 'CHF', total: 5 });
    expect(view.platforms).toEqual(['kraken']);
    expect(view.rows.map((r) => r.timestamp)).toEqual(
      [...view.rows.map((r) => r.timestamp)].sort().reverse(),
    );
    const staking = view.rows.find((r) => r.kind === 'income_staking');
    expect(staking).toMatchObject({
      treatment: 'income',
      fileName: 'buchungen.csv',
      projectFileId: t.bookingsFile.id,
    });
    expect(staking?.valueChf).not.toBeNull();
    // The account has a statement at 31.12.: its trades are only checked against it.
    expect(view.rows.find((r) => r.asset === 'BTC')?.treatment).toBe(
      'checkOnly',
    );
    expect(view.rows.find((r) => r.kind === 'unknown')?.treatment).toBe(
      'unknown',
    );
    expect(view.counts).toMatchObject({ income: 1, unknown: 1, checkOnly: 3 });
  });

  it('filters by words, treatment and platform, and pages', async () => {
    const t = await calculationSetup();
    const query = (
      filter: ConstructorParameters<typeof ListTransactionsQuery>[2],
    ) =>
      t.transactions.execute(
        new ListTransactionsQuery('anna', t.project.id, filter),
      );
    expect((await query({ q: 'dot staking' })).total).toBe(1);
    expect((await query({ q: 'nothing-like-this' })).total).toBe(0);
    const income = await query({ treatment: 'income' });
    expect(income.total).toBe(1);
    expect(income.counts.checkOnly).toBe(3);
    expect((await query({ platform: 'binance' })).total).toBe(0);
    const page = await query({ offset: 1, limit: 2 });
    expect(page).toMatchObject({ total: 5, offset: 1, limit: 2 });
    expect(page.rows).toHaveLength(2);
    expect((await query({ limit: 10_000 })).limit).toBe(200);
  });

  it('a deactivated booking stays listed with its reason, leaves the result, and comes back on undo', async () => {
    const t = await calculationSetup();
    const before = await t.transactions.execute(
      new ListTransactionsQuery('anna', t.project.id),
    );
    const staking = before.rows.find((r) => r.kind === 'income_staking');
    const correction = await t.createCorrection.execute(
      new CreateCorrectionCommand(
        'anna',
        t.project.id,
        { type: 'exclude_booking', bookingId: staking?.id ?? '' },
        'Doppelt importiert',
      ),
    );
    const result = await t.calculate.execute(
      new CalculateProjectCommand('anna', t.project.id),
    );
    expect(result.result?.income).toEqual([]);
    const after = await t.transactions.execute(
      new ListTransactionsQuery('anna', t.project.id, {
        treatment: 'excluded',
      }),
    );
    expect(after.rows).toEqual([
      expect.objectContaining({
        id: staking?.id,
        treatment: 'excluded',
        correctionId: correction.id,
        correctionReason: 'Doppelt importiert',
      }),
    ]);

    await t.undo.execute(
      new SetCorrectionUndoneCommand('anna', t.project.id, correction.id, true),
    );
    const restored = await t.transactions.execute(
      new ListTransactionsQuery('anna', t.project.id),
    );
    expect(restored.rows.find((r) => r.id === staking?.id)?.treatment).toBe(
      'income',
    );
  });

  it("someone else's project is a 404", async () => {
    const t = await calculationSetup();
    await expect(
      t.transactions.execute(new ListTransactionsQuery('bob', t.project.id)),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
