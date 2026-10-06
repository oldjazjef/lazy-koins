import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipAllThrottles } from '../common/throttling/throttling';
import { Public } from '../auth/public.decorator';
import { HealthResponseDto } from './dto/health-response.dto';

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
    return { status: 'ok', timestamp: new Date().toISOString() };
  }
}
