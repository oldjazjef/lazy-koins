import { BadRequestException } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { MappingPreviewResponseDto } from '../../files/dto/project-file.dto';
import { MAX_FILE_BYTES } from '../../files/domain/project-file';
import type { ReadableFile } from '../../files/application/source-file-reader';
import type {
  FingerprintVerdict,
  SampleInspection,
  SamplePreview,
} from '../application/queries/mapping-sample.queries';
import { sampleFileOf } from '../application/sample-file';

/** The editor's spec travels as a form field: at most this many characters of JSON. */
export const MAX_SPEC_FIELD = 512 * 1024;

/**
 * Multipart limits of a sample request: one file (the upload's 20 MB, F5.1) and a few small text
 * fields. Multer keeps the file in memory only; nothing is written to disk.
 */
export const SAMPLE_UPLOAD_LIMITS = {
  limits: {
    fileSize: MAX_FILE_BYTES,
    files: 1,
    fields: 6,
    fieldSize: MAX_SPEC_FIELD,
  },
};

/** The part of a multer file a handler needs (no `@types/multer` in the workspace). */
export interface UploadedSample {
  readonly originalname: string;
  readonly buffer: Buffer;
  readonly size: number;
}

/** The uploaded part as the engine's input — 400 without one; the limits of `sampleFileOf`. */
export function sampleFromUpload(
  file: UploadedSample | undefined,
  name: string | undefined,
): ReadableFile {
  if (!file) {
    throw new BadRequestException('file: send the sample as the "file" part');
  }
  return sampleFileOf(
    name ?? file.originalname,
    new Uint8Array(
      file.buffer.buffer,
      file.buffer.byteOffset,
      file.buffer.length,
    ),
  );
}

/** OpenAPI body of every sample request: the file plus the text fields of the DTO. */
export function sampleBodySchema(
  fields: Record<string, { type: string; description?: string }> = {},
) {
  return {
    type: 'object',
    required: ['file'],
    properties: {
      file: {
        type: 'string',
        format: 'binary',
        description: 'CSV or XLSX, up to 20 MB — never stored',
      },
      name: {
        type: 'string',
        description: 'The file name (UTF-8); default = the part’s file name',
      },
      ...fields,
    },
  };
}

export class SampleFormDto {
  @ApiPropertyOptional({ description: 'The file name (UTF-8)' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;
}

export class SamplePreviewFormDto extends SampleFormDto {
  @ApiProperty({ description: 'The spec as JSON text (may be invalid)' })
  @IsString()
  @MaxLength(MAX_SPEC_FIELD)
  spec!: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 500, default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'The mapping being edited — left out when checking which mapping would win',
  })
  @IsOptional()
  @IsUUID()
  mappingId?: string;
}

export class RecognitionDto {
  @ApiProperty() standard!: boolean;
  @ApiProperty({
    type: 'object',
    nullable: true,
    additionalProperties: true,
    description: '{ id, name, confidence } of the mapping an upload would use',
  })
  mapping!: { id: string; name: string; confidence: number } | null;
}

export class SampleInspectionResponseDto {
  @ApiProperty() name!: string;
  @ApiProperty({ enum: ['csv', 'xlsx'] }) kind!: 'csv' | 'xlsx';
  @ApiProperty() size!: number;
  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description:
      'fileName, fileKind, encoding, delimiter, sheets, sheet, rowCount, headerRowGuess (1-based), rows (first rows incl. preamble), distinctValues — the same object the AI would get',
  })
  sample!: unknown;
  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description: 'A spec skeleton from the header ("Vorlage aus Datei")',
  })
  skeleton!: unknown;
  @ApiProperty({ type: RecognitionDto }) recognisedBy!: RecognitionDto;

  static from(inspection: SampleInspection): SampleInspectionResponseDto {
    return {
      name: inspection.name,
      kind: inspection.kind,
      size: inspection.size,
      sample: inspection.sample,
      skeleton: inspection.skeleton,
      recognisedBy: {
        standard: inspection.recognisedBy.standard,
        mapping: inspection.recognisedBy.mapping
          ? { ...inspection.recognisedBy.mapping }
          : null,
      },
    };
  }
}

export class FingerprintDto {
  @ApiProperty({ enum: ['this', 'other', 'standard', 'none'] })
  verdict!: FingerprintVerdict;
  @ApiProperty() confidence!: number;
  @ApiProperty({ type: RecognitionDto }) recognisedBy!: RecognitionDto;
}

export class SamplePreviewResponseDto {
  @ApiProperty() valid!: boolean;
  @ApiProperty({ type: 'array', items: { type: 'object' } })
  issues!: { path: string; message: string }[];
  @ApiProperty({ type: MappingPreviewResponseDto, nullable: true })
  preview!: MappingPreviewResponseDto | null;
  @ApiProperty({ type: 'object', additionalProperties: { type: 'number' } })
  kindCounts!: Record<string, number>;
  @ApiProperty({ type: 'array', items: { type: 'object' } })
  unknownValues!: { value: string; count: number }[];
  @ApiProperty({ type: FingerprintDto, nullable: true })
  fingerprint!: FingerprintDto | null;

  static from(preview: SamplePreview): SamplePreviewResponseDto {
    return {
      valid: preview.valid,
      issues: preview.issues.map((issue) => ({ ...issue })),
      preview: preview.preview
        ? MappingPreviewResponseDto.from(preview.preview)
        : null,
      kindCounts: { ...preview.kindCounts },
      unknownValues: preview.unknownValues.map((u) => ({ ...u })),
      fingerprint: preview.fingerprint
        ? {
            verdict: preview.fingerprint.verdict,
            confidence: preview.fingerprint.confidence,
            recognisedBy: {
              standard: preview.fingerprint.recognisedBy.standard,
              mapping: preview.fingerprint.recognisedBy.mapping
                ? { ...preview.fingerprint.recognisedBy.mapping }
                : null,
            },
          }
        : null,
    };
  }
}
