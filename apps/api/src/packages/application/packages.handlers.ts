import {
  BadRequestException,
  PayloadTooLargeException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  CommandHandler,
  type ICommandHandler,
  type IQueryHandler,
  QueryHandler,
} from '@nestjs/cqrs';
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
  constructor(private readonly packages: ProjectPackageService) {}

  async execute({
    userId,
    bytes,
  }: ImportProjectPackageCommand): Promise<ImportedProject> {
    if (bytes.length === 0) throw new BadRequestException('The file is empty');
    try {
      return await this.packages.import(userId, bytes);
    } catch (error) {
      return toHttp(error);
    }
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
  constructor(private readonly packages: AccountPackageService) {}

  async execute({
    userId,
    bytes,
  }: ImportAccountPackageCommand): Promise<ImportedAccount> {
    if (bytes.length === 0) throw new BadRequestException('The file is empty');
    try {
      return await this.packages.import(userId, bytes);
    } catch (error) {
      return toHttp(error);
    }
  }
}
