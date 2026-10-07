import {
  BadRequestException,
  Optional,
  PayloadTooLargeException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  CommandHandler,
  type ICommandHandler,
  type IQueryHandler,
  QueryHandler,
} from '@nestjs/cqrs';
import { NotificationService } from '../../notifications/application/notification.service';
import { ProjectNotifications } from '../../notifications/application/project-notifications.service';
import { Topics } from '../../notifications/domain/notification';
import { loadOwnProject } from '../../projects/application/project-access';
import { ProjectRepositoryPort } from '../../projects/ports/project.repository.port';
import { PackageError } from '../domain/package-format';
import {
  type ImportedAccount,
  AccountPackageService,
} from './account-package.service';
import {
  type ImportedProject,
  ProjectPackageService,
} from './project-package.service';

export interface PackageFile {
  readonly fileName: string;
  readonly bytes: Uint8Array;
}

/** A package problem → 413 (size), 400 (not a package) or 422 (tampered / invalid content). */
export function toHttp(error: unknown): never {
  if (error instanceof PackageError) {
    const body = { message: error.message, code: error.code };
    if (error.code === 'tooLarge') throw new PayloadTooLargeException(body);
    if (error.code === 'notZip' || error.code === 'manifest') {
      throw new BadRequestException(body);
    }
    throw new UnprocessableEntityException(body);
  }
  throw error;
}

/**
 * F11.12: a failed package import becomes "Paket-Import fehlgeschlagen" (its code only); a
 * successful one settles it, and the imported projects' conditions (files without mapping,
 * hints …) are raised like after an upload.
 */
async function importNotified<T>(
  userId: string,
  work: () => Promise<T>,
  projectIds: (result: T) => readonly string[],
  notifications: NotificationService | undefined,
  projects: ProjectNotifications | undefined,
): Promise<T> {
  let result: T;
  try {
    result = await work();
  } catch (error) {
    await notifications?.raise(userId, Topics.packageImportFailed(), {
      kind: 'error',
      params: {
        reason: error instanceof PackageError ? error.code : 'unexpected',
      },
      action: {
        labelKey: 'notifications.action.retry',
        route: '/app/projects',
      },
    });
    return toHttp(error);
  }
  await notifications?.resolve(userId, Topics.packageImportFailed());
  for (const projectId of projectIds(result)) {
    await projects?.filesChanged(userId, projectId);
  }
  return result;
}

export class ExportProjectPackageQuery {
  constructor(
    readonly userId: string,
    readonly projectId: string,
    readonly now: string,
  ) {}
}

/** F10.8: the project package (allowed on a closed project — it only reads). */
@QueryHandler(ExportProjectPackageQuery)
export class ExportProjectPackageHandler implements IQueryHandler<
  ExportProjectPackageQuery,
  PackageFile
> {
  constructor(
    private readonly projects: ProjectRepositoryPort,
    private readonly packages: ProjectPackageService,
  ) {}

  async execute({
    userId,
    projectId,
    now,
  }: ExportProjectPackageQuery): Promise<PackageFile> {
    const project = await loadOwnProject(this.projects, userId, projectId);
    return {
      fileName: this.packages.fileName(project),
      bytes: await this.packages.export(project, now),
    };
  }
}

export class ImportProjectPackageCommand {
  constructor(
    readonly userId: string,
    readonly bytes: Uint8Array,
  ) {}
}

@CommandHandler(ImportProjectPackageCommand)
export class ImportProjectPackageHandler implements ICommandHandler<
  ImportProjectPackageCommand,
  ImportedProject
> {
  constructor(
    private readonly packages: ProjectPackageService,
    @Optional() private readonly notifications?: NotificationService,
    @Optional() private readonly projectNotifications?: ProjectNotifications,
  ) {}

  async execute({
    userId,
    bytes,
  }: ImportProjectPackageCommand): Promise<ImportedProject> {
    if (bytes.length === 0) throw new BadRequestException('The file is empty');
    return importNotified(
      userId,
      () => this.packages.import(userId, bytes),
      (imported) => [imported.projectId],
      this.notifications,
      this.projectNotifications,
    );
  }
}

export class ExportAccountPackageQuery {
  constructor(
    readonly userId: string,
    readonly now: string,
  ) {}
}

/** F10.9 = F2.3: all my data, without secrets. */
@QueryHandler(ExportAccountPackageQuery)
export class ExportAccountPackageHandler implements IQueryHandler<
  ExportAccountPackageQuery,
  PackageFile
> {
  constructor(private readonly packages: AccountPackageService) {}

  async execute({
    userId,
    now,
  }: ExportAccountPackageQuery): Promise<PackageFile> {
    return {
      fileName: this.packages.fileName(now),
      bytes: await this.packages.export(userId, now),
    };
  }
}

export class ImportAccountPackageCommand {
  constructor(
    readonly userId: string,
    readonly bytes: Uint8Array,
  ) {}
}

@CommandHandler(ImportAccountPackageCommand)
export class ImportAccountPackageHandler implements ICommandHandler<
  ImportAccountPackageCommand,
  ImportedAccount
> {
  constructor(
    private readonly packages: AccountPackageService,
    @Optional() private readonly notifications?: NotificationService,
    @Optional() private readonly projectNotifications?: ProjectNotifications,
  ) {}

  async execute({
    userId,
    bytes,
  }: ImportAccountPackageCommand): Promise<ImportedAccount> {
    if (bytes.length === 0) throw new BadRequestException('The file is empty');
    return importNotified(
      userId,
      () => this.packages.import(userId, bytes),
      (imported) => imported.projects.map((project) => project.projectId),
      this.notifications,
      this.projectNotifications,
    );
  }
}
