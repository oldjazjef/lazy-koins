import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import {
  PRIVACY_FINDING_KINDS,
  type PrivacyFindingKind,
} from '@lazykoins/engine';
import { PROJECT_FILE_STATUSES } from '../../files/domain/project-file';
import { MappingResponseDto } from '../../mappings/dto/mapping.dto';
import type { TakenLibraryMapping } from '../application/library.commands';
import type { LibraryFileMatches } from '../application/library.queries';
import {
  LIBRARY_LIMITS,
  LIBRARY_SORTS,
  type LibraryEntryDetail,
  type LibraryEntryView,
  type LibrarySort,
  type PublishReview,
} from '../domain/library-mapping';

export class LibrarySearchQueryDto {
  @ApiPropertyOptional({ description: 'Searches name, platform, description' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  q?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(40)
  platform?: string;

  @ApiPropertyOptional({ enum: LIBRARY_SORTS, default: 'rating' })
  @IsOptional()
  @IsIn(LIBRARY_SORTS)
  sort?: LibrarySort;
}

/** What to publish: exactly one of `mappingId` / `spec`. */
export class PublishSourceDto {
  @ApiPropertyOptional({ format: 'uuid', description: 'One of my mappings' })
  @IsOptional()
  @IsUUID()
  mappingId?: string;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    description: 'A mapping spec (an uploaded .json)',
  })
  @IsOptional()
  @IsObject()
  spec?: Record<string, unknown>;

  @ApiPropertyOptional({
    type: [String],
    description:
      'JSON Pointers of privacy findings to remove before publishing',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  @MaxLength(500, { each: true })
  remove?: string[];

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Publish a new version of this entry of mine',
  })
  @IsOptional()
  @IsUUID()
  libraryId?: string;
}

export class PublishLibraryMappingDto extends PublishSourceDto {
  @ApiPropertyOptional({ maxLength: LIBRARY_LIMITS.maxDescription })
  @IsOptional()
  @ValidateIf((_dto, value) => value !== null)
  @IsString()
  @MaxLength(LIBRARY_LIMITS.maxDescription)
  description?: string | null;

  @ApiPropertyOptional({
    maxLength: LIBRARY_LIMITS.maxAuthorName,
    description: 'The pseudonym shown in the library; empty = "Anonym"',
  })
  @IsOptional()
  @ValidateIf((_dto, value) => value !== null)
  @IsString()
  @MaxLength(LIBRARY_LIMITS.maxAuthorName)
  authorName?: string | null;

  @ApiProperty({ description: 'I reviewed the exact JSON and publish it' })
  @IsBoolean()
  confirmed!: boolean;

  @ApiPropertyOptional({
    description: 'Keep the remaining privacy findings on purpose',
  })
  @IsOptional()
  @IsBoolean()
  acknowledgeFindings?: boolean;
}

export class RateLibraryMappingDto {
  @ApiProperty({ minimum: 1, maximum: 5 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  stars!: number;
}

export class TakeLibraryMappingDto {
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

export class LibraryEntryResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() platform!: string;
  @ApiProperty({ type: String, nullable: true }) description!: string | null;
  @ApiProperty({ description: 'Normalised header columns, sorted' })
  fingerprint!: string;
  @ApiProperty() version!: number;
  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'The pseudonym; null = "Anonym". Never an e-mail or real name.',
  })
  authorName!: string | null;
  @ApiProperty({ type: Number, nullable: true }) ratingAverage!: number | null;
  @ApiProperty() ratingCount!: number;
  @ApiProperty() usageCount!: number;
  @ApiProperty({ format: 'date-time' }) publishedAt!: string;
  @ApiProperty({ format: 'date-time' }) updatedAt!: string;
  @ApiProperty({ description: 'I am the author' }) mine!: boolean;
  @ApiProperty({ type: Number, nullable: true }) myRating!: number | null;

  static from(view: LibraryEntryView): LibraryEntryResponseDto {
    return {
      id: view.id,
      name: view.name,
      platform: view.platform,
      description: view.description,
      fingerprint: view.fingerprint,
      version: view.version,
      authorName: view.authorName,
      ratingAverage: view.ratingAverage,
      ratingCount: view.ratingCount,
      usageCount: view.usageCount,
      publishedAt: view.publishedAt,
      updatedAt: view.updatedAt,
      mine: view.mine,
      myRating: view.myRating,
    };
  }
}

