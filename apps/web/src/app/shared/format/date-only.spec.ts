// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  addDays,
  dateToIso,
  formatDay,
  isIsoDay,
  isoToDate,
  parseDay,
} from './date-only';

/**
 * The boundary between the calendar's `Date`s and the app's `yyyy-MM-dd` strings. The awkward
 * cases are impossible days, the DST switches and the year boundary — the specs run in UTC
 * (vitest.config.ts), so the round trip also runs in a child Node process in zones with DST
 * (Zurich; Santiago, whose switch happens at midnight, the classic "day goes missing" case).
 */
describe('in zones with daylight saving time', () => {
  const module = fileURLToPath(new URL('./date-only.ts', import.meta.url));
  const script = `
    const m = await import(${JSON.stringify(pathToFileURL(module).href)});
    const wrong = [];
    for (let d = new Date(2026, 0, 1); d.getFullYear() < 2028; d = m.addDays(d, 1)) {
      const iso = m.dateToIso(d);
      if (m.dateToIso(m.isoToDate(iso)) !== iso) wrong.push(iso);
      const next = m.dateToIso(m.addDays(m.isoToDate(iso), 1));
      if (next <= iso) wrong.push(iso + '+1');
    }
    console.log(JSON.stringify(wrong));
  `;

  for (const zone of ['Europe/Zurich', 'America/Santiago']) {
    it(`round-trips every day of 2026–2027 in ${zone}`, () => {
      const out = execFileSync(
        process.execPath,
        [
          '--no-warnings',
          '--experimental-strip-types',
          '--input-type=module',
          '-e',
          script,
        ],
        { env: { ...process.env, TZ: zone }, encoding: 'utf8' },
      );
      expect(JSON.parse(out.trim())).toEqual([]);
    });
  }
});

describe('isoToDate / dateToIso', () => {
  it('round-trips every day of a year with both DST switches and 29 February', () => {
    for (
      let day = new Date(2028, 0, 1);
      day.getFullYear() === 2028;
      day = addDays(day, 1)
    ) {
      const iso = dateToIso(day);
      expect(dateToIso(isoToDate(iso) as Date)).toBe(iso);
    }
  });

  it('builds local midnight, so the calendar day never shifts', () => {
    const date = isoToDate('2026-03-29') as Date; // the Swiss spring switch
    expect([date.getFullYear(), date.getMonth(), date.getDate()]).toEqual([
      2026, 2, 29,
    ]);
    expect(date.getHours()).toBe(0);
  });

  it('refuses impossible days instead of rolling them over', () => {
    expect(isoToDate('2026-02-29')).toBeUndefined();
    expect(isoToDate('2026-13-01')).toBeUndefined();
    expect(isoToDate('2026-1-01')).toBeUndefined();
    expect(isoToDate('')).toBeUndefined();
    expect(isIsoDay('2028-02-29')).toBe(true);
  });

  it('adds days across the year boundary and the autumn DST switch', () => {
    expect(dateToIso(addDays(isoToDate('2025-12-31') as Date, 1))).toBe(
      '2026-01-01',
    );
    expect(dateToIso(addDays(isoToDate('2026-10-24') as Date, 2))).toBe(
      '2026-10-26',
    );
    expect(dateToIso(addDays(isoToDate('2026-01-01') as Date, -1))).toBe(
      '2025-12-31',
    );
  });
});

describe('formatDay / parseDay (F11.2 date formats)', () => {
  const day = new Date(2026, 1, 3);

  it('formats in each of the profile formats', () => {
    expect(formatDay(day, 'dd.MM.yyyy')).toBe('03.02.2026');
    expect(formatDay(day, 'yyyy-MM-dd')).toBe('2026-02-03');
    expect(formatDay(day, 'dd/MM/yyyy')).toBe('03/02/2026');
    expect(formatDay(day, 'MM/dd/yyyy')).toBe('02/03/2026');
  });

  it('reads what it writes, in every format', () => {
    for (const format of [
      'dd.MM.yyyy',
      'yyyy-MM-dd',
      'dd/MM/yyyy',
      'MM/dd/yyyy',
    ] as const) {
      expect(dateToIso(parseDay(formatDay(day, format), format) as Date)).toBe(
        '2026-02-03',
      );
    }
  });

  it('accepts one-digit day and month and always ISO', () => {
    expect(dateToIso(parseDay('3.2.2026', 'dd.MM.yyyy') as Date)).toBe(
      '2026-02-03',
    );
    expect(dateToIso(parseDay(' 2026-02-03 ', 'MM/dd/yyyy') as Date)).toBe(
      '2026-02-03',
    );
  });

  it('returns null for typos and impossible days', () => {
    expect(parseDay('31.02.2026', 'dd.MM.yyyy')).toBeNull();
    expect(parseDay('03.02.26', 'dd.MM.yyyy')).toBeNull();
    expect(parseDay('03/02/2026', 'dd.MM.yyyy')).toBeNull();
    expect(parseDay('13/31/2026', 'dd/MM/yyyy')).toBeNull();
    expect(parseDay('abc', 'yyyy-MM-dd')).toBeNull();
  });
});
