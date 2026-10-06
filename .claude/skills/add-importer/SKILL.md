---
name: add-importer
description: Add or extend an importer in libs/engine for one exchange/wallet export type (Kraken ledger, Binance history, Revolut statement, ...) - detection, parsing to bookings with file+row traceability, synthetic fixtures, tests. Use when a platform or file type is not recognised yet or parses wrongly.
---

# Add an importer to libs/engine

1. **Look first.** `ls libs/engine/src/importers/` and read the closest existing importer of the
   same file kind (CSV / XLSX / PDF), plus the contract in `importers/importer.ts` (`Importer`,
   `SourceFile`, `ImportResult`). Check F5.2 in `ANFORDERUNGEN.md` for the required types. For
   the shape of a real export, run `pnpm private:inspect` (headers and row counts only) — never
   open files under `private/`.

2. **One folder per platform**, one module per export type:

   ```
   importers/<platform>/<export-type>.ts       # detect() + parse()
   importers/<platform>/<export-type>.spec.ts
   importers/<platform>/fixtures/*.csv          # SYNTHETIC only
   ```

   Add it to `IMPORTERS` in `importers/registry.ts` so automatic detection (F5.2) tries it; the
   registry picks the single best match and reports near-ties as `ambiguous`.

3. **detect()** decides from headers/structure alone, returns a confidence 0 … 1 (0 = not mine),
   and never throws on a foreign file. Two importers must not both claim the same file — add a test for the nearest
   lookalike.

4. **parse()** returns `Booking[]` and the detected period (F5.5, F5.8):
   - every booking has `sourceFileId` + `row` (1-based, as a spreadsheet shows it; page for PDFs);
   - quantities and fees as `Decimal` from the **original string** with `parseDecimal`
     (`money/decimal.ts`) — never through `number` (there is no `fromNumber`);
   - timestamps as UTC ISO strings; state the source's time zone in the code;
   - keep the platform's own type/sub-type verbatim next to the mapped kind, so a
     reclassification (F9.2) can be explained.

5. **Fixtures are synthetic.** Copy the _shape_ (headers, quirks, odd rows) of a real export,
   never values, addresses, txids or account ids from `private/`.

6. **Test**: detection (yes + lookalike no), every booking kind the format has, fees, a
   multi-line trade, and the row numbers. Then `pnpm check`, and — if `private/` exists — the
   golden test (A1).
