import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import {
  CHANGE_REASONS,
  type ChangeReason,
  SENT_VIA,
  type SentVia,
} from '../domain/project-sent';
import type { ProjectSentSummary } from '../application/queries/list-my-projects.query';
import type { ProjectSentView } from '../application/sent.handlers';

export class MarkProjectSentDto {
  @ApiProperty({
    example: '2026-02-15',
    description: 'YYYY-MM-DD, not in the future',
  })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'date must be YYYY-MM-DD' })
  date!: string;

  @ApiProperty({ enum: SENT_VIA })
  @IsIn(SENT_VIA)
  via!: SentVia;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;

  @ApiPropertyOptional({
    description: 'Recipient (name or address)',
    maxLength: 254,
  })
  @IsOptional()
  @IsString()
  @MaxLength(254)
  to?: string;

  @ApiPropertyOptional({
    type: [String],
    description: 'Statements that went out',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  exportIds?: string[];
}

export class ProjectSentStateDto {
  @ApiProperty({ format: 'date-time' }) sentAt!: string;
  @ApiProperty() sentTo!: string;
  @ApiProperty({ enum: SENT_VIA }) via!: SentVia;
  @ApiProperty() note!: string;
  @ApiProperty({ type: [String] }) exportIds!: string[];
  @ApiProperty({ nullable: true, type: String }) mailLogId!: string | null;
}

export class ProjectSentResponseDto {
  @ApiProperty({ type: ProjectSentStateDto, nullable: true })
  sent!: ProjectSentStateDto | null;

  @ApiProperty({
    enum: CHANGE_REASONS,
    isArray: true,
    description: 'Why it is "seit dem Versand geändert"; empty = unchanged',
  })
  changes!: ChangeReason[];

  static from(view: ProjectSentView): ProjectSentResponseDto {
    return {
      sent: view.sent
        ? {
            sentAt: view.sent.sentAt,
            sentTo: view.sent.sentTo,
            via: view.sent.via,
            note: view.sent.note,
            exportIds: [...view.sent.exportIds],
            mailLogId: view.sent.mailLogId,
          }
        : null,
      changes: view.changes,
    };
  }
}

/** F4.7 in the project list. */
export class ProjectSentSummaryDto implements ProjectSentSummary {
  @ApiProperty({ format: 'date-time' }) sentAt!: string;
  @ApiProperty({ enum: SENT_VIA }) via!: SentVia;
  @ApiProperty() changedSince!: boolean;
}
