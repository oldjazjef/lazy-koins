import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { LIBRARY_SORTS, type LibrarySort } from '../domain/library-mapping';
import {
  PUBLIC_LIBRARY_LIMITS,
  type PublicLibraryEntry,
  type PublicLibraryEntryDetail,
  type PublicLibraryPage,
} from '../domain/public-library';

/** F5.18: `GET /api/public/library` — search, filter, sort, page. */
export class PublicLibraryQueryDto {
  @ApiPropertyOptional({ description: 'Searches name, platform, description' })
  @IsOptional()
  @IsString()
  @MaxLength(PUBLIC_LIBRARY_LIMITS.maxSearchLength)
  search?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(40)
  platform?: string;

  @ApiPropertyOptional({ enum: LIBRARY_SORTS, default: 'rating' })
  @IsOptional()
  @IsIn(LIBRARY_SORTS)
  sort?: LibrarySort;

  @ApiPropertyOptional({ minimum: 0, maximum: PUBLIC_LIBRARY_LIMITS.maxOffset })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(PUBLIC_LIBRARY_LIMITS.maxOffset)
  offset?: number;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: PUBLIC_LIBRARY_LIMITS.maxPageSize,
    default: PUBLIC_LIBRARY_LIMITS.defaultPageSize,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(PUBLIC_LIBRARY_LIMITS.maxPageSize)
  limit?: number;
}

/** F5.18: `POST /api/public/library/match` — exactly a header row and a file name. */
export class PublicLibraryMatchDto {
  @ApiProperty({
    maxLength: PUBLIC_LIBRARY_LIMITS.maxFileNameLength,
    description: 'The base file name (no folders)',
  })
  @IsString()
  @MaxLength(PUBLIC_LIBRARY_LIMITS.maxFileNameLength)
  fileName!: string;

  @ApiProperty({
    type: [String],
    maxItems: PUBLIC_LIBRARY_LIMITS.maxHeaderCells,
    description: "The file's header row — no data rows",
  })
  @IsArray()
  @ArrayMaxSize(PUBLIC_LIBRARY_LIMITS.maxHeaderCells)
  @IsString({ each: true })
  @MaxLength(PUBLIC_LIBRARY_LIMITS.maxHeaderCellLength, { each: true })
  headers!: string[];
}

export class PublicLibraryEntryDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() platform!: string;
  @ApiProperty({ type: String, nullable: true }) description!: string | null;
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'The pseudonym; null = "Anonym"',
  })
  authorName!: string | null;
  @ApiProperty() version!: number;
  @ApiProperty({ description: 'Normalised header columns, sorted' })
  fingerprint!: string;
  @ApiProperty({ type: Number, nullable: true }) ratingAverage!: number | null;
  @ApiProperty() ratingCount!: number;
  @ApiProperty() usageCount!: number;
  @ApiProperty({ format: 'date-time' }) publishedAt!: string;
  @ApiProperty({ format: 'date-time' }) updatedAt!: string;

  /** Field by field: the allow-list (never an author id, e-mail or user id). */
  static from(entry: PublicLibraryEntry): PublicLibraryEntryDto {
    return {
      id: entry.id,
      name: entry.name,
      platform: entry.platform,
      description: entry.description,
      authorName: entry.authorName,
      version: entry.version,
      fingerprint: entry.fingerprint,
      ratingAverage: entry.ratingAverage,
      ratingCount: entry.ratingCount,
      usageCount: entry.usageCount,
      publishedAt: entry.publishedAt,
      updatedAt: entry.updatedAt,
    };
  }
}

export class PublicLibraryEntryDetailDto extends PublicLibraryEntryDto {
  @ApiProperty({ type: 'object', additionalProperties: true })
  spec!: Record<string, unknown>;

  static fromDetail(
    detail: PublicLibraryEntryDetail,
  ): PublicLibraryEntryDetailDto {
    return {
      ...PublicLibraryEntryDto.from(detail),
      spec: detail.spec as unknown as Record<string, unknown>,
    };
  }
}

export class PublicLibraryPageDto {
  @ApiProperty({ type: [PublicLibraryEntryDto] })
  items!: PublicLibraryEntryDto[];
  @ApiProperty() total!: number;
  @ApiProperty() offset!: number;
  @ApiProperty() limit!: number;

  static from(page: PublicLibraryPage): PublicLibraryPageDto {
    return {
      items: page.items.map(PublicLibraryEntryDto.from),
      total: page.total,
      offset: page.offset,
      limit: page.limit,
    };
  }
}

export class PublicLibraryMatchesDto {
  @ApiProperty({ type: [PublicLibraryEntryDto] })
  items!: PublicLibraryEntryDto[];
}
