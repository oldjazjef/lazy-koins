import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { MappingPreviewResponseDto } from '../../files/dto/project-file.dto';
import { PROJECT_FILE_STATUSES } from '../../files/domain/project-file';
import { MappingResponseDto } from '../../mappings/dto/mapping.dto';
import type {
  StandardMappingView,
  SuggestionPreview,
  TakenStandardMapping,
} from '../application/suggestions.handlers';
import {
  type FileSuggestions,
  type LibrarySuggestionState,
  type MappingSuggestion,
  type ProjectSuggestions,
  SUGGESTION_SOURCES,
  type SuggestionSource,
} from '../domain/suggestion';

export class StandardMappingResponseDto {
  @ApiProperty({ example: 'kraken-ledger' }) id!: string;
  @ApiProperty({ description: 'Catalogue revision of this entry' })
  revision!: number;
  @ApiProperty() name!: string;
  @ApiProperty() platform!: string;
  @ApiProperty({ type: String, nullable: true }) description!: string | null;
  @ApiProperty({ description: 'Normalised header columns, sorted' })
  fingerprint!: string;
  @ApiProperty({
    type: String,
    nullable: true,
    format: 'uuid',
    description: 'My identical copy, if I took it already',
  })
  copyId!: string | null;

  static from(view: StandardMappingView): StandardMappingResponseDto {
    return {
      id: view.entry.id,
      revision: view.entry.revision,
      name: view.entry.name,
      platform: view.entry.platform,
      description: view.entry.description,
      fingerprint: view.entry.fingerprint,
      copyId: view.copyId,
    };
  }
}

export class StandardMappingDetailResponseDto extends StandardMappingResponseDto {
  @ApiProperty({ type: 'object', additionalProperties: true })
  spec!: Record<string, unknown>;

  static fromDetail(
    view: StandardMappingView,
  ): StandardMappingDetailResponseDto {
    return {
      ...StandardMappingResponseDto.from(view),
      spec: view.entry.spec as unknown as Record<string, unknown>,
    };
  }
}

export class TakeStandardMappingDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description: 'With projectFileId: assign the copy to that file at once',
  })
  @IsOptional()
  @IsUUID()
  projectId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  projectFileId?: string;
}

export class TakenStandardMappingResponseDto {
  @ApiProperty({ type: MappingResponseDto }) mapping!: MappingResponseDto;
  @ApiProperty({ description: 'False = my identical copy was reused' })
  created!: boolean;
  @ApiProperty() revision!: number;
  @ApiProperty({ type: String, nullable: true, format: 'uuid' })
  projectFileId!: string | null;
  @ApiProperty({ enum: PROJECT_FILE_STATUSES, nullable: true })
  fileStatus!: string | null;

  static from(taken: TakenStandardMapping): TakenStandardMappingResponseDto {
    return {
      mapping: MappingResponseDto.from(taken.mapping),
      created: taken.created,
      revision: taken.revision,
      projectFileId: taken.file?.id ?? null,
      fileStatus: taken.file?.status ?? null,
    };
  }
}

export class SuggestionLibraryDto {
  @ApiProperty() version!: number;
  @ApiProperty({ type: String, nullable: true }) authorName!: string | null;
  @ApiProperty({ type: Number, nullable: true }) ratingAverage!: number | null;
  @ApiProperty() ratingCount!: number;
  @ApiProperty() usageCount!: number;
}

export class MappingSuggestionDto {
  @ApiProperty({ enum: SUGGESTION_SOURCES }) source!: SuggestionSource;
  @ApiProperty({
    description:
      'Mapping id (own), catalogue id (standard) or entry id (library)',
  })
  id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() platform!: string;
  @ApiProperty({ type: String, nullable: true }) description!: string | null;
  @ApiProperty({ description: 'Reads the file as it is (one-click take)' })
  reads!: boolean;
  @ApiProperty({ description: 'Share of the fingerprint headers found, 0 … 1' })
  coverage!: number;
  @ApiProperty() matched!: number;
  @ApiProperty() required!: number;
  @ApiProperty({ type: [String] }) missing!: string[];
  @ApiProperty() fileNameMatches!: boolean;
  @ApiProperty() platformInName!: boolean;
  @ApiProperty() score!: number;
  @ApiProperty({ type: Number, nullable: true }) revision!: number | null;
  @ApiProperty({ type: String, nullable: true, format: 'uuid' })
  copyId!: string | null;
  @ApiProperty({ type: SuggestionLibraryDto, nullable: true })
  library!: SuggestionLibraryDto | null;

  static from(suggestion: MappingSuggestion): MappingSuggestionDto {
    return {
      ...suggestion,
      missing: [...suggestion.missing],
      library: suggestion.library ? { ...suggestion.library } : null,
    };
  }
}

export class FileSuggestionsDto {
  @ApiProperty({ format: 'uuid' }) projectFileId!: string;
  @ApiProperty() displayName!: string;
  @ApiProperty({ type: [MappingSuggestionDto] })
  suggestions!: MappingSuggestionDto[];

  static from(file: FileSuggestions): FileSuggestionsDto {
    return {
      projectFileId: file.projectFileId,
      displayName: file.displayName,
      suggestions: file.suggestions.map(MappingSuggestionDto.from),
    };
  }
}

export class ProjectSuggestionsDto {
  @ApiProperty({ type: [FileSuggestionsDto] }) files!: FileSuggestionsDto[];
  @ApiProperty({
    enum: ['used', 'off', 'unavailable'],
    description:
      'Whether the library took part (off: desktop without a link / suggestions off; unavailable: it failed this time)',
  })
  library!: LibrarySuggestionState;

  static from(suggestions: ProjectSuggestions): ProjectSuggestionsDto {
    return {
      files: suggestions.files.map(FileSuggestionsDto.from),
      library: suggestions.library,
    };
  }
}

export class SuggestionPreviewQueryDto {
  @ApiProperty({ enum: SUGGESTION_SOURCES })
  @IsIn(SUGGESTION_SOURCES)
  source!: SuggestionSource;

  @ApiProperty({ description: 'Mapping id, catalogue id or library entry id' })
  @IsString()
  @MaxLength(100)
  id!: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 200, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}

export class SuggestionPreviewResponseDto {
  @ApiProperty({ type: MappingPreviewResponseDto })
  preview!: MappingPreviewResponseDto;
  @ApiProperty({ type: 'object', additionalProperties: { type: 'number' } })
  kindCounts!: Record<string, number>;
  @ApiProperty({ type: 'array', items: { type: 'object' } })
  unknownValues!: { value: string; count: number }[];

  static from(preview: SuggestionPreview): SuggestionPreviewResponseDto {
    return {
      preview: MappingPreviewResponseDto.from(preview),
      kindCounts: { ...preview.kindCounts },
      unknownValues: preview.unknownValues.map((u) => ({ ...u })),
    };
  }
}
