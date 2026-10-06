import { InMemorySnapshotRepository } from '../../calculation/testing/in-memory-calculation.repositories';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import type { CreateProjectInput } from '../domain/project';
import { InMemoryProjectRepository } from '../testing/in-memory-project.repository';
import { InMemoryProjectSentRepository } from '../testing/in-memory-project-sent.repository';
import {
  CreateProjectCommand,
  CreateProjectHandler,
} from './commands/create-project.command';
import {
  DeleteProjectCommand,
  DeleteProjectHandler,
} from './commands/delete-project.command';
import {
  UpdateProjectCommand,
  UpdateProjectHandler,
} from './commands/update-project.command';
import {
  GetProjectHandler,
  GetProjectQuery,
} from './queries/get-project.query';
import {
  ListMyProjectsHandler,
  ListMyProjectsQuery,
} from './queries/list-my-projects.query';

const INPUT: CreateProjectInput = {
  name: '  Steuern 2025 ',
  taxYear: 2025,
  country: 'CH',
  canton: 'ZH',
  notes: ' ',
};

function setup() {
  const repo = new InMemoryProjectRepository();
  return {
    repo,
    create: new CreateProjectHandler(repo),
    list: new ListMyProjectsHandler(
      repo,
      new InMemorySnapshotRepository(),
      new InMemoryProjectSentRepository(),
    ),
    get: new GetProjectHandler(repo),
    update: new UpdateProjectHandler(repo),
    remove: new DeleteProjectHandler(repo),
  };
}

describe('CreateProjectHandler', () => {
  it('creates an in-progress project for the caller, trimmed', async () => {
    const { create } = setup();
    const project = await create.execute(
      new CreateProjectCommand('anna', INPUT),
    );
    expect(project).toMatchObject({
      ownerId: 'anna',
      name: 'Steuern 2025',
      notes: '',
      status: 'in_progress',
      country: 'CH',
      canton: 'ZH',
    });
  });

  it('refuses a canton the country does not have', async () => {
    const { create } = setup();
    await expect(
      create.execute(
        new CreateProjectCommand('anna', { ...INPUT, canton: 'XX' }),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('ListMyProjectsHandler', () => {
  it('lists only my projects, newest tax year first', async () => {
    const { create, list } = setup();
    await create.execute(
      new CreateProjectCommand('anna', { ...INPUT, taxYear: 2024 }),
    );
    await create.execute(new CreateProjectCommand('anna', INPUT));
    await create.execute(new CreateProjectCommand('bruno', INPUT));

    const mine = await list.execute(new ListMyProjectsQuery('anna'));
    expect(mine.map((project) => project.taxYear)).toEqual([2025, 2024]);
    expect(mine.every((project) => project.ownerId === 'anna')).toBe(true);
  });
});

describe('GetProjectHandler', () => {
  it("returns my project and reads someone else's as 404", async () => {
    const { create, get } = setup();
    const project = await create.execute(
      new CreateProjectCommand('anna', INPUT),
    );
    await expect(
      get.execute(new GetProjectQuery('anna', project.id)),
    ).resolves.toEqual(project);
    await expect(
      get.execute(new GetProjectQuery('bruno', project.id)),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      get.execute(new GetProjectQuery('anna', 'missing')),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('UpdateProjectHandler', () => {
  it('changes name, notes, status and canton', async () => {
    const { create, update } = setup();
    const project = await create.execute(
      new CreateProjectCommand('anna', INPUT),
    );
    const updated = await update.execute(
      new UpdateProjectCommand('anna', project.id, {
        name: ' Steuern 2025 (korrigiert) ',
        notes: 'Kraken fehlt noch',
        status: 'reviewed',
        canton: 'BE',
      }),
    );
    expect(updated).toMatchObject({
      name: 'Steuern 2025 (korrigiert)',
      notes: 'Kraken fehlt noch',
      status: 'reviewed',
      canton: 'BE',
      taxYear: 2025,
    });
  });

  it("refuses someone else's project as 404 and an unknown canton as 400", async () => {
    const { create, update } = setup();
    const project = await create.execute(
      new CreateProjectCommand('anna', INPUT),
    );
    await expect(
      update.execute(
        new UpdateProjectCommand('bruno', project.id, { name: 'Mine' }),
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      update.execute(
        new UpdateProjectCommand('anna', project.id, { canton: 'XX' }),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('keeps a closed project read-only until it is reopened (F4.5)', async () => {
    const { create, update } = setup();
    const project = await create.execute(
      new CreateProjectCommand('anna', INPUT),
    );
    await update.execute(
      new UpdateProjectCommand('anna', project.id, { status: 'closed' }),
    );

    await expect(
      update.execute(
        new UpdateProjectCommand('anna', project.id, { notes: 'late' }),
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    const reopened = await update.execute(
      new UpdateProjectCommand('anna', project.id, { status: 'in_progress' }),
    );
    expect(reopened.status).toBe('in_progress');

    await expect(
      update.execute(
        new UpdateProjectCommand('anna', project.id, { notes: 'now' }),
      ),
    ).resolves.toMatchObject({ notes: 'now' });
  });
});

describe('DeleteProjectHandler', () => {
  it('deletes my open project', async () => {
    const { repo, create, remove } = setup();
    const project = await create.execute(
      new CreateProjectCommand('anna', INPUT),
    );
    await remove.execute(new DeleteProjectCommand('anna', project.id));
    expect(repo.rows.has(project.id)).toBe(false);
  });

  it("refuses someone else's project (404) and a closed one (409)", async () => {
    const { repo, create, update, remove } = setup();
    const project = await create.execute(
      new CreateProjectCommand('anna', INPUT),
    );
    await expect(
      remove.execute(new DeleteProjectCommand('bruno', project.id)),
    ).rejects.toBeInstanceOf(NotFoundException);

    await update.execute(
      new UpdateProjectCommand('anna', project.id, { status: 'closed' }),
    );
    await expect(
      remove.execute(new DeleteProjectCommand('anna', project.id)),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(repo.rows.has(project.id)).toBe(true);
  });
});
