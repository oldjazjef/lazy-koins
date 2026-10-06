import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
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
