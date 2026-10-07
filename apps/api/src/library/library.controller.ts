import {
  type CanActivate,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Injectable,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { AuthenticatedUser } from '../auth/authenticated-user';
import { CurrentUser } from '../auth/current-user.decorator';
import { BEARER_SCHEME } from '../openapi/security-schemes';
import { LibraryRuntime } from './application/library-runtime';
import {
  LibraryEntryDetailResponseDto,
  LibraryEntryResponseDto,
  LibraryFileMatchesDto,
  LibrarySearchQueryDto,
  PublishLibraryMappingDto,
  PublishReviewResponseDto,
  PublishSourceDto,
  RateLibraryMappingDto,
  TakeLibraryMappingDto,
  TakenLibraryMappingResponseDto,
} from './dto/library.dto';
import {
  LibraryStatusDto,
  RemoteLibrarySettingsDto,
  RemoteLibraryTestDto,
  SaveRemoteLibrarySettingsDto,
  TestRemoteLibraryDto,
} from './dto/remote-library.dto';
import { LibraryService } from './library.service';

/** Per account: publishing (new entries and versions) and rating have tight budgets. */
const PUBLISH_BUDGET = { writes: { limit: 10, ttl: 10 * 60_000 } };
const RATE_BUDGET = { writes: { limit: 60, ttl: 10 * 60_000 } };

/**
 * Desktop (`AUTH_MODE=local`): publishing, reviews, ratings and deletions are a 404, as if they
 * did not exist. Search, entry, take and matches go to the linked web deployment (F5.18).
 */
@Injectable()
export class LibraryEnabledGuard implements CanActivate {
  constructor(private readonly runtime: LibraryRuntime) {}

  canActivate(): boolean {
    this.runtime.assertEnabled();
    return true;
  }
}

const FINDINGS =
  'body.code: privacyFindings (body.findings: path, kind, removable) | specTooLarge';

@ApiTags('library')
@ApiBearerAuth(BEARER_SCHEME)
@Controller('library')
export class LibraryController {
  constructor(private readonly library: LibraryService) {}

  @Get('status')
  @ApiOperation({
    summary:
      'Where the library comes from (F5.18): web = this deployment; remote = the desktop, linked to a web deployment (read-only)',
  })
  @ApiOkResponse({ type: LibraryStatusDto })
  async status(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<LibraryStatusDto> {
    return LibraryStatusDto.from(await this.library.status(user.userId));
  }

  @Get()
  @ApiOperation({
    summary:
      'The mapping library (F5.17): every published mapping, searchable; authors as pseudonyms',
  })
  @ApiOkResponse({ type: [LibraryEntryResponseDto] })
  async search(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: LibrarySearchQueryDto,
  ): Promise<LibraryEntryResponseDto[]> {
    return (
      await this.library.search(user.userId, {
        query: query.q,
        platform: query.platform,
        sort: query.sort,
      })
    ).map(LibraryEntryResponseDto.from);
  }

  @UseGuards(LibraryEnabledGuard)
  @Post('review')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'The review before publishing: the exact public JSON and its privacy findings (nothing stored)',
  })
  @ApiOkResponse({ type: PublishReviewResponseDto })
  @ApiBadRequestResponse({
    description: 'Invalid spec, or not exactly one source',
  })
  @ApiNotFoundResponse({ description: 'Mapping or entry missing, or not mine' })
  async review(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: PublishSourceDto,
  ): Promise<PublishReviewResponseDto> {
    return PublishReviewResponseDto.from(
      await this.library.review(user.userId, dto),
    );
  }

  @UseGuards(LibraryEnabledGuard)
  @Post()
  @Throttle(PUBLISH_BUDGET)
  @ApiOperation({
    summary:
      'Publish one of my mappings or a spec (F5.15) — a new entry, or a new version of mine (libraryId)',
  })
  @ApiCreatedResponse({ type: LibraryEntryResponseDto })
  @ApiBadRequestResponse({ description: 'body.code: confirmationRequired' })
  @ApiUnprocessableEntityResponse({ description: FINDINGS })
  @ApiConflictResponse({ description: 'body.code: alreadyPublished' })
  @ApiTooManyRequestsResponse({ description: 'body.code: publishLimit' })
  @ApiNotFoundResponse()
  async publish(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: PublishLibraryMappingDto,
  ): Promise<LibraryEntryResponseDto> {
    return LibraryEntryResponseDto.from(
      await this.library.publish(user.userId, dto),
    );
  }

  @Get(':id')
  @ApiOkResponse({ type: LibraryEntryDetailResponseDto })
  @ApiNotFoundResponse({ description: 'Missing or deleted' })
  async get(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<LibraryEntryDetailResponseDto> {
    return LibraryEntryDetailResponseDto.fromDetail(
      await this.library.get(user.userId, id),
    );
  }

  @UseGuards(LibraryEnabledGuard)
  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({
    summary:
      'Remove my entry from the library (soft delete); copies others took keep working',
  })
  @ApiNoContentResponse()
  @ApiNotFoundResponse({ description: 'Missing, deleted, or not mine' })
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.library.remove(user.userId, id);
  }

  @UseGuards(LibraryEnabledGuard)
  @Put(':id/rating')
  @Throttle(RATE_BUDGET)
  @ApiOperation({ summary: 'Rate 1–5 stars (F5.17); not my own entry' })
  @ApiOkResponse({ type: LibraryEntryResponseDto })
  @ApiConflictResponse({ description: 'body.code: ownEntry' })
  @ApiNotFoundResponse()
  async rate(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RateLibraryMappingDto,
  ): Promise<LibraryEntryResponseDto> {
    return LibraryEntryResponseDto.from(
      await this.library.rate(user.userId, id, dto.stars),
    );
  }

  @UseGuards(LibraryEnabledGuard)
  @Delete(':id/rating')
  @Throttle(RATE_BUDGET)
  @ApiOperation({ summary: 'Remove my rating' })
  @ApiOkResponse({ type: LibraryEntryResponseDto })
  @ApiNotFoundResponse()
  async unrate(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<LibraryEntryResponseDto> {
    return LibraryEntryResponseDto.from(
      await this.library.rate(user.userId, id, null),
    );
  }

  @Post(':id/take')
  @ApiOperation({
    summary:
      'Take over (F5.16): a private copy in my mappings; with projectId + projectFileId also assigned to that file',
  })
  @ApiCreatedResponse({ type: TakenLibraryMappingResponseDto })
  @ApiNotFoundResponse({
    description: 'Entry, project or file missing / not mine',
  })
  @ApiConflictResponse({ description: 'The project is closed (F4.5)' })
  async take(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: TakeLibraryMappingDto,
  ): Promise<TakenLibraryMappingResponseDto> {
    const target =
      dto.projectId && dto.projectFileId
        ? { projectId: dto.projectId, projectFileId: dto.projectFileId }
        : undefined;
    return TakenLibraryMappingResponseDto.from(
      await this.library.take(user.userId, id, target),
    );
  }
}

@ApiTags('library')
@ApiBearerAuth(BEARER_SCHEME)
@Controller('projects/:projectId/library-matches')
export class ProjectLibraryController {
  constructor(private readonly library: LibraryService) {}

  @Get()
  @ApiOperation({
    summary:
      'Library entries that would read the files of this project that need a mapping (F5.16)',
  })
  @ApiOkResponse({ type: [LibraryFileMatchesDto] })
  @ApiNotFoundResponse({ description: 'Missing, or not mine' })
  async matches(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ): Promise<LibraryFileMatchesDto[]> {
    return (await this.library.matchesForProject(user.userId, projectId)).map(
      LibraryFileMatchesDto.from,
    );
  }
}

/**
 * F5.18, desktop only: Einstellungen › Bibliothek — the link to a web deployment's public
 * mapping library (address, on/off, suggestions) and "Verbindung testen". 404 on the web.
 */
@ApiTags('library')
@ApiBearerAuth(BEARER_SCHEME)
@Controller('settings/library')
export class LibrarySettingsController {
  constructor(private readonly library: LibraryService) {}

  @Get()
  @ApiOkResponse({ type: RemoteLibrarySettingsDto })
  @ApiNotFoundResponse({ description: 'Not the desktop app' })
  async get(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<RemoteLibrarySettingsDto> {
    return RemoteLibrarySettingsDto.from(
      await this.library.remoteSettings(user.userId),
    );
  }

  @Put()
  @ApiOperation({
    summary:
      'Save the link (no network). An empty address switches it off; http only for localhost',
  })
  @ApiOkResponse({ type: RemoteLibrarySettingsDto })
  @ApiUnprocessableEntityResponse({
    description:
      'body.code: libraryUrlInvalid (body.problem: invalidUrl | httpsRequired | credentialsInUrl | tooLong)',
  })
  async save(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: SaveRemoteLibrarySettingsDto,
  ): Promise<RemoteLibrarySettingsDto> {
    return RemoteLibrarySettingsDto.from(
      await this.library.saveRemoteSettings(user.userId, {
        url: dto.url,
        enabled: dto.enabled,
        suggestions: dto.suggestions,
      }),
    );
  }

  @Post('test')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Verbindung testen: one list request to the given (or saved) address — no user data sent',
  })
  @ApiOkResponse({ type: RemoteLibraryTestDto })
  @ApiConflictResponse({
    description: 'body.code: libraryNotConfigured | offline',
  })
  @ApiUnprocessableEntityResponse({
    description: 'body.code: libraryUrlInvalid',
  })
  async test(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: TestRemoteLibraryDto,
  ): Promise<RemoteLibraryTestDto> {
    return RemoteLibraryTestDto.from(
      await this.library.testRemote(user.userId, dto.url),
    );
  }
}
