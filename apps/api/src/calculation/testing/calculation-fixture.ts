import { FileAnalysisService } from '../../files/application/file-analysis.service';
import {
  UploadProjectFileCommand,
  UploadProjectFileHandler,
} from '../../files/application/commands/upload-project-file.command';
import { SourceFileReader } from '../../files/application/source-file-reader';
import { InMemoryProjectFileRepository } from '../../files/testing/in-memory-project-file.repository';
import { InMemoryImportMappingRepository } from '../../mappings/testing/in-memory-import-mapping.repository';
import { ListMyProjectsHandler } from '../../projects/application/queries/list-my-projects.query';
import { InMemoryProjectRepository } from '../../projects/testing/in-memory-project.repository';
import { InMemoryProjectSentRepository } from '../../projects/testing/in-memory-project-sent.repository';
import { InMemoryProjectRateRepository } from '../../rates/testing/in-memory-project-rate.repository';
import { InMemoryWalletRepository } from '../../wallets/testing/in-memory-wallet.repository';
import { CalculationInputService } from '../application/calculation-input.service';
import {
  CalculateProjectHandler,
  CreateCorrectionHandler,
  GetChecksHandler,
  GetFigureRecordsHandler,
  GetResultHandler,
  ListCorrectionsHandler,
  SetCorrectionUndoneHandler,
  UpdateOpenItemHandler,
} from '../application/calculation.handlers';
import {
  InMemoryCorrectionRepository,
  InMemoryOpenItemStateRepository,
  InMemorySnapshotRepository,
} from './in-memory-calculation.repositories';

/**
 * A project with two synthetic standard-format files (a Kraken-like ledger and its December
 * statement), stored rates and every calculation handler over port doubles — shared by the
 * calculation, rates and exports specs.
 *
 * Synthetic standard-format files (CLAUDE.md, Private data). */
export const BOOKINGS_CSV = [
  'Zeitpunkt,Plattform,Konto,Art,Asset,Menge,Gebühr,Gebühr-Asset,Preis CHF,Preis USD,Referenz,Notiz',
  '2025-01-03T10:00:00Z,kraken,spot,deposit,CHF,1000,,,,,,',
  '2025-01-03T11:00:00Z,kraken,spot,trade,CHF,-500,1.3,,,,T1,',
  '2025-01-03T11:00:00Z,kraken,spot,trade,BTC,0.005,,,,,T1,',
  '2025-03-01T00:00:00Z,kraken,spot,income_staking,DOT,2,0.5,,,5,,',
  '2025-04-01T00:00:00Z,kraken,spot,unknown,ETH,1,,,,,,',
].join('\n');

export const HOLDINGS_CSV = [
  'Plattform,Konto,Asset,Menge,Stichtag,Preis CHF,Preis USD,Beleg',
  'kraken,spot,BTC,0.005,2025-12-31,,,Kontoauszug Dezember (synthetisch)',
  'kraken,spot,CHF,498.7,2025-12-31,,,',
  'kraken,spot,DOT,1.5,2025-12-31,,,',
  'kraken,spot,ETH,1,2025-12-31,,,',
].join('\n');

const encode = (text: string) => new TextEncoder().encode(text);

export async function calculationSetup() {
  const projects = new InMemoryProjectRepository();
  const files = new InMemoryProjectFileRepository();
  const mappings = new InMemoryImportMappingRepository(files);
  const rates = new InMemoryProjectRateRepository();
  const corrections = new InMemoryCorrectionRepository();
  const snapshots = new InMemorySnapshotRepository();
  const states = new InMemoryOpenItemStateRepository();
  const reader = new SourceFileReader();
  const wallets = new InMemoryWalletRepository();
  const inputs = new CalculationInputService(
    projects,
    files,
    mappings,
    rates,
    corrections,
    snapshots,
    reader,
    wallets,
  );
  const project = await projects.create('anna', {
    name: 'Steuern 2025',
    taxYear: 2025,
    country: 'CH',
    canton: 'ZH',
    notes: '',
  });
  const upload = new UploadProjectFileHandler(
    projects,
    files,
    new FileAnalysisService(reader, mappings),
  );
  const bookingsFile = await upload.execute(
    new UploadProjectFileCommand(
      'anna',
      project.id,
      'buchungen.csv',
      encode(BOOKINGS_CSV),
    ),
  );
  await upload.execute(
    new UploadProjectFileCommand(
      'anna',
      project.id,
      'bestaende.csv',
      encode(HOLDINGS_CSV),
    ),
  );
  await rates.upsertMany(project.id, [
    {
      kind: 'fx',
      asset: 'USD',
      currency: 'CHF',
      date: '2025-12-31',
      value: '0.8',
      source: 'ecb',
    },
    {
      kind: 'fx',
      asset: 'USD',
      currency: 'CHF',
      date: '2025-03-01',
      value: '0.9',
      source: 'ecb',
    },
    {
      kind: 'price',
      asset: 'BTC',
      currency: 'USD',
      date: '2025-12-31',
      value: '90000',
      source: 'binance',
    },
  ]);
  return {
    projects,
    files,
    wallets,
    reader,
    mappings,
    rates,
    corrections,
    snapshots,
    states,
    inputs,
    project,
    bookingsFile,
    calculate: new CalculateProjectHandler(projects, inputs, snapshots),
    result: new GetResultHandler(projects, inputs, snapshots),
    records: new GetFigureRecordsHandler(projects, inputs, snapshots),
    checks: new GetChecksHandler(projects, snapshots, states),
    tick: new UpdateOpenItemHandler(projects, states),
    listCorrections: new ListCorrectionsHandler(
      projects,
      corrections,
      snapshots,
    ),
    createCorrection: new CreateCorrectionHandler(projects, corrections),
    undo: new SetCorrectionUndoneHandler(projects, corrections),
    list: new ListMyProjectsHandler(
      projects,
      snapshots,
      new InMemoryProjectSentRepository(),
    ),
  };
}
