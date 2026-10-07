import type {
  MappingSuggestion,
  SuggestionPreview,
} from '../../../../core/api/api.types';
import { coveragePercent, kindEntries } from './mapping-suggestions';

describe('mapping suggestions helpers (F5.19)', () => {
  it('shows the match in whole percent, never more than it is', () => {
    const at = (coverage: number) =>
      coveragePercent({ coverage } as MappingSuggestion);
    expect(at(1)).toBe(100);
    expect(at(0.999)).toBe(99);
    expect(at(0.8)).toBe(80);
  });

  it('lists the kind counts in the closed list’s order, only those present', () => {
    const preview = {
      kindCounts: { unknown: 2, trade: 5, deposit: 1 },
    } as unknown as SuggestionPreview;
    expect(kindEntries(preview)).toEqual([
      { kind: 'trade', count: 5 },
      { kind: 'deposit', count: 1 },
      { kind: 'unknown', count: 2 },
    ]);
  });
});
