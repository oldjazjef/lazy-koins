import { NotFoundException } from '@nestjs/common';
import { calculationSetup } from '../testing/calculation-fixture';
import { CalculateProjectCommand } from './calculation.handlers';
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

  it('a hidden transaction (global edit) stays listed with its reason, leaves the result, and comes back on undo (F9.8)', async () => {
    const t = await calculationSetup();
    const before = await t.transactions.execute(
      new ListTransactionsQuery('anna', t.project.id),
    );
    const staking = before.rows.find((r) => r.kind === 'income_staking');
    expect(staking).toMatchObject({ key: staking?.id, status: 'original' });
    const [edit] = await t.transactionEdits.add('anna', [
      {
        key: staking?.key ?? '',
        changes: { hidden: true },
        reason: 'Doppelt importiert',
        source: 'user',
      },
    ]);
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
        status: 'changed',
        hidden: true,
        editReason: 'Doppelt importiert',
      }),
    ]);

    await t.transactionEdits.setStatus(edit?.id ?? '', 'undone');
    const restored = await t.transactions.execute(
      new ListTransactionsQuery('anna', t.project.id),
    );
    expect(restored.rows.find((r) => r.id === staking?.id)?.treatment).toBe(
      'income',
    );
  });

  it('shows the tax year by default; earlier bookings that decide a balance on request (F9.6)', async () => {
    const t = await calculationSetup();
    await t.addFile(
      'alt.csv',
      [
        'Zeitpunkt,Plattform,Konto,Art,Asset,Menge,Gebühr,Gebühr-Asset,Preis CHF,Preis USD,Referenz,Notiz',
        '2024-06-01T10:00:00Z,ledger,main,deposit,ETH,2,,,,,,',
      ].join('\n'),
    );
    const year = await t.transactions.execute(
      new ListTransactionsQuery('anna', t.project.id),
    );
    expect(year.rows.some((r) => r.timestamp.startsWith('2024'))).toBe(false);
    const all = await t.transactions.execute(
      new ListTransactionsQuery('anna', t.project.id, { scope: 'all' }),
    );
    expect(all.rows.some((r) => r.timestamp.startsWith('2024'))).toBe(true);
  });

  it("someone else's project is a 404", async () => {
    const t = await calculationSetup();
    await expect(
      t.transactions.execute(new ListTransactionsQuery('bob', t.project.id)),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
