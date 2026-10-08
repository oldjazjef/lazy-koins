import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsUUID } from 'class-validator';
import type {
  FileCandidate,
  SelectResult,
  UserFileView,
} from '../application/my-files.handlers';
import {
  DERIVED_FROM,
  PROJECT_FILE_STATUSES,
  type ProjectFileStatus,
} from '../domain/project-file';
import {
  PROJECT_STATUSES,
  type ProjectStatus,
} from '../../projects/domain/project';
import { originWalletId } from '../../wallets/domain/wallet';
import { PeriodDto } from './project-file.dto';

export class FileUsageDto {
  @ApiProperty({ format: 'uuid' }) projectFileId!: string;
  @ApiProperty({ format: 'uuid' }) projectId!: string;
  @ApiProperty() projectName!: string;
  @ApiProperty() taxYear!: number;
  @ApiProperty({ enum: PROJECT_STATUSES }) projectStatus!: ProjectStatus;
  @ApiProperty({ description: 'false = deactivated in that project (F5.7a)' })
  active!: boolean;
}

/** F5.21: one of my files, independent of projects. */
export class UserFileResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ description: 'SHA-256 of the original bytes' })
  sha256!: string;
  @ApiProperty({ description: 'The name of the first upload' }) name!: string;
  @ApiProperty({ enum: ['csv', 'xlsx', 'pdf'] }) kind!: string;
  @ApiProperty() size!: number;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
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
    enum: ['uploaded', 'derived', 'wallet'],
    description:
      'derived = a standard CSV the AI read from a PDF; wallet = the records of a wallet fetch',
  })
  source!: 'uploaded' | 'derived' | 'wallet';
  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  sourceWalletId!: string | null;
  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  derivedFromFileId!: string | null;
  @ApiProperty({ type: [FileUsageDto], description: 'Newest tax year first' })
  usedIn!: FileUsageDto[];

  static from(file: UserFileView): UserFileResponseDto {
    const wallet = originWalletId(file.source) ?? null;
    const derived = file.source.startsWith(DERIVED_FROM)
      ? file.source.slice(DERIVED_FROM.length)
      : null;
    return {
      id: file.id,
      sha256: file.sha256,
      name: file.originalName,
      kind: file.kind,
      size: file.size,
      createdAt: file.createdAt,
      status: file.status,
      platform: file.platform,
      mappingId: file.mappingId,
      mappingName: file.mappingName,
      period: file.period,
      bookingCount: file.bookingCount,
      holdingCount: file.holdingCount,
      errorCount: file.errorCount,
      source: wallet ? 'wallet' : derived ? 'derived' : 'uploaded',
      sourceWalletId: wallet,
      derivedFromFileId: derived,
      usedIn: file.usedIn.map((usage) => ({ ...usage })),
    };
  }
}

export class FileCandidateResponseDto extends UserFileResponseDto {
  @ApiProperty({ description: 'Already in the project' }) selected!: boolean;
  @ApiProperty({
    description:
      'Pre-ticked: its period touches the tax year, or it holds balances at 31.12. (F5.22)',
  })
  suggested!: boolean;

  static fromCandidate(file: FileCandidate): FileCandidateResponseDto {
    return {
      ...UserFileResponseDto.from(file),
      selected: file.selected,
      suggested: file.suggested,
    };
  }
}

export class SelectProjectFilesDto {
  @ApiProperty({ type: [String], format: 'uuid', maxItems: 500 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsUUID('all', { each: true })
  fileIds!: string[];
}

export class SelectProjectFilesResponseDto {
  @ApiProperty() added!: number;
  @ApiProperty() alreadySelected!: number;

  static from(result: SelectResult): SelectProjectFilesResponseDto {
    return { ...result };
  }
}
