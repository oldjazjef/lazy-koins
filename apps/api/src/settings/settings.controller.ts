import { Body, Controller, Get, HttpCode, Post, Put } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { AuthenticatedUser } from '../auth/authenticated-user';
import { CurrentUser } from '../auth/current-user.decorator';
import { BEARER_SCHEME } from '../openapi/security-schemes';
import {
  KeyCheckResponseDto,
  SettingsResponseDto,
  TestKeyDto,
  UpdateSettingsDto,
} from './dto/settings.dto';
import { SettingsService } from './settings.service';

const SYMBOL = /^[A-Za-z0-9.]{1,40}$/;
const COINGECKO_ID = /^[a-z0-9-]{1,100}$/;

@ApiTags('settings')
@ApiBearerAuth(BEARER_SCHEME)
@Controller('settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  @ApiOperation({ summary: 'My settings (F11); API keys only as hints (F6.7)' })
  @ApiOkResponse({ type: SettingsResponseDto })
  async get(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<SettingsResponseDto> {
    return SettingsResponseDto.from(await this.settings.get(user.userId));
  }

  @Put()
  @ApiOperation({
    summary: 'Change my settings; keys are stored encrypted (AES-256-GCM)',
  })
  @ApiOkResponse({ type: SettingsResponseDto })
  @ApiServiceUnavailableResponse({
    description: 'A key was sent but SETTINGS_ENCRYPTION_KEY is not set',
  })
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateSettingsDto,
  ): Promise<SettingsResponseDto> {
    const coingeckoIds = dto.coingeckoIds
      ? Object.fromEntries(
          Object.entries(dto.coingeckoIds)
            .filter(
              ([symbol, id]) =>
                typeof id === 'string' &&
                SYMBOL.test(symbol) &&
                COINGECKO_ID.test(id),
            )
            .map(([symbol, id]) => [symbol.toUpperCase(), id]),
        )
      : undefined;
    return SettingsResponseDto.from(
      await this.settings.update(user.userId, {
        displayName: dto.displayName,
        canton: dto.canton,
        advisorName: dto.advisorName,
        advisorEmail: dto.advisorEmail,
        locale: dto.locale,
        numberFormat: dto.numberFormat,
        dateFormat: dto.dateFormat,
        onlineRates: dto.onlineRates,
        keys: dto.keys,
        coingeckoIds,
      }),
    );
  }

  @Post('keys/coingecko/test')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Test the CoinGecko key — the typed one (never stored) or the stored one',
  })
  @ApiOkResponse({ type: KeyCheckResponseDto })
  @ApiConflictResponse({ description: '`noKey` or `offline`' })
  async testCoingeckoKey(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: TestKeyDto,
  ): Promise<KeyCheckResponseDto> {
    return { ...(await this.settings.testCoingeckoKey(user.userId, dto.key)) };
  }
}
