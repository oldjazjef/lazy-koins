import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { MappingPreviewResponseDto } from '../../files/dto/project-file.dto';
import {
  AI_PROVIDER_KINDS,
  type AiProviderKind,
} from '../../integrations/ai/ai-completion.port';
import type { MappingCandidate } from '../application/mapping.handlers';
import type { AiSettingsView } from '../application/settings.handlers';
import type { StatementCandidate } from '../application/statement.handlers';
import {
  HOLDING_ISSUES,
  type HoldingIssue,
} from '../domain/statement-extraction';

export class AiSettingsResponseDto implements AiSettingsView {
  @ApiProperty() enabled!: boolean;
  @ApiProperty({ enum: AI_PROVIDER_KINDS }) provider!: AiProviderKind;
  @ApiProperty({ description: 'Empty = the provider default' })
  baseUrl!: string;
  @ApiProperty({ description: 'Empty = the provider default' }) model!: string;
  @ApiProperty() hasApiKey!: boolean;
  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'Last four characters, e.g. "…1234" — the key itself is never returned',
  })
  apiKeyHint!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  consentAt!: string | null;
  @ApiProperty({ description: 'On and configured' }) ready!: boolean;
  @ApiProperty({ description: 'SETTINGS_ENCRYPTION_KEY is set' })
  canStoreKey!: boolean;
  @ApiProperty() privateUrlsAllowed!: boolean;
}

export class SaveAiSettingsDto {
  @ApiProperty() @IsBoolean() enabled!: boolean;

  @ApiProperty({ enum: AI_PROVIDER_KINDS })
  @IsIn(AI_PROVIDER_KINDS)
  provider!: AiProviderKind;

  @ApiProperty({
    example: 'http://localhost:11434/v1',
    description: 'OpenAI-compatible: up to /v1. Empty = provider default.',
  })
  @IsString()
  @MaxLength(300)
  baseUrl!: string;

  @ApiProperty({
    example: 'gpt-4.1-mini',
    description: 'Empty = provider default',
  })
  @IsString()
  @MaxLength(120)
  model!: string;

