import { ApiProperty } from '@nestjs/swagger';

export class HealthResponseDto {
  @ApiProperty({ example: 'ok' }) status!: 'ok';
  @ApiProperty({ format: 'date-time' }) timestamp!: string;
}
