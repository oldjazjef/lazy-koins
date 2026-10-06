import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  BOOKING_KINDS,
  type Booking,
  HINT_SEVERITIES,
  type Holding,
  MISSING_FILE_KINDS,
  type MissingFileHint,
  toDecimalString,
} from '@lazykoins/engine';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import {
  derivedFromId,
  FROM_PROJECT,
  PROJECT_FILE_STATUSES,
  type ProjectFileStatus,
} from '../domain/project-file';
import type { ProjectFileView } from '../application/file-views';
import type { FilePreview } from '../application/queries/file-content.query';
import type { MappingPreview } from '../application/queries/preview-mapping.query';

export class UploadFileQueryDto {
  @ApiProperty({ example: 'kraken_ledgers_2025.csv', maxLength: 255 })
  @IsString()
  @Matches(/\S/, { message: 'name must not be blank' })
  @MaxLength(255)
  name!: string;
}

const ASSIGNMENT_MODES = ['evidenceOnly', 'automatic', 'mapping'] as const;

export class ChangeProjectFileDto {
  @ApiProperty({
    enum: ASSIGNMENT_MODES,
    description:
      'evidenceOnly = keep as receipt ("nur Beleg"); automatic = detect again; mapping = read with `mappingId`',
  })
  @IsIn(ASSIGNMENT_MODES)
  mode!: (typeof ASSIGNMENT_MODES)[number];

  @ApiPropertyOptional({ format: 'uuid' })
  @ValidateIf((dto: ChangeProjectFileDto) => dto.mode === 'mapping')
  @IsUUID()
  mappingId?: string;
}

export class PreviewQueryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 200, default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  rows?: number;
}

export class MappingPreviewRequestDto {
  @ApiPropertyOptional({ format: 'uuid', description: 'A stored mapping …' })
  @ValidateIf((dto: MappingPreviewRequestDto) => dto.spec === undefined)
  @IsUUID()
  mappingId?: string;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    description: '… or an unsaved spec from the editor',
  })
  @IsOptional()
  @IsObject()
  spec?: Record<string, unknown>;

  @ApiPropertyOptional({ minimum: 1, maximum: 500, default: 50 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;
}

export class PeriodDto {
  @ApiProperty({ example: '2025-01-01' }) from!: string;
  @ApiProperty({ example: '2025-12-31' }) to!: string;
}

export class ProjectFileResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({
    description: "SHA-256 of the original bytes (the records' sourceFileId)",
  })
  sha256!: string;
  @ApiProperty() displayName!: string;
  @ApiProperty({ enum: ['csv', 'xlsx', 'pdf'] }) kind!: string;
  @ApiProperty() size!: number;
  @ApiProperty({ enum: PROJECT_FILE_STATUSES }) status!: ProjectFileStatus;
  @ApiProperty({ type: String, nullable: true }) platform!: string | null;
  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  mappingId!: string | null;
  @ApiProperty({ type: String, nullable: true }) mappingName!: string | null;
  @ApiProperty({ type: PeriodDto, nullable: true }) period!: PeriodDto | null;
  @ApiProperty() bookingCount!: number;
  @ApiProperty() holdingCount!: number;
  @ApiProperty() errorCount!: number;
  @ApiProperty({
    enum: ['uploaded', 'from_project', 'derived'],
    description:
      'derived = a standard-format file the AI converted from another file of this project (a PDF)',
  })
  origin!: 'uploaded' | 'from_project' | 'derived';
  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  originProjectId!: string | null;
  @ApiProperty({ type: String, nullable: true })
  originProjectName!: string | null;
  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  derivedFromFileId!: string | null;
  @ApiProperty({ type: String, nullable: true })
  derivedFromName!: string | null;
  @ApiProperty({ format: 'date-time' }) addedAt!: string;

  static from(file: ProjectFileView): ProjectFileResponseDto {
    const fromProject = file.origin.startsWith(FROM_PROJECT);
    const derivedFrom = derivedFromId(file.origin) ?? null;
    return {
      id: file.id,
      sha256: file.sha256,
      displayName: file.displayName,
      kind: file.kind,
      size: file.size,
      status: file.status,
      platform: file.platform,
      mappingId: file.mappingId,
      mappingName: file.mappingName,
      period: file.period,
      bookingCount: file.bookingCount,
      holdingCount: file.holdingCount,
      errorCount: file.errorCount,
      origin: fromProject
        ? 'from_project'
        : derivedFrom
          ? 'derived'
          : 'uploaded',
      originProjectId: fromProject
        ? file.origin.slice(FROM_PROJECT.length)
        : null,
      originProjectName: file.originProjectName,
      derivedFromFileId: derivedFrom,
      derivedFromName: file.derivedFromName,
      addedAt: file.addedAt,
    };
  }
}