export class LibraryEntryDetailResponseDto extends LibraryEntryResponseDto {
  @ApiProperty({ type: 'object', additionalProperties: true })
  spec!: Record<string, unknown>;

  static fromDetail(detail: LibraryEntryDetail): LibraryEntryDetailResponseDto {
    return {
      ...LibraryEntryResponseDto.from(detail),
      spec: detail.spec as unknown as Record<string, unknown>,
    };
  }
}

export class PrivacyFindingDto {
  @ApiProperty({ description: 'JSON Pointer into the spec' }) path!: string;
  @ApiProperty({ enum: PRIVACY_FINDING_KINDS }) kind!: PrivacyFindingKind;
  @ApiProperty({ description: 'The value (shown to the author only)' })
  value!: string;
  @ApiProperty() removable!: boolean;
}

export class PublishTargetDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() nextVersion!: number;
}

export class ExistingEntryDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() version!: number;
}

export class PublishReviewResponseDto {
  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description: 'Exactly the JSON that becomes public',
  })
  spec!: Record<string, unknown>;
  @ApiProperty() name!: string;
  @ApiProperty() platform!: string;
  @ApiProperty() fingerprint!: string;
  @ApiProperty({ description: 'Bytes; at most maxSize' }) size!: number;
  @ApiProperty() maxSize!: number;
  @ApiProperty({ type: [PrivacyFindingDto] }) findings!: PrivacyFindingDto[];
  @ApiProperty({ type: PublishTargetDto, nullable: true })
  target!: PublishTargetDto | null;
  @ApiProperty({ type: ExistingEntryDto, nullable: true })
  existing!: ExistingEntryDto | null;
  @ApiProperty({ type: String, nullable: true }) lastAuthorName!: string | null;
  @ApiProperty({
    description:
      'The source is a copy taken from the library: only a new version of my own entry is possible (else 409 libraryCopy)',
  })
  libraryCopy!: boolean;

  static from(review: PublishReview): PublishReviewResponseDto {
    return {
      spec: review.spec as unknown as Record<string, unknown>,
      name: review.name,
      platform: review.platform,
      fingerprint: review.fingerprint,
      size: review.size,
      maxSize: LIBRARY_LIMITS.maxSpecBytes,
      findings: review.findings.map((finding) => ({ ...finding })),
      target: review.target ? { ...review.target } : null,
      existing: review.existing ? { ...review.existing } : null,
      lastAuthorName: review.lastAuthorName,
      libraryCopy: review.libraryCopy,
    };
  }
}

export class PublishQuotaResponseDto {
  @ApiProperty({ description: 'New entries per author and 24 h' })
  newPerDay!: number;
  @ApiProperty() usedToday!: number;
  @ApiProperty() remainingToday!: number;
  @ApiProperty({
    description: 'Publishes (new entries and versions) per 10 minutes',
  })
  publishesPer10Min!: number;
}

export class TakenLibraryMappingResponseDto {
  @ApiProperty({ type: MappingResponseDto }) mapping!: MappingResponseDto;
  @ApiProperty({ description: 'False = an existing copy of this version' })
  created!: boolean;
  @ApiProperty({ type: String, nullable: true, format: 'uuid' })
  projectFileId!: string | null;
  @ApiProperty({ enum: PROJECT_FILE_STATUSES, nullable: true })
  fileStatus!: string | null;

  static from(taken: TakenLibraryMapping): TakenLibraryMappingResponseDto {
    return {
      mapping: MappingResponseDto.from(taken.mapping),
      created: taken.created,
      projectFileId: taken.file?.id ?? null,
      fileStatus: taken.file?.status ?? null,
    };
  }
}

export class LibraryFileMatchesDto {
  @ApiProperty({ format: 'uuid' }) projectFileId!: string;
  @ApiProperty() displayName!: string;
  @ApiProperty({ type: [LibraryEntryResponseDto] })
  matches!: LibraryEntryResponseDto[];

  static from(entry: LibraryFileMatches): LibraryFileMatchesDto {
    return {
      projectFileId: entry.projectFileId,
      displayName: entry.displayName,
      matches: entry.matches.map(LibraryEntryResponseDto.from),
    };
  }
}
