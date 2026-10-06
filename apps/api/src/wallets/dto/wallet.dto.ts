import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { NETWORK_IDS } from '@lazykoins/engine';
import { CHAIN_SERVICES, type ChainService } from '../domain/chain-settings';

/*
 * Lengths are generous on purpose: a seed phrase must reach the F6.2 detection (and be refused
 * with the clear warning) instead of failing a length check first. Validation messages never
 * repeat the value.
 */

export class CreateWalletDto {
  @ApiProperty({ maxLength: 120, example: 'Ledger Nano' })
  @IsString()
  @MaxLength(400)
  label!: string;

  @ApiProperty({
    description:
      'Public address, or a Bitcoin xpub/ypub/zpub. Seed phrases and private keys are refused (F6.2).',
    example: '0x000000000000000000000000000000000000dEaD',
  })
  @IsString()
  @MaxLength(2000)
  address!: string;

  @ApiPropertyOptional({
    enum: NETWORK_IDS,
    isArray: true,
    description: 'Default: every network the address can live on',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  networks?: string[];

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  notes?: string;
}

export class UpdateWalletDto {
  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(400)
  label?: string;

  @ApiPropertyOptional({ enum: NETWORK_IDS, isArray: true })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  networks?: string[];

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  notes?: string;
}

export class InspectAddressDto {
  @ApiProperty()
  @IsString()
  @MaxLength(2000)
  address!: string;
}

export class TokenOverrideDto {
  @ApiProperty({ enum: NETWORK_IDS })
  @IsIn(NETWORK_IDS)
  network!: string;

  @ApiProperty({ description: 'Contract / mint of the token' })
  @IsString()
  @MaxLength(200)
  tokenKey!: string;

  @ApiProperty({ description: 'true = "kein Spam" (F6.6), false = back to the heuristics' })
  @IsBoolean()
  notSpam!: boolean;
}

export class AddProjectWalletDto {
  @ApiProperty()
  @IsString()
  @MaxLength(100)
  walletId!: string;
}

export class ManualBalanceDto {
  @ApiProperty({ enum: NETWORK_IDS })
  @IsString()
  @MaxLength(40)
  network!: string;

  @ApiProperty({ example: 'ADA' })
  @IsString()
  @MaxLength(40)
  asset!: string;

  @ApiProperty({ example: '1234.5', description: 'Decimal string' })
  @IsString()
  @MaxLength(60)
  quantity!: string;

  @ApiPropertyOptional({ example: '2025-12-31', description: 'Default: the project year end' })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  asOf?: string;

  @ApiProperty({ description: 'A PDF of the project (evidence only)' })
  @IsString()
  @MaxLength(100)
  evidenceFileId!: string;

  @ApiPropertyOptional({ maxLength: 300 })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string;
}

class ChainSettingsFields {
  @ApiPropertyOptional({ nullable: true, description: 'Etherscan API V2 key (all EVM chains)' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  etherscanKey?: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Helius API key (Solana)' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  heliusKey?: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Subscan API key (Polkadot)' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  subscanKey?: string | null;

  @ApiPropertyOptional({ description: 'Any Solana JSON-RPC URL; empty = Helius/public' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  solanaRpcUrl?: string;

  @ApiPropertyOptional({ description: 'Esplora API; empty = mempool.space' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  esploraUrl?: string;

  @ApiPropertyOptional({ description: 'Koios API; empty = api.koios.rest' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  koiosUrl?: string;

  @ApiPropertyOptional({ description: 'Cosmos LCD; empty = public endpoint' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  cosmosLcdUrl?: string;
}

export class SaveChainSettingsDto extends ChainSettingsFields {}

export class TestChainServiceDto extends ChainSettingsFields {
  @ApiProperty({ enum: CHAIN_SERVICES })
  @IsIn(CHAIN_SERVICES)
  service!: ChainService;
}
