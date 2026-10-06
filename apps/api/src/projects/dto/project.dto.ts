import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  COUNTRIES,
  type Country,
  MAX_TAX_YEAR,
  MIN_TAX_YEAR,
  type Project,
  PROJECT_STATUSES,
  type ProjectStatus,
} from '../domain/project';

const CANTON = /^[A-Z]{2}$/;
const NAME_MAX = 120;
const NOTES_MAX = 5000;

export class CreateProjectDto {
  @ApiProperty({ example: 'Steuern 2025', maxLength: NAME_MAX })
  @IsString()
  @Matches(/\S/, { message: 'name must not be blank' })
  @MaxLength(NAME_MAX)
  name!: string;

  @ApiProperty({ example: 2025, minimum: MIN_TAX_YEAR, maximum: MAX_TAX_YEAR })
  @IsInt()
  @Min(MIN_TAX_YEAR)
  @Max(MAX_TAX_YEAR)
  taxYear!: number;

  @ApiProperty({ enum: COUNTRIES, example: 'CH' })
  @IsIn(COUNTRIES)
  country!: Country;

  @ApiProperty({ example: 'ZH', description: 'Two-letter canton code' })
  @IsString()
  @Matches(CANTON, { message: 'canton must be a two-letter code like ZH' })
  canton!: string;

  @ApiPropertyOptional({ maxLength: NOTES_MAX })
  @IsOptional()
  @IsString()
  @MaxLength(NOTES_MAX)
  notes?: string;
}

/** Year and country are fixed once the project exists. */
export class UpdateProjectDto {
  @ApiPropertyOptional({ maxLength: NAME_MAX })
  @IsOptional()
  @IsString()
  @Matches(/\S/, { message: 'name must not be blank' })
  @MaxLength(NAME_MAX)
  name?: string;

  @ApiPropertyOptional({ maxLength: NOTES_MAX })
  @IsOptional()
  @IsString()
  @MaxLength(NOTES_MAX)
  notes?: string;

  @ApiPropertyOptional({
    enum: PROJECT_STATUSES,
    description:
      'A closed project accepts only a change of status (reopening); anything else is 409',
  })
  @IsOptional()
  @IsIn(PROJECT_STATUSES)
  status?: ProjectStatus;

  @ApiPropertyOptional({ example: 'BE' })
  @IsOptional()
  @IsString()
  @Matches(CANTON, { message: 'canton must be a two-letter code like ZH' })
  canton?: string;
}

export class ProjectResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() taxYear!: number;
  @ApiProperty({ enum: COUNTRIES }) country!: Country;
  @ApiProperty() canton!: string;
  @ApiProperty({ enum: PROJECT_STATUSES }) status!: ProjectStatus;
  @ApiProperty() notes!: string;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ format: 'date-time' }) updatedAt!: string;

  static from(project: Project): ProjectResponseDto {
    const { ownerId: _ownerId, ...fields } = project;
    return fields;
  }
}
