import {
  Body,
  Controller,
  createParamDecorator,
  type ExecutionContext,
  Get,
  HttpCode,
  Post,
  Put,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import type { AuthenticatedUser } from '../auth/authenticated-user';
import { CurrentUser } from '../auth/current-user.decorator';
import { BEARER_SCHEME } from '../openapi/security-schemes';
import type { PinActor } from './application/pin.handlers';
import {
  AutoLockDto,
  ForgotPinDto,
  PinResetDto,
  PinStatusDto,
  PinUnlockedDto,
  RemovePinDto,
  SetPinDto,
  UnlockDto,
} from './dto/pin.dto';
import { AllowWhileLocked, unlockTokenOf } from './pin-lock.guard';
import { PinService } from './pin.service';

/** The request's unlock token (`x-lazykoins-unlock`), if any. */
const UnlockToken = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string | undefined =>
    unlockTokenOf(
      context.switchToHttp().getRequest<{
        headers: Record<string, string | string[] | undefined>;
      }>(),
    ),
);

function actor(user: AuthenticatedUser): PinActor {
  return { userId: user.userId, authTime: user.authTime ?? null };
}

/**
 * F11.0p: the PIN lock. Status, unlock, lock and "forgot" answer while locked; changing the PIN,
 * removing it and the auto-lock time need an unlocked session (the global `PinLockGuard`).
 */
@ApiTags('pin')
@ApiBearerAuth(BEARER_SCHEME)
@Controller('pin')
export class PinController {
  constructor(private readonly pins: PinService) {}

  @Get('status')
  @AllowWhileLocked()
  @ApiOperation({
    summary: 'Is there a PIN, is this session unlocked, how long to wait',
  })
  @ApiOkResponse({ type: PinStatusDto })
  async status(
    @CurrentUser() user: AuthenticatedUser,
    @UnlockToken() token: string | undefined,
  ): Promise<PinStatusDto> {
    return PinStatusDto.from(await this.pins.status(actor(user), token));
  }

  @Post('unlock')
  @HttpCode(200)
  @AllowWhileLocked()
  @ApiOperation({
    summary: 'Unlock with the PIN → a short-lived unlock token (sliding)',
  })
  @ApiOkResponse({ type: PinUnlockedDto })
  @ApiUnprocessableEntityResponse({ description: '`wrongPin` + the wait' })
  @ApiTooManyRequestsResponse({ description: '`pinThrottled`: wait first' })
  @ApiForbiddenResponse({ description: '`reloginRequired` (web)' })
  async unlock(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UnlockDto,
  ): Promise<PinUnlockedDto> {
    return PinUnlockedDto.from(await this.pins.unlock(actor(user), dto.pin));
  }

  @Post('lock')
  @HttpCode(204)
  @AllowWhileLocked()
  @ApiOperation({ summary: 'Lock this session (ends its unlock token)' })
  @ApiNoContentResponse()
  async lock(@UnlockToken() token: string | undefined): Promise<void> {
    await this.pins.lock(token);
  }

  @Post('renew')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Activity without data requests: keeps the session unlocked',
  })
  @ApiOkResponse({ type: PinStatusDto })
  async renew(
    @CurrentUser() user: AuthenticatedUser,
    @UnlockToken() token: string | undefined,
  ): Promise<PinStatusDto> {
    return PinStatusDto.from(await this.pins.status(actor(user), token));
  }

  @Put()
  @ApiOperation({
    summary: 'Set the PIN, or change it (current PIN required); unlocks',
  })
  @ApiOkResponse({ type: PinUnlockedDto })
  @ApiBadRequestResponse({ description: '`currentPinRequired`' })
  async set(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: SetPinDto,
  ): Promise<PinUnlockedDto> {
    return PinUnlockedDto.from(
      await this.pins.set(
        actor(user),
        dto.pin,
        dto.currentPin,
        dto.autoLockMinutes,
      ),
    );
  }

  @Post('remove')
  @HttpCode(200)
  @ApiOperation({ summary: 'Remove the PIN (web only; current PIN required)' })
  @ApiOkResponse({ type: PinStatusDto })
  @ApiConflictResponse({ description: '`pinRequired` on the desktop' })
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: RemovePinDto,
  ): Promise<PinStatusDto> {
    return PinStatusDto.from(
      await this.pins.remove(actor(user), dto.currentPin),
    );
  }

  @Put('auto-lock')
  @ApiOperation({ summary: 'Minutes without activity before the app locks' })
  @ApiOkResponse({ type: PinStatusDto })
  async autoLock(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: AutoLockDto,
    @UnlockToken() token: string | undefined,
  ): Promise<PinStatusDto> {
    return PinStatusDto.from(
      await this.pins.autoLock(actor(user), dto.minutes, token),
    );
  }

  @Post('forgot')
  @HttpCode(200)
  @AllowWhileLocked()
  @ApiOperation({
    summary:
      'PIN vergessen: desktop = reset, clearing every stored key (confirm); web = after a fresh sign-in',
  })
  @ApiOkResponse({ type: PinResetDto })
  @ApiBadRequestResponse({ description: '`confirmationRequired` (desktop)' })
  @ApiForbiddenResponse({ description: '`reloginRequired` (web)' })
  async forgot(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ForgotPinDto,
  ): Promise<PinResetDto> {
    return PinResetDto.from(
      await this.pins.forgot(actor(user), dto.confirmClearKeys === true),
    );
  }
}
