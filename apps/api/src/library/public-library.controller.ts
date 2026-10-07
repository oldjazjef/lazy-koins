import {
  type CanActivate,
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Injectable,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { QueryBus } from '@nestjs/cqrs';
import {
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
} from '@nestjs/swagger';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { Public } from '../auth/public.decorator';
import { AllowWhileLocked } from '../pin/pin-lock.guard';
import { LibraryRuntime } from './application/library-runtime';
import {
  PublicLibraryEntryQuery,
  PublicLibraryMatchQuery,
  PublicLibraryPageQuery,
} from './application/public-library.handlers';
import type {
  HeaderMatchRequest,
  PublicLibraryEntry,
  PublicLibraryEntryDetail,
  PublicLibraryPage,
  PublicLibrarySearch,
} from './domain/public-library';
import {
  PublicLibraryEntryDetailDto,
  PublicLibraryEntryDto,
  PublicLibraryMatchDto,
  PublicLibraryMatchesDto,
  PublicLibraryPageDto,
  PublicLibraryQueryDto,
} from './dto/public-library.dto';

/** Thin façade over the query bus (F5.18). */
@Injectable()
export class PublicLibraryService {
  constructor(private readonly queries: QueryBus) {}

  page(search: PublicLibrarySearch): Promise<PublicLibraryPage> {
    return this.queries.execute(new PublicLibraryPageQuery(search));
  }

  entry(id: string): Promise<PublicLibraryEntryDetail> {
    return this.queries.execute(new PublicLibraryEntryQuery(id));
  }

  match(request: HeaderMatchRequest): Promise<PublicLibraryEntry[]> {
    return this.queries.execute(new PublicLibraryMatchQuery(request));
  }
}

/** Off (desktop, `LIBRARY_PUBLIC=false`): 404 before anything else looks at the request. */
@Injectable()
export class PublicLibraryEnabledGuard implements CanActivate {
  constructor(private readonly runtime: LibraryRuntime) {}

  canActivate(): boolean {
    this.runtime.assertPublic();
    return true;
  }
}

/** Per IP: reads (cacheable) and match requests (each runs the engine over every entry). */
const READ_BUDGET = { default: { limit: 60, ttl: 60_000 } };
const MATCH_BUDGET = { default: { limit: 30, ttl: 60_000 } };

/**
 * F5.18: the mapping library for installed desktop apps — **public and read-only**, no login.
 * Entries are already pseudonymous and privacy-reviewed when published; the answers are an
 * allow-list (`public-library.ts`): never an author id, e-mail or user id; deleted entries do not
 * exist here. Own per-IP budgets (the account budget does not apply — there is no account), GETs
 * cacheable for a minute. 404 on the desktop and with `LIBRARY_PUBLIC=false`.
 */
@ApiTags('library')
@Public()
@AllowWhileLocked()
@SkipThrottle({ writes: true })
@UseGuards(PublicLibraryEnabledGuard)
@Controller('public/library')
export class PublicLibraryController {
  constructor(private readonly library: PublicLibraryService) {}

  @Get()
  @Throttle(READ_BUDGET)
  @Header('Cache-Control', 'public, max-age=60')
  @ApiOperation({
    summary:
      'Public, read-only: one page of the mapping library (F5.18) — pseudonyms only',
  })
  @ApiOkResponse({ type: PublicLibraryPageDto })
  @ApiNotFoundResponse({ description: 'The public library is switched off' })
  @ApiTooManyRequestsResponse()
  async page(
    @Query() query: PublicLibraryQueryDto,
  ): Promise<PublicLibraryPageDto> {
    return PublicLibraryPageDto.from(
      await this.library.page({
        search: query.search,
        platform: query.platform,
        sort: query.sort,
        offset: query.offset,
        limit: query.limit,
      }),
    );
  }

  @Post('match')
  @HttpCode(200)
  @Throttle(MATCH_BUDGET)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary:
      'Public, read-only: entries that would read a file with this header row + file name (nothing is stored)',
  })
  @ApiOkResponse({ type: PublicLibraryMatchesDto })
  @ApiNotFoundResponse({ description: 'The public library is switched off' })
  @ApiTooManyRequestsResponse()
  async match(
    @Body() dto: PublicLibraryMatchDto,
  ): Promise<PublicLibraryMatchesDto> {
    return {
      items: (
        await this.library.match({
          fileName: dto.fileName,
          headers: dto.headers,
        })
      ).map(PublicLibraryEntryDto.from),
    };
  }

  @Get(':id')
  @Throttle(READ_BUDGET)
  @Header('Cache-Control', 'public, max-age=60')
  @ApiOperation({
    summary: 'Public, read-only: one entry with its mapping spec (F5.18)',
  })
  @ApiOkResponse({ type: PublicLibraryEntryDetailDto })
  @ApiNotFoundResponse({ description: 'Missing, deleted, or switched off' })
  @ApiTooManyRequestsResponse()
  async entry(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PublicLibraryEntryDetailDto> {
    return PublicLibraryEntryDetailDto.fromDetail(await this.library.entry(id));
  }
}
