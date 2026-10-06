import { Body, Controller, Get, HttpCode, Patch, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import type { AuthenticatedUser } from '../auth/authenticated-user';
import { CurrentUser } from '../auth/current-user.decorator';
import { BEARER_SCHEME } from '../openapi/security-schemes';
import { SetupResponseDto, UpdateSetupDto } from './dto/setup.dto';
import { SetupService } from './setup.service';

/** F11.0s: the setup wizard's progress, persisted per user so it can be resumed. */
@ApiTags('setup')
@ApiBearerAuth(BEARER_SCHEME)
@Controller('setup')
export class SetupController {
  constructor(private readonly setup: SetupService) {}

  @Get()
  @ApiOperation({
    summary: 'The wizard: steps with state, what is configured, finished?',
  })
  @ApiOkResponse({ type: SetupResponseDto })
  async get(@CurrentUser() user: AuthenticatedUser): Promise<SetupResponseDto> {
    return SetupResponseDto.from(await this.setup.get(user.userId));
  }

  @Patch()
  @ApiOperation({ summary: 'Step states and the step on screen' })
  @ApiOkResponse({ type: SetupResponseDto })
  @ApiUnprocessableEntityResponse({
    description: '`stepRequired`, `stepIncomplete`, `unknownStep`',
  })
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateSetupDto,
  ): Promise<SetupResponseDto> {
    return SetupResponseDto.from(
      await this.setup.update(user.userId, {
        currentStep: dto.currentStep,
        states: dto.states,
      }),
    );
  }

  @Post('complete')
  @HttpCode(200)
  @ApiOperation({ summary: '"App starten": finish the wizard' })
  @ApiOkResponse({ type: SetupResponseDto })
  @ApiUnprocessableEntityResponse({ description: '`setupIncomplete`' })
  async complete(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<SetupResponseDto> {
    return SetupResponseDto.from(await this.setup.complete(user.userId));
  }
}
