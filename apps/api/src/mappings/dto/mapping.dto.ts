import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsObject, IsOptional } from 'class-validator';
import {
  type ImportMapping,
  MAPPING_ORIGINS,
  type MappingOrigin,
} from '../domain/import-mapping';
import {
  PROJECT_FILE_STATUSES,
  type ProjectFileStatus,
} from '../../files/domain/project-file';
import {
  PROJECT_STATUSES,
  type ProjectStatus,
} from '../../projects/domain/project';
import type {
  MappingSummary,
  MappingUsageProject,
  ProjectMapping,
} from '../application/queries/mapping.queries';

/** `ai` is set by the AI flow (next phase) only, never by a client. */
const CLIENT_ORIGINS = ['manual', 'copied'] as const;

export class CreateMappingDto {
  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description: 'The mapping spec JSON (see GET /api/mappings/schema)',
  })
  @IsObject()
  spec!: Record<string, unknown>;

  @ApiPropertyOptional({
    enum: CLIENT_ORIGINS,
    default: 'manual',
    description: 'manual = written in the editor; copied = uploaded .json',
  })
  @IsOptional()
  @IsIn(CLIENT_ORIGINS)
  origin?: (typeof CLIENT_ORIGINS)[number];
}

export class UpdateMappingDto {
  @ApiProperty({ type: 'object', additionalProperties: true })
  @IsObject()
  spec!: Record<string, unknown>;
}

export class LibraryRefDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() version!: number;
}

export class MappingResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() platform!: string;
  @ApiProperty({ description: 'Normalised header columns, sorted' })
  fingerprint!: string;
  @ApiProperty() version!: number;
  @ApiProperty({ enum: MAPPING_ORIGINS }) origin!: MappingOrigin;
  @ApiProperty({
    type: LibraryRefDto,
    nullable: true,
    description:
      'Origin library: the entry and version this copy was taken from (library:<id>@<version>)',
  })
  library!: LibraryRefDto | null;
  @ApiProperty({ type: 'object', additionalProperties: true })
  spec!: Record<string, unknown>;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ format: 'date-time' }) updatedAt!: string;

  static from(mapping: ImportMapping): MappingResponseDto {
    return {
      id: mapping.id,
      name: mapping.name,
      platform: mapping.platform,
      fingerprint: mapping.fingerprint,
      version: mapping.version,
      origin: mapping.origin,
      library: mapping.library ? { ...mapping.library } : null,
      spec: mapping.spec as unknown as Record<string, unknown>,
      createdAt: mapping.createdAt,
      updatedAt: mapping.updatedAt,
    };
  }
}

export class MappingSummaryResponseDto extends MappingResponseDto {
  @ApiProperty({ description: 'Project files read with it (all my projects)' })
  filesUsing!: number;
  @ApiProperty({ description: 'Projects holding such a file' })
  projectsUsing!: number;

  static fromSummary(summary: MappingSummary): MappingSummaryResponseDto {
    return {
      ...MappingResponseDto.from(summary.mapping),
      filesUsing: summary.filesUsing,
      projectsUsing: summary.projectsUsing,
    };
  }
}

export class MappingUsageFileDto {
  @ApiProperty({ format: 'uuid', description: 'The project file' })
  id!: string;
  @ApiProperty() displayName!: string;
  @ApiProperty({ enum: PROJECT_FILE_STATUSES }) status!: ProjectFileStatus;
}

export class MappingUsageProjectDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() taxYear!: number;
  @ApiProperty({ enum: PROJECT_STATUSES }) status!: ProjectStatus;
  @ApiProperty({ type: [MappingUsageFileDto] }) files!: MappingUsageFileDto[];

  static from(project: MappingUsageProject): MappingUsageProjectDto {
    return {
      id: project.id,
      name: project.name,
      taxYear: project.taxYear,
      status: project.status,
      files: project.files.map((file) => ({ ...file })),
    };
  }
}

export class UpdatedMappingResponseDto {
  @ApiProperty({ type: MappingResponseDto }) mapping!: MappingResponseDto;
  @ApiProperty({
    description:
      'Files read with this mapping — re-apply with POST /mappings/:id/reapply',
  })
  filesUsing!: number;
}

export class ReapplyResponseDto {
  @ApiProperty() reapplied!: number;
  @ApiProperty({
    description: 'Files in closed projects, left as they were (F4.5)',
  })
  skippedClosed!: number;
}

export class MappingFileDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() displayName!: string;
}

export class ProjectMappingResponseDto {
  @ApiProperty({ type: MappingResponseDto }) mapping!: MappingResponseDto;
  @ApiProperty({ type: [MappingFileDto] }) files!: MappingFileDto[];

  static from(entry: ProjectMapping): ProjectMappingResponseDto {
    return {
      mapping: MappingResponseDto.from(entry.mapping),
      files: entry.files.map((file) => ({ ...file })),
    };
  }
}