export class FileGroupDto {
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'null = not read (yet)',
  })
  platform!: string | null;
  @ApiProperty({ type: [ProjectFileResponseDto] })
  files!: ProjectFileResponseDto[];
}

export class MissingFileHintDto {
  @ApiProperty({ description: 'Stable key (see GET …/hints)' }) key!: string;
  @ApiProperty() platform!: string;
  @ApiProperty({ description: "'' = the whole platform" }) accountId!: string;
  @ApiProperty({ type: [String] }) accounts!: string[];
  @ApiProperty({ enum: MISSING_FILE_KINDS }) kind!: string;
  @ApiProperty({ enum: HINT_SEVERITIES }) severity!: string;
  @ApiPropertyOptional() date?: string;
  @ApiPropertyOptional() zeroBalance?: boolean;
  @ApiProperty({ description: 'i18n key with the instructions' })
  hintKey!: string;

  static from(hint: MissingFileHint): MissingFileHintDto {
    return { ...hint, accounts: [...hint.accounts] };
  }
}

export class ProjectFilesResponseDto {
  @ApiProperty() taxYear!: number;
  @ApiProperty({
    type: [FileGroupDto],
    description: 'Grouped by platform (F5.5); files not read yet last',
  })
  groups!: FileGroupDto[];
  @ApiProperty({ type: [MissingFileHintDto] }) missing!: MissingFileHintDto[];

  static from(
    taxYear: number,
    files: readonly ProjectFileView[],
    missing: readonly MissingFileHint[],
  ): ProjectFilesResponseDto {
    const groups = new Map<string | null, ProjectFileResponseDto[]>();
    for (const file of files) {
      const key = file.platform;
      groups.set(key, [
        ...(groups.get(key) ?? []),
        ProjectFileResponseDto.from(file),
      ]);
    }
    const sorted = [...groups.entries()].sort(([a], [b]) =>
      a === null ? 1 : b === null ? -1 : a < b ? -1 : a > b ? 1 : 0,
    );
    return {
      taxYear,
      groups: sorted.map(([platform, groupFiles]) => ({
        platform,
        files: groupFiles,
      })),
      missing: missing.map(MissingFileHintDto.from),
    };
  }
}

export class PreviewSheetDto {
  @ApiProperty() name!: string;
  @ApiProperty({
    type: 'array',
    items: { type: 'array', items: { type: 'string' } },
  })
  rows!: string[][];
  @ApiProperty() totalRows!: number;
}

export class FilePreviewResponseDto {
  @ApiProperty({ enum: ['table', 'pdf'] }) kind!: 'table' | 'pdf';
  @ApiPropertyOptional({ type: [PreviewSheetDto] }) sheets?: PreviewSheetDto[];

  static from(preview: FilePreview): FilePreviewResponseDto {
    if (preview.kind === 'pdf') return { kind: 'pdf' };
    return {
      kind: 'table',
      sheets: preview.sheets.map((sheet) => ({
        name: sheet.name,
        rows: sheet.rows.map((row) => [...row]),
        totalRows: sheet.totalRows,
      })),
    };
  }
}

