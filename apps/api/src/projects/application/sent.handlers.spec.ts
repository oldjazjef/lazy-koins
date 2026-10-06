import { BadRequestException, NotFoundException } from '@nestjs/common';
import { InMemorySnapshotRepository } from '../../calculation/testing/in-memory-calculation.repositories';
import { InMemoryProjectExportRepository } from '../../exports/testing/in-memory-project-export.repository';
import {
  changesSinceSent,
  manualSentAt,
  NO_CHANGES,
  type ProjectChangeFacts,
} from '../domain/project-sent';
import { InMemoryProjectRepository } from '../testing/in-memory-project.repository';
import { InMemoryProjectSentRepository } from '../testing/in-memory-project-sent.repository';
import {
  ListMyProjectsHandler,
  ListMyProjectsQuery,
} from './queries/list-my-projects.query';
import {
  GetProjectSentHandler,
  GetProjectSentQuery,
  MarkProjectSentCommand,
  MarkProjectSentHandler,
  UndoProjectSentCommand,
  UndoProjectSentHandler,
} from './sent.handlers';

const NOW = new Date('2026-10-06T12:00:00.000Z');
const SENT = '2026-10-01T10:00:00.000Z';

const facts = (over: Partial<ProjectChangeFacts> = {}): ProjectChangeFacts => ({
  ...NO_CHANGES,
  ...over,
});

describe('changesSinceSent (F4.7 "seit dem Versand geändert")', () => {
  const state = { sentAt: SENT, exportIds: ['e1'], snapshotHash: 'h1' };

  it('is unchanged when nothing happened afterwards', () => {
    expect(
      changesSinceSent(
        state,
        facts({
          latestSnapshot: {
            createdAt: '2026-09-30T00:00:00.000Z',
            inputHash: 'h0',
          },
          exports: [{ id: 'e1', createdAt: '2026-09-30T00:00:00.000Z' }],
          lastCorrectionAt: '2026-09-29T00:00:00.000Z',
          lastFileAddedAt: '2026-09-28T00:00:00.000Z',
        }),
      ),
    ).toEqual([]);
  });

  it('flags a newer calculation only when its input differs', () => {
    const later = '2026-10-02T00:00:00.000Z';
    expect(
      changesSinceSent(
        state,
        facts({ latestSnapshot: { createdAt: later, inputHash: 'h1' } }),
      ),
    ).toEqual([]);
    expect(
      changesSinceSent(
        state,
        facts({ latestSnapshot: { createdAt: later, inputHash: 'h2' } }),
      ),
    ).toEqual(['calculation']);
  });

  it('flags new statements that were not sent, corrections and files', () => {
    const later = '2026-10-02T00:00:00.000Z';
    expect(
      changesSinceSent(
        state,
        facts({
          exports: [
            { id: 'e1', createdAt: later },
            { id: 'e2', createdAt: later },
          ],
          lastCorrectionAt: later,
          lastFileAddedAt: later,
        }),
      ),
    ).toEqual(['export', 'correction', 'file']);
  });

  it('dates a manual mark: today = now, an earlier day = its end', () => {
    expect(manualSentAt('2026-10-06', NOW)).toBe(NOW.toISOString());
    expect(manualSentAt('2026-09-15', NOW)).toBe('2026-09-15T21:59:59.999Z');
  });
});

async function setup() {
  const projects = new InMemoryProjectRepository();
  const sent = new InMemoryProjectSentRepository();
  const exports = new InMemoryProjectExportRepository();
  const project = await projects.create('anna', {
    name: 'Steuern 2025',
    taxYear: 2025,
    country: 'CH',
    canton: 'ZH',
    notes: '',
  });
  return {
    projects,
    sent,
    exports,
    project,
    get: new GetProjectSentHandler(projects, sent),
    mark: new MarkProjectSentHandler(projects, sent, exports),
    undo: new UndoProjectSentHandler(projects, sent),
    list: new ListMyProjectsHandler(
      projects,
      new InMemorySnapshotRepository(),
      sent,
    ),
  };
}

describe('F4.7 handlers', () => {
  it('marks by hand, shows it in the list, and undoes it', async () => {
    const t = await setup();
    const own = await t.exports.create(t.project.id, {
      kind: 'simple_pdf',
      fileName: 'a.pdf',
      bytes: new Uint8Array(1),
      snapshotId: null,
      wealthChf: '0',
      incomeChf: '0',
    });
    t.sent.facts.set(
      t.project.id,
      facts({
        latestSnapshot: {
          createdAt: '2026-09-01T00:00:00.000Z',
          inputHash: 'h1',
        },
      }),
    );
    const view = await t.mark.execute(
      new MarkProjectSentCommand(
        'anna',
        t.project.id,
        {
          date: '2026-09-15',
          via: 'post',
          note: ' eingeschrieben ',
          to: ' Treuhand AG ',
          exportIds: [own.id, 'someone-elses', own.id],
        },
        NOW,
      ),
    );
    expect(view).toEqual({
      sent: {
        sentAt: '2026-09-15T21:59:59.999Z',
        sentTo: 'Treuhand AG',
        via: 'post',
        note: 'eingeschrieben',
        exportIds: [own.id],
        mailLogId: null,
        snapshotHash: 'h1',
      },
      changes: [],
    });

    const [listed] = await t.list.execute(new ListMyProjectsQuery('anna'));
    expect(listed?.sent).toEqual({
      sentAt: '2026-09-15T21:59:59.999Z',
      via: 'post',
      changedSince: false,
    });

    // A correction after the sent date: "seit dem Versand geändert".
    t.sent.facts.set(
      t.project.id,
      facts({
        latestSnapshot: {
          createdAt: '2026-09-01T00:00:00.000Z',
          inputHash: 'h1',
        },
        lastCorrectionAt: '2026-10-01T00:00:00.000Z',
      }),
    );
    await expect(
      t.get.execute(new GetProjectSentQuery('anna', t.project.id)),
    ).resolves.toMatchObject({ changes: ['correction'] });
    const [changed] = await t.list.execute(new ListMyProjectsQuery('anna'));
    expect(changed?.sent?.changedSince).toBe(true);

    await expect(
      t.undo.execute(new UndoProjectSentCommand('anna', t.project.id)),
    ).resolves.toEqual({ sent: null, changes: [] });
    const [undone] = await t.list.execute(new ListMyProjectsQuery('anna'));
    expect(undone?.sent).toBeNull();
  });

  it('refuses future and malformed dates', async () => {
    const t = await setup();
    for (const date of ['2026-10-07', '2026-13-45x', 'gestern']) {
      await expect(
        t.mark.execute(
          new MarkProjectSentCommand(
            'anna',
            t.project.id,
            { date, via: 'mail', note: '', to: '', exportIds: [] },
            NOW,
          ),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    }
  });

  it('works on a closed project (sending the final statement) but not on foreign ones', async () => {
    const t = await setup();
    await t.projects.update(t.project.id, { status: 'closed' });
    await expect(
      t.mark.execute(
        new MarkProjectSentCommand(
          'anna',
          t.project.id,
          {
            date: '2026-10-06',
            via: 'personal',
            note: '',
            to: '',
            exportIds: [],
          },
          NOW,
        ),
      ),
    ).resolves.toMatchObject({ sent: { via: 'personal' } });
    await expect(
      t.get.execute(new GetProjectSentQuery('bruno', t.project.id)),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      t.undo.execute(new UndoProjectSentCommand('bruno', t.project.id)),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
