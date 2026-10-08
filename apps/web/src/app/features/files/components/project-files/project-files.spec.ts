import type { ProjectFile } from '../../../../core/api/api.types';
import { fileActions, isReadEmpty } from './project-files';

const file = (over: Partial<ProjectFile> = {}): ProjectFile => ({
  id: 'f1',
  sha256: 'a'.repeat(64),
  displayName: 'export.csv',
  kind: 'csv',
  size: 100,
  status: 'mapped',
  platform: 'Kraken',
  mappingId: 'm1',
  mappingName: 'Kraken ledger',
  period: null,
  bookingCount: 3,
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

const visible = (f: ProjectFile, closed = false) =>
  fileActions(f, closed)
    .filter((action) => !action.hidden)
    .map((action) => action.labelKey);

describe('fileActions (the row menu of the files table)', () => {
  it('offers preview, download, assign, deactivate and remove for a read file', () => {
    expect(visible(file())).toEqual([
      'files.actions.preview',
      'files.actions.download',
      'files.actions.assign',
      'files.actions.deactivate',
      'files.actions.remove',
    ]);
    expect(fileActions(file(), false).find((a) => a.id === 'remove')).toEqual(
      expect.objectContaining({ danger: true }),
    );
  });

  it('adds "Mit AI erstellen" for a table without a mapping', () => {
    expect(visible(file({ status: 'needs_mapping' }))).toContain(
      'files.actions.aiMapping',
    );
  });

  it('adds "Mit AI auslesen" for a PDF', () => {
    expect(visible(file({ kind: 'pdf', status: 'evidence_only' }))).toContain(
      'files.actions.aiStatement',
    );
  });

  it('offers "Aktivieren" instead of "Deaktivieren" for a deactivated file (F5.7a)', () => {
    const actions = visible(
      file({ active: false, disabledAt: '2026-02-01T00:00:00.000Z' }),
    );
    expect(actions).toContain('files.actions.activate');
    expect(actions).not.toContain('files.actions.deactivate');
    // Still downloadable and previewable.
    expect(actions).toEqual(
      expect.arrayContaining([
        'files.actions.preview',
        'files.actions.download',
      ]),
    );
  });

  it('hides (de)activation on a closed project (F4.5)', () => {
    expect(visible(file({ active: false }), true)).toEqual([
      'files.actions.preview',
      'files.actions.download',
    ]);
  });

  it('keeps only preview and download while the project is closed (F4.5)', () => {
    expect(visible(file({ status: 'needs_mapping' }), true)).toEqual([
      'files.actions.preview',
      'files.actions.download',
    ]);
  });
});

describe('isReadEmpty (F5.25: "Gelesen – leer")', () => {
  it('is a read file without bookings and balances, never one that still needs a mapping', () => {
    expect(isReadEmpty(file({ bookingCount: 0, holdingCount: 0 }))).toBe(true);
    expect(isReadEmpty(file())).toBe(false);
    expect(
      isReadEmpty(
        file({ status: 'needs_mapping', bookingCount: 0, holdingCount: 0 }),
      ),
    ).toBe(false);
  });
});
