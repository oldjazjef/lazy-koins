import { calculationSetup } from '../../calculation/testing/calculation-fixture';
import { InMemoryProjectExportRepository } from '../../exports/testing/in-memory-project-export.repository';
import { FileAnalysisService } from '../../files/application/file-analysis.service';
import { SourceFileReader } from '../../files/application/source-file-reader';
import { InMemoryImportMappingRepository } from '../../mappings/testing/in-memory-import-mapping.repository';
import {
  InMemoryCarryoverRepository,
  InMemoryProjectBundleRepository,
} from './in-memory-carryover.repositories';

/**
 * The calculation fixture (a 2025 project with two synthetic standard-format files and rates)
 * plus the doubles the carry-over and package handlers need. Shared by their specs.
 */
export async function bundleSetup() {
  const t = await calculationSetup();
  // The fixture's mapping double is internal to it; a second one over the same files is fine.
  const mappings = new InMemoryImportMappingRepository(t.files);
  const exports = new InMemoryProjectExportRepository();
  const carryovers = new InMemoryCarryoverRepository();
  const bundles = new InMemoryProjectBundleRepository({
    projects: t.projects,
    files: t.files,
    mappings,
    corrections: t.corrections,
    rates: t.rates,
    states: t.states,
    exports,
    carryovers,
  });
  const analysis = new FileAnalysisService(new SourceFileReader(), mappings);
  return { ...t, mappings, exports, carryovers, bundles, analysis };
}
