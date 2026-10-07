import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { AUTO_LOCK_MINUTES } from '../domain/pin';
import type {
  PinReset,
  PinStatus,
  PinUnlocked,
} from '../application/pin.handlers';

const PIN = /^\d{4,8}$/;
const PIN_MESSAGE = 'must be 4 to 8 digits';

export class UnlockDto {
  @ApiProperty({ example: '1234', description: '4–8 digits' })
  @IsString()
  @Matches(PIN, { message: `pin ${PIN_MESSAGE}` })
  pin!: string;
}

export class SetPinDto {
  @ApiProperty({ example: '1234', description: 'The new PIN, 4–8 digits' })
  @IsString()
  @Matches(PIN, { message: `pin ${PIN_MESSAGE}` })
  pin!: string;

  @ApiPropertyOptional({ description: 'Required when a PIN is already set' })
  @IsOptional()
  @IsString()
  @Matches(PIN, { message: `currentPin ${PIN_MESSAGE}` })
  currentPin?: string;

  @ApiPropertyOptional({
    minimum: AUTO_LOCK_MINUTES.min,
    maximum: AUTO_LOCK_MINUTES.max,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(AUTO_LOCK_MINUTES.min)
  @Max(AUTO_LOCK_MINUTES.max)
  autoLockMinutes?: number;
}

export class RemovePinDto {
  @ApiProperty({ description: 'The current PIN' })
  @IsString()
  @Matches(PIN, { message: `currentPin ${PIN_MESSAGE}` })
  currentPin!: string;
}

export class AutoLockDto {
  @ApiProperty({
    minimum: AUTO_LOCK_MINUTES.min,
    maximum: AUTO_LOCK_MINUTES.max,
  })
  @Type(() => Number)
  @IsInt()
  @Min(AUTO_LOCK_MINUTES.min)
  @Max(AUTO_LOCK_MINUTES.max)
  minutes!: number;
}

export class ForgotPinDto {
  @ApiPropertyOptional({
    description:
      'Desktop: confirms that every stored key (AI, mail, CoinGecko, Etherscan) is cleared',
  })
  @IsOptional()
  @IsBoolean()
  confirmClearKeys?: boolean;
}

export class PinStatusDto {
  @ApiProperty({ enum: ['desktop', 'web'] }) mode!: 'desktop' | 'web';
  @ApiProperty() hasPin!: boolean;
  @ApiProperty() required!: boolean;
  @ApiProperty() unlocked!: boolean;
  @ApiProperty({ nullable: true, type: String }) expiresAt!: string | null;
  @ApiProperty() autoLockMinutes!: number;
  @ApiProperty() failedAttempts!: number;
  @ApiProperty() retryAfterSeconds!: number;
  @ApiProperty() reloginRequired!: boolean;
  @ApiProperty({ nullable: true, type: Number }) maxFailures!: number | null;

  static from(status: PinStatus): PinStatusDto {
    return { ...status };
  }
}

export class UnlockGrantDto {
  @ApiProperty({ description: 'Send it as x-lazykoins-unlock' }) token!: string;
  @ApiProperty() expiresAt!: string;
}

export class PinUnlockedDto {
  @ApiProperty({ type: PinStatusDto }) status!: PinStatusDto;
  @ApiProperty({ type: UnlockGrantDto }) unlock!: UnlockGrantDto;

  static from(result: PinUnlocked): PinUnlockedDto {
    return { status: { ...result.status }, unlock: { ...result.unlock } };
  }
}

export class PinResetDto {
  @ApiProperty({ type: PinStatusDto }) status!: PinStatusDto;
  @ApiProperty({
    nullable: true,
    description: 'Desktop: which stored keys were removed',
    type: 'object',
    additionalProperties: { type: 'boolean' },
  })
  erasedKeys!: Record<string, boolean> | null;

  static from(result: PinReset): PinResetDto {
    return {
      status: { ...result.status },
      erasedKeys: result.erasedKeys ? { ...result.erasedKeys } : null,
    };
  }
}
