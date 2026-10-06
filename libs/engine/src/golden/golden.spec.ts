import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * The acceptance test A1: the 2025 project computed from the real exports in `private/` must
 * match `private/golden.json` (±0.05 CHF; the Kraken balance exactly).
 *
 * `private/` holds real tax data and is git-ignored (CLAUDE.md, Private data), so this suite
 * **skips** wherever it is absent — CI and every other machine. Only existence is checked here;
 * nothing under private/ is opened until the engine can compute the figures it compares. When it
 * does, it reports "matches" or "off by X CHF in <position>" — never the underlying rows.
 */
const GOLDEN = fileURLToPath(
  new URL('../../../../private/golden.json', import.meta.url),
);

describe.skipIf(!existsSync(GOLDEN))('golden (A1, private data)', () => {
  it('finds the expected values next to the real exports', () => {
    // The comparison arrives with the first importers and the valuation (F7.1, F7.2).
    expect(existsSync(GOLDEN)).toBe(true);
  });
});