  @ApiPropertyOptional({
    description: 'Omit to keep the stored key, "" to remove it. Write-only.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  apiKey?: string;

  @ApiPropertyOptional({ description: 'Withdraw the consent (F5.14)' })
  @IsOptional()
  @IsBoolean()
  revokeConsent?: boolean;
}

export class AiConnectionTestResponseDto {
  @ApiProperty() ok!: true;
  @ApiProperty() model!: string;
  @ApiProperty({ type: 'object', nullable: true, additionalProperties: true })
  usage!: { inputTokens: number; outputTokens: number } | null;
  @ApiProperty() millis!: number;
}

export class AiConsentDto {
  @ApiPropertyOptional({
    description:
      'The user agreed in the dialog that shows the payload (required the first time)',
  })
  @IsOptional()
  @IsBoolean()
  consent?: boolean;
}

/** Multipart text fields of the sample AI requests (form values arrive as strings). */
export class SampleAiFormDto {
  @ApiPropertyOptional({ description: 'The file name (UTF-8)' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  @ApiPropertyOptional({
    description: 'The user agreed in the payload dialog ("true")',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  )
  @IsBoolean()
  consent?: boolean;
}

export class AiRequestPreviewResponseDto {
  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description: 'Exactly the data that is sent (F5.14)',
  })
  payload!: unknown;
  @ApiProperty({ enum: AI_PROVIDER_KINDS }) provider!: string;
  @ApiProperty() baseUrl!: string;
  @ApiProperty() model!: string;
  @ApiProperty() consentGiven!: boolean;
}

export class UsageDto {
  @ApiProperty() inputTokens!: number;
  @ApiProperty() outputTokens!: number;
}

export class MappingCandidateResponseDto {
  @ApiProperty({ type: 'object', additionalProperties: true })
  spec!: unknown;
  @ApiProperty() valid!: boolean;
  @ApiProperty({ type: 'array', items: { type: 'object' } })
  issues!: { path: string; message: string }[];
  @ApiProperty({ type: MappingPreviewResponseDto, nullable: true })
  preview!: MappingPreviewResponseDto | null;
  @ApiProperty({ type: 'object', additionalProperties: { type: 'number' } })
  kindCounts!: Record<string, number>;
  @ApiProperty({ type: 'array', items: { type: 'object' } })
  unknownValues!: { value: string; count: number }[];
  @ApiProperty({ type: [String] }) problems!: string[];
  @ApiProperty() rounds!: number;
  @ApiProperty() model!: string;
  @ApiProperty({ type: UsageDto, nullable: true }) usage!: UsageDto | null;

  static from(candidate: MappingCandidate): MappingCandidateResponseDto {
    return {
      spec: candidate.spec,
      valid: candidate.valid,
      issues: candidate.issues.map((issue) => ({ ...issue })),
      preview: candidate.preview
        ? MappingPreviewResponseDto.from(candidate.preview)
        : null,
      kindCounts: { ...candidate.kindCounts },
      unknownValues: candidate.unknownValues.map((u) => ({ ...u })),
      problems: [...candidate.problems],
      rounds: candidate.rounds,
      model: candidate.model,
      usage: candidate.usage ? { ...candidate.usage } : null,
    };
  }
}

export class AcceptAiMappingDto {
  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description: 'The reviewed (possibly edited) mapping spec',
  })
  @IsObject()
  spec!: Record<string, unknown>;
}

export class ExtractedHoldingDto {
  @ApiProperty() asset!: string;
  @ApiProperty({ description: 'Exactly as printed in the PDF' })
  quantityAsPrinted!: string;
  @ApiProperty({ type: String, nullable: true, description: 'Decimal string' })
  quantity!: string | null;
  @ApiProperty() asOf!: string;
  @ApiProperty() platform!: string;
  @ApiProperty() account!: string;
  @ApiProperty({ type: String, nullable: true }) priceChf!: string | null;
  @ApiProperty({ type: String, nullable: true }) priceUsd!: string | null;
  @ApiPropertyOptional() priceChfAsPrinted?: string;
  @ApiPropertyOptional() priceUsdAsPrinted?: string;
  @ApiProperty() page!: number;
  @ApiProperty({
    description: 'The printed quantity was found verbatim in the text',
  })
  verbatim!: boolean;
  @ApiProperty({ enum: HOLDING_ISSUES, isArray: true })
  issues!: HoldingIssue[];
}

export class StatementCandidateResponseDto {
  @ApiProperty({ type: [ExtractedHoldingDto] })
  holdings!: ExtractedHoldingDto[];
  @ApiProperty() truncated!: boolean;
  @ApiProperty() rounds!: number;
  @ApiProperty() model!: string;
  @ApiProperty({ type: UsageDto, nullable: true }) usage!: UsageDto | null;

  static from(candidate: StatementCandidate): StatementCandidateResponseDto {
    return {
      holdings: candidate.holdings.map((h) => ({
        ...h,
        issues: [...h.issues],
      })),
      truncated: candidate.truncated,
      rounds: candidate.rounds,
      model: candidate.model,
      usage: candidate.usage ? { ...candidate.usage } : null,
    };
  }
}

export class ConfirmedHoldingDto {
  @ApiProperty() @IsString() @MaxLength(40) asset!: string;
  @ApiProperty() @IsString() @MaxLength(80) quantityAsPrinted!: string;
  @ApiProperty({ example: '2025-12-31' })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  asOf!: string;
  @ApiProperty() @IsString() @MaxLength(40) platform!: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(40)
  account?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  priceChfAsPrinted?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  priceUsdAsPrinted?: string;
  @ApiProperty() @IsInt() @Min(1) page!: number;
}

export class AcceptStatementDto {
  @ApiProperty({
    type: [ConfirmedHoldingDto],
    description: 'The balances the user kept, as the extraction returned them',
  })
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => ConfirmedHoldingDto)
  holdings!: ConfirmedHoldingDto[];
}
