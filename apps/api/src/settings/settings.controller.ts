import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
} from '@nestjs/common';
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
  PriceSourceParamsDto,
  PriceSourcesResponseDto,
  PriceSourceTestResponseDto,
  SettingsResponseDto,
  TestKeyDto,
  UpdateSettingsDto,
} from './dto/settings.dto';
import { SettingsService } from './settings.service';

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
        priceSources: dto.priceSources,
      }),
    );
  }

  @Get('price-sources')
  @ApiOperation({
    summary:
      'Price sources: the crypto price providers in my order — on/off, what each offers, key hints (never a key)',
  })
  @ApiOkResponse({ type: PriceSourcesResponseDto })
  async priceSources(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PriceSourcesResponseDto> {
    return PriceSourcesResponseDto.from(
      await this.settings.priceSources(user.userId),
    );
  }

  @Post('price-sources/:provider/test')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Test one price provider — plan, history depth or the error; with the typed key (never stored) or the stored one',
  })
  @ApiOkResponse({ type: PriceSourceTestResponseDto })
  @ApiConflictResponse({ description: '`noKey` or `offline`' })
  async testPriceSource(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: PriceSourceParamsDto,
    @Body() dto: TestKeyDto,
  ): Promise<PriceSourceTestResponseDto> {
    return {
      ...(await this.settings.testPriceSource(
        user.userId,
        params.provider,
        dto.key,
      )),
    };
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
