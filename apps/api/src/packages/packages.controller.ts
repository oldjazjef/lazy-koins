import {
  BadRequestException,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  StreamableFile,
} from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiPayloadTooLargeResponse,
  ApiProduces,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import type { AuthenticatedUser } from '../auth/authenticated-user';
import { CurrentUser } from '../auth/current-user.decorator';
import { contentDisposition } from '../common/http/raw-body.middleware';
import { BEARER_SCHEME } from '../openapi/security-schemes';
import type { ImportedAccount } from './application/account-package.service';
import {
  ExportAccountPackageQuery,
  ExportProjectPackageQuery,
  ImportAccountPackageCommand,
  ImportProjectPackageCommand,
  type PackageFile,
} from './application/packages.handlers';
import type { ImportedProject } from './application/project-package.service';

/** Packages are big: a few per account and ten minutes. */
const PACKAGE_BUDGET = { writes: { limit: 20, ttl: 10 * 60_000 } };

function download(file: PackageFile): StreamableFile {
  return new StreamableFile(Buffer.from(file.bytes), {
    type: 'application/zip',
    length: file.bytes.length,
    disposition: contentDisposition(file.fileName),
  });
}

function rawBody(request: Request): Uint8Array {
  const body: unknown = request.body;
  if (!Buffer.isBuffer(body)) {
    throw new BadRequestException('Send the package as the raw request body');
  }
  return new Uint8Array(body);
}

/** Project packages (F10.8 = F1.3) and the account package (F10.9 = F2.3). */
@ApiTags('packages')
@ApiBearerAuth(BEARER_SCHEME)
@Controller()
export class PackagesController {
  constructor(
    private readonly commands: CommandBus,
    private readonly queries: QueryBus,
  ) {}

  @Get('projects/:projectId/package')
  @ApiOperation({
    summary:
      'The project package (.lkproj.zip): originals, mappings, corrections with history, rates, open-item notes, statements, manifest with SHA-256 (F10.8)',
  })
  @ApiProduces('application/zip')
  async projectPackage(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ): Promise<StreamableFile> {
    return download(
      await this.queries.execute<ExportProjectPackageQuery, PackageFile>(
        new ExportProjectPackageQuery(
          user.userId,
          projectId,
          new Date().toISOString(),
        ),
      ),
    );
  }

  @Post('projects/import-package')
  @Throttle(PACKAGE_BUDGET)
  @ApiOperation({
    summary:
      'Import a project package as a new project (F10.8): validated, deduplicated, one transaction',
  })
  @ApiConsumes('application/octet-stream')
  @ApiBody({ schema: { type: 'string', format: 'binary' } })
  @ApiBadRequestResponse({ description: 'Not a project package' })
  @ApiUnprocessableEntityResponse({ description: 'Tampered or invalid' })
  @ApiPayloadTooLargeResponse()
  importProject(
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
  ): Promise<ImportedProject> {
    return this.commands.execute(
      new ImportProjectPackageCommand(user.userId, rawBody(request)),
    );
  }

  @Get('account/package')
  @Throttle(PACKAGE_BUDGET)
  @ApiOperation({
    summary:
      'All my data (F10.9 = F2.3): every project package, mappings, settings and profile — no API keys',
  })
  @ApiProduces('application/zip')
  async accountPackage(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<StreamableFile> {
    return download(
      await this.queries.execute<ExportAccountPackageQuery, PackageFile>(
        new ExportAccountPackageQuery(user.userId, new Date().toISOString()),
      ),
    );
  }

  @Post('account/import-package')
  @Throttle(PACKAGE_BUDGET)
  @ApiOperation({
    summary: 'Import an account package into my account (F10.9)',
  })
  @ApiConsumes('application/octet-stream')
  @ApiBody({ schema: { type: 'string', format: 'binary' } })
  importAccount(
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
  ): Promise<ImportedAccount> {
    return this.commands.execute(
      new ImportAccountPackageCommand(user.userId, rawBody(request)),
    );
  }
}
