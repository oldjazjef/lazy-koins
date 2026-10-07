import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { COIN_PROVIDERS, type CoinProvider } from '../domain/coin-choice';

export class CoinSearchQueryDto {
  @ApiPropertyOptional({ enum: COIN_PROVIDERS, default: 'coingecko' })
  @IsOptional()
  @IsIn(COIN_PROVIDERS)
  provider?: CoinProvider;

  @ApiProperty({
    description: 'Symbol, name or id (1–60 characters)',
    example: 'OPN',
  })
  @IsString()
  @MaxLength(60)
  q!: string;
}

/** A coin at a provider: `{ provider, id }` (CoinGecko ids like `open-ticketing-ecosystem`). */
export class CoinRefDto {
  @ApiProperty({ enum: COIN_PROVIDERS })
  @IsIn(COIN_PROVIDERS)
  provider!: CoinProvider;

  @ApiProperty({ example: 'open-ticketing-ecosystem' })
  @IsString()
  @MaxLength(100)
  id!: string;
}

export class ChooseCoinDto extends CoinRefDto {
  @ApiProperty({ description: "The project's asset (ticker)", example: 'OPN' })
  @IsString()
  @Matches(/^[A-Za-z0-9.]{1,40}$/)
  asset!: string;
}

export class CoinCandidateDto {
  @ApiProperty({ enum: COIN_PROVIDERS }) provider!: CoinProvider;
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ description: 'Upper case' }) symbol!: string;
  @ApiProperty({ nullable: true, type: Number }) marketCapRank!: number | null;
}

export class CoinSearchResponseDto {
  @ApiProperty({ enum: COIN_PROVIDERS }) provider!: CoinProvider;
  @ApiProperty() query!: string;
  @ApiProperty({ type: [CoinCandidateDto] }) coins!: CoinCandidateDto[];
  @ApiProperty({
    nullable: true,
    type: String,
    description: 'Built-in id for the symbol',
  })
  suggested!: string | null;
  @ApiProperty({ description: 'The ticker stands for several coins' })
  ambiguous!: boolean;
}

export class CoinChoiceDto {
  @ApiProperty({ enum: COIN_PROVIDERS }) provider!: CoinProvider;
  @ApiProperty() id!: string;
  @ApiProperty({ nullable: true, type: String }) name!: string | null;
  @ApiProperty({ nullable: true, type: String }) symbol!: string | null;
}

export class CoinChoiceResponseDto {
  @ApiProperty() symbol!: string;
  @ApiProperty({ type: CoinChoiceDto, nullable: true })
  choice!: CoinChoiceDto | null;
  @ApiProperty({
    description:
      'Every choice of the user: symbol → { provider, id, name, symbol }',
    type: 'object',
    additionalProperties: { type: 'object' },
  })
  choices!: Record<string, CoinChoiceDto>;
  @ApiProperty({
    description: 'Fetched rows removed: open projects + the rate cache',
    type: 'object',
    properties: {
      projectRates: { type: 'number' },
      userRates: { type: 'number' },
    },
  })
  removed!: { projectRates: number; userRates: number };
}

export class ChooseCoinResponseDto extends CoinChoiceResponseDto {
  @ApiProperty({
    description: "This asset's refetch (status, source, points)",
    type: 'object',
    properties: {
      status: { type: 'string' },
      source: { type: 'string', nullable: true },
      points: { type: 'number' },
    },
  })
  fetch!: { status: string; source: string | null; points: number };
}
