import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { HINT_SEVERITIES } from '@lazykoins/engine';
import {
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import {
  HINT_NOTE_MAX,
  HINT_STATUSES,
  type HintStatus,
  PROJECT_HINT_KINDS,
} from '../domain/project-hint';

export class ProjectHintDto {
  @ApiProperty({ description: 'Stable key — dismissals are stored under it' })
  key!: string;
  @ApiProperty({ enum: PROJECT_HINT_KINDS }) kind!: string;
  @ApiProperty({ enum: HINT_SEVERITIES }) severity!: string;
  @ApiProperty({ type: String, nullable: true }) platform!: string | null;
  @ApiProperty({ description: "'' = the whole platform (or a file)" })
  accountId!: string;
  @ApiProperty({ type: [String] }) accounts!: string[];
  @ApiProperty({ type: String, nullable: true, format: 'date' })
  date!: string | null;
  @ApiProperty({
    description: 'The account is empty after its last booking (info only)',
  })
  zeroBalance!: boolean;
  @ApiProperty({ description: 'i18n key with the help text' })
  hintKey!: string;
  @ApiProperty({ type: String, nullable: true, format: 'uuid' })
  fileId!: string | null;
  @ApiProperty({ type: String, nullable: true }) fileName!: string | null;
  @ApiProperty({ type: Number, nullable: true }) count!: number | null;
  @ApiProperty({ enum: HINT_STATUSES }) status!: string;
  @ApiProperty() note!: string;
}

export class ProjectHintsResponseDto {
  @ApiProperty() taxYear!: number;
  @ApiProperty({ type: [ProjectHintDto] }) hints!: ProjectHintDto[];
  @ApiProperty({ description: 'Hints neither done nor ignored' })
  open!: number;
}

export class UpdateHintStateDto {
  @ApiProperty({ description: 'The hint key' })
  @IsString()
  @MinLength(1)
  @MaxLength(600)
  key!: string;

  @ApiProperty({
    enum: HINT_STATUSES,
    description: 'open = "Wieder öffnen" (removes the stored state)',
  })
  @IsIn(HINT_STATUSES)
  status!: HintStatus;

  @ApiPropertyOptional({ maxLength: HINT_NOTE_MAX })
  @IsOptional()
  @IsString()
  @MaxLength(HINT_NOTE_MAX)
  note?: string;
}

export class HintStateResponseDto {
  @ApiProperty() key!: string;
  @ApiProperty({ enum: HINT_STATUSES }) status!: string;
  @ApiProperty() note!: string;
}
