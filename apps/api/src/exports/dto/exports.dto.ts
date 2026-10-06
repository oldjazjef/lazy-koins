import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import {
  EXPORT_KINDS,
  type ExportKind,
  type ProjectExportMeta,
} from '../domain/project-export';

export class CreateExportDto {
  @ApiProperty({ enum: EXPORT_KINDS })
  @IsIn(EXPORT_KINDS)
  kind!: ExportKind;
}

export class ExportResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ enum: EXPORT_KINDS }) kind!: ExportKind;
  @ApiProperty() fileName!: string;
  @ApiProperty() mediaType!: string;
  @ApiProperty() size!: number;
  @ApiProperty({ nullable: true }) snapshotId!: string | null;
  @ApiProperty({ description: 'Decimal string' }) wealthChf!: string;
  @ApiProperty({ description: 'Decimal string' }) incomeChf!: string;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;

  static from(meta: ProjectExportMeta): ExportResponseDto {
    const { projectId: _projectId, ...fields } = meta;
    return fields;
  }
}

export class MailDraftResponseDto {
  @ApiProperty({ description: "The Treuhänder's address from the settings" })
  to!: string;
  @ApiProperty() subject!: string;
  @ApiProperty() body!: string;
}

export class DataExportQueryDto {
  @ApiProperty({ enum: ['csv', 'xlsx'] })
  @IsIn(['csv', 'xlsx'])
  format!: 'csv' | 'xlsx';

  @ApiPropertyOptional({
    enum: ['bookings', 'holdings'],
    description: 'CSV only: which record type (default bookings)',
  })
  @IsOptional()
  @IsIn(['bookings', 'holdings'])
  type?: 'bookings' | 'holdings';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  platform?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  account?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(40)
  asset?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(40) kind?: string;

  @ApiPropertyOptional({ description: 'ISO date, inclusive' })
  @IsOptional()
  @Matches(/^(\d{4}-\d{2}-\d{2})?$/)
  from?: string;

  @ApiPropertyOptional({ description: 'ISO date, inclusive' })
  @IsOptional()
  @Matches(/^(\d{4}-\d{2}-\d{2})?$/)
  to?: string;
}
