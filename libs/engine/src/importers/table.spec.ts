import type { SourceFile } from './importer';
import {
  findTable,
  headerIs,
  normaliseHeader,
  periodOf,
  tableRows,
} from './table';

const workbook: SourceFile = {
  id: 'sha',
  name: 'export.xlsx',
  kind: 'xlsx',
  sheets: [
    { name: 'Info', rows: [['nothing here']] },
    {
      name: 'Data',
      rows: [
        ['Account statement'],
        ['Period', '2025-01-01 - 2025-12-31'],
        [],
        ['User ID', 'Time', 'Coin', 'Change'],
        ['1', '2025-01-01 00:00:00', 'BTC', '0.1'],
        ['', '', '', ''],
        ['1', '2025-01-02 00:00:00', 'ETH', '-0.2'],
      ],
    },
  ],
};

describe('table helpers', () => {
  it('normalises headers loosely', () => {
    expect(normaliseHeader('\uFEFF "User_ID" ')).toBe('userid');
    expect(normaliseHeader('User ID')).toBe('userid');
    expect(normaliseHeader('Gebühr-Asset')).toBe('gebührasset');
  });

  it('finds a header row below a preamble, in any sheet, with spreadsheet row numbers', () => {
    const table = findTable(workbook, ['user_id', 'coin', 'change']);
    expect(table?.sheet.name).toBe('Data');
    expect(table?.headerIndex).toBe(3);
    if (!table) throw new Error('no table');
    const rows = tableRows(table);
    expect(rows.map((r) => r.row)).toEqual([5, 7]);
    expect(rows[1]?.get('COIN')).toBe('ETH');
    expect(rows[0]?.raw()).toEqual({
      'User ID': '1',
      Time: '2025-01-01 00:00:00',
      Coin: 'BTC',
      Change: '0.1',
    });
    expect(headerIs(table, ['User ID', 'Time', 'Coin', 'Change'])).toBe(true);
  });

  it('honours a fixed header row and a sheet choice, and never throws', () => {
    expect(findTable(workbook, ['coin'], { headerRow: 4 })?.headerIndex).toBe(
      3,
    );
    expect(findTable(workbook, ['coin'], { headerRow: 5 })).toBeUndefined();
    expect(findTable(workbook, ['coin'], { sheet: 'Info' })).toBeUndefined();
    expect(findTable(workbook, ['coin'], { sheet: 1 })?.sheet.name).toBe(
      'Data',
    );
    expect(
      findTable({ id: 'x', name: 'a.pdf', kind: 'pdf', pages: [] }, ['coin']),
    ).toBeUndefined();
  });

  it('computes a period over timestamps and dates', () => {
    expect(
      periodOf([
        '2025-03-01T00:00:00.000Z',
        '2024-12-31',
        '2025-01-01T23:00:00Z',
      ]),
    ).toEqual({
      from: '2024-12-31',
      to: '2025-03-01',
    });
    expect(periodOf([])).toBeNull();
  });
});
