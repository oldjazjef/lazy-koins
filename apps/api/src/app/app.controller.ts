import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipAllThrottles } from '../common/throttling/throttling';
import { Public } from '../auth/public.decorator';
import { BUILD_INFO } from './build-info';
import {
  HealthResponseDto,
  VersionResponseDto,
} from './dto/health-response.dto';

@ApiTags('meta')
@Controller()
export class AppController {
  @Public()
  @SkipAllThrottles()
  @Get('health')
  @ApiOperation({
    summary: 'Liveness probe',
    description: 'Open endpoint. Does not touch the database.',
  })
  @ApiOkResponse({ type: HealthResponseDto })
  health(): HealthResponseDto {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      version: BUILD_INFO.full,
    };
  }

  @Public()
  @SkipAllThrottles()
  @Get('version')
  @ApiOperation({
    summary: 'Version of this build',
    description:
      'Open endpoint: `X.Y.Z+<commit>`, fixed at build time (scripts/build/version.mjs).',
  })
  @ApiOkResponse({ type: VersionResponseDto })
  version(): VersionResponseDto {
    return { ...BUILD_INFO };
  }
}
