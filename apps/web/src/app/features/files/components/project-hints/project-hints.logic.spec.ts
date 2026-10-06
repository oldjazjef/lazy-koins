import type { ProjectFile, ProjectHint } from '../../../../core/api/api.types';
import {
  hintActions,
  hintsByPlatform,
  pdfsFor,
  sortHints,
} from './project-hints.logic';

const hint = (over: Partial<ProjectHint> = {}): ProjectHint => ({
  key: 'endsEarly:kraken|spot',
  kind: 'endsEarly',
  severity: 'warning',
  platform: 'kraken',
  accountId: 'spot',
  accounts: ['spot'],
  date: '2025-06-30',
  zeroBalance: false,
  hintKey: 'files.missing.howTo.endsEarly',
  fileId: null,
  fileName: null,
  count: null,
  status: 'open',
  note: '',
  ...over,
});

const file = (over: Partial<ProjectFile> = {}): ProjectFile => ({
  id: 'f1',
  sha256: 'a'.repeat(64),
  displayName: 'Kraken_Statement_2025.pdf',
  kind: 'pdf',
  size: 1,
  status: 'evidence_only',
  platform: null,
  mappingId: null,
  mappingName: null,
  period: null,
  bookingCount: 0,
  holdingCount: 0,
  errorCount: 0,
  origin: 'uploaded',
  originProjectId: null,
  originProjectName: null,
  derivedFromFileId: null,
  derivedFromName: null,
  addedAt: '2026-01-01T00:00:00.000Z',
  ...over,
});

describe('hint actions (F5.8)', () => {
  it('offers the statement via AI first when a PDF of the platform exists', () => {
    const missing = hint({ kind: 'noYearEndBalance', key: 'n' });
    expect(hintActions(missing, []).map((a) => a.kind)).toEqual([
      'upload',
      'manualHolding',
      'template',
    ]);
    expect(
      hintActions(missing, [file(), file({ id: 'f2', displayName: 'x.pdf' })]),
    ).toMatchObject([
      { kind: 'aiStatement', fileId: 'f1' },
      { kind: 'upload' },
      { kind: 'manualHolding' },
      { kind: 'template', label: 'hints.actions.holdingsTemplate' },
    ]);
  });

  it('fixes files: AI mapping or assignment for an unknown table, the row errors otherwise', () => {
    expect(
      hintActions(
        hint({ kind: 'unrecognisedFile', fileId: 'f9', platform: null }),
        [],
      ).map((a) => [a.kind, a.fileId]),
    ).toEqual([
      ['aiMapping', 'f9'],
      ['assign', 'f9'],
    ]);
    expect(
      hintActions(hint({ kind: 'rowErrors', fileId: 'f3' }), []).map(
        (a) => a.kind,
      ),
    ).toEqual(['rowErrors']);
    expect(hintActions(hint(), []).map((a) => a.kind)).toEqual([
      'upload',
      'template',
    ]);
  });

  it('matches PDFs by the platform in their name, never without a platform', () => {
    expect(pdfsFor('Kraken', [file()]).map((f) => f.id)).toEqual(['f1']);
    expect(pdfsFor(null, [file()])).toEqual([]);
    expect(pdfsFor('kraken', [file({ kind: 'csv' })])).toEqual([]);
  });
});

describe('hint table order', () => {
  const hints = [
    hint({ key: 'a', severity: 'info', date: '2025-01-01', kind: 'endsEarly' }),
    hint({
      key: 'b',
      severity: 'error',
      date: null,
      kind: 'noYearData',
      platform: 'binance',
    }),
    hint({
      key: 'c',
      severity: 'warning',
      date: '2024-12-01',
      kind: 'startsLate',
    }),
    hint({
      key: 'd',
      kind: 'unrecognisedFile',
      platform: null,
      severity: 'error',
      status: 'done',
    }),
  ];

  it('sorts by severity, type or date', () => {
    expect(sortHints(hints, 'severity').map((h) => h.key)).toEqual([
      'b',
      'd',
      'c',
      'a',
    ]);
    expect(sortHints(hints, 'kind').map((h) => h.key)).toEqual([
      'd',
      'b',
      'c',
      'a',
    ]);
    // Undated hints last.
    expect(sortHints(hints, 'date').map((h) => h.key)).toEqual([
      'c',
      'a',
      'd',
      'b',
    ]);
  });

  it('groups by platform, unread files last, with the open count', () => {
    expect(
      hintsByPlatform(hints).map((g) => [
        g.platform,
        g.hints.map((h) => h.key),
        g.open,
      ]),
    ).toEqual([
      ['binance', ['b'], 1],
      ['kraken', ['a', 'c'], 2],
      ['', ['d'], 0],
    ]);
  });
});
