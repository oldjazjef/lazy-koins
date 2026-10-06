import { ApiProperty } from '@nestjs/swagger';

export class HealthResponseDto {
  @ApiProperty({ example: 'ok' }) status!: 'ok';
  @ApiProperty({ format: 'date-time' }) timestamp!: string;
  @ApiProperty({ example: '1.2.3+abc1234' }) version!: string;
}

export class VersionResponseDto {
  @ApiProperty({ example: '1.2.3' }) version!: string;
  @ApiProperty({ example: 'abc1234' }) commit!: string;
  @ApiProperty({ example: '1.2.3+abc1234' }) full!: string;
  @ApiProperty({ format: 'date-time', nullable: true, type: String })
  builtAt!: string | null;
}
