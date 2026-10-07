import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsString, MaxLength } from 'class-validator';
import { COIN_PROVIDERS, type CoinProvider } from '../domain/coin-choice';

/** `:provider/:id` of `GET /rates/coins/:provider/:id`. */
export class CoinRefParamsDto {
  @ApiProperty({ enum: COIN_PROVIDERS })
  @IsIn(COIN_PROVIDERS)
  provider!: CoinProvider;

  @ApiProperty()
  @IsString()
  @MaxLength(100)
  id!: string;
}