/** A booking as the API shows it: decimals as strings, never numbers. */
export class BookingDto {
  @ApiProperty() row!: number;
  @ApiProperty({ format: 'date-time' }) timestamp!: string;
  @ApiProperty() platform!: string;
  @ApiProperty() accountId!: string;
  @ApiProperty({ enum: BOOKING_KINDS }) kind!: string;
  @ApiProperty() asset!: string;
  @ApiProperty({ example: '0.000000000000000001' }) quantity!: string;
  @ApiPropertyOptional() fee?: string;
  @ApiPropertyOptional() feeAsset?: string;
  @ApiPropertyOptional() priceChf?: string;
  @ApiPropertyOptional() priceUsd?: string;
  @ApiPropertyOptional() group?: string;
  @ApiPropertyOptional() note?: string;
  @ApiProperty() rawType!: string;
  @ApiPropertyOptional() rawAsset?: string;

  static from(booking: Booking): BookingDto {
    const dec = (value: Booking['fee']) =>
      value === undefined ? undefined : toDecimalString(value);
    return {
      row: booking.row,
      timestamp: booking.timestamp,
      platform: booking.platform,
      accountId: booking.accountId,
      kind: booking.kind,
      asset: booking.asset,
      quantity: toDecimalString(booking.quantity),
      fee: dec(booking.fee),
      feeAsset: booking.feeAsset,
      priceChf: dec(booking.priceChf),
      priceUsd: dec(booking.priceUsd),
      group: booking.group,
      note: booking.note,
      rawType: booking.rawType,
      rawAsset: booking.rawAsset,
    };
  }
}

export class HoldingDto {
  @ApiProperty() row!: number;
  @ApiProperty() platform!: string;
  @ApiProperty() accountId!: string;
  @ApiProperty() asset!: string;
  @ApiProperty() quantity!: string;
  @ApiProperty({ example: '2025-12-31' }) asOf!: string;
  @ApiPropertyOptional() evidence?: string;

  static from(holding: Holding): HoldingDto {
    return {
      row: holding.row,
      platform: holding.platform,
      accountId: holding.accountId,
      asset: holding.asset,
      quantity: toDecimalString(holding.quantity),
      asOf: holding.asOf,
      evidence: holding.evidence,
    };
  }
}

export class RowErrorDto {
  @ApiProperty() row!: number;
  @ApiProperty({
    description: 'Stable code; the app translates files.rowErrors.<code>',
  })
  code!: string;
  @ApiPropertyOptional() column?: string;
  @ApiPropertyOptional() sheet?: string;
}

export class ImportNoteDto {
  @ApiProperty() code!: string;
  @ApiPropertyOptional() row?: number;
}

export class PreviewTotalsDto {
  @ApiProperty() bookings!: number;
  @ApiProperty() holdings!: number;
  @ApiProperty() errors!: number;
  @ApiProperty() notes!: number;
}

export class MappingPreviewResponseDto {
  @ApiProperty({ type: [BookingDto] }) bookings!: BookingDto[];
  @ApiProperty({ type: [HoldingDto] }) holdings!: HoldingDto[];
  @ApiProperty({ type: [RowErrorDto] }) errors!: RowErrorDto[];
  @ApiProperty({ type: [ImportNoteDto] }) notes!: ImportNoteDto[];
  @ApiProperty({ type: PeriodDto, nullable: true }) period!: PeriodDto | null;
  @ApiProperty({ type: PreviewTotalsDto }) totals!: PreviewTotalsDto;

  static from(preview: MappingPreview): MappingPreviewResponseDto {
    return {
      bookings: preview.result.bookings.map(BookingDto.from),
      holdings: preview.result.holdings.map(HoldingDto.from),
      errors: preview.result.errors.map((error) => ({ ...error })),
      notes: preview.result.notes.map((note) => ({ ...note })),
      period: preview.result.period,
      totals: preview.totals,
    };
  }
}
