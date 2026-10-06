import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  MAIL_ERROR_KINDS,
  MAIL_SECURITIES,
  type MailErrorKind,
  type MailSecurity,
} from '../../integrations/mail/mail-transport.port';
import {
  MAIL_LOG_STATUSES,
  type MailLogEntry,
  type MailLogStatus,
} from '../domain/mail-log';
import {
  BODY_MAX,
  MAIL_PLACEHOLDERS,
  type MailPlaceholder,
  SUBJECT_MAX,
} from '../domain/mail-template';

export class SaveMailSettingsDto {
  @ApiProperty() @IsBoolean() enabled!: boolean;

  @ApiProperty({ example: 'smtp.example.ch', maxLength: 253 })
  @IsString()
  @MaxLength(253)
  host!: string;

  @ApiProperty({ example: 587, minimum: 1, maximum: 65535 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65535)
  port!: number;

  @ApiProperty({ enum: MAIL_SECURITIES })
  @IsIn(MAIL_SECURITIES)
  security!: MailSecurity;

  @ApiProperty({ maxLength: 254 })
  @IsString()
  @MaxLength(254)
  username!: string;

  @ApiPropertyOptional({
    description:
      'Write-only. Absent = keep the stored password, "" = remove it. Stored encrypted, never returned.',
    maxLength: 500,
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  password?: string;

  @ApiProperty({ maxLength: 120 })
  @IsString()
  @MaxLength(120)
  fromName!: string;

  @ApiProperty({ example: 'anna@example.ch', maxLength: 254 })
  @IsString()
  @MaxLength(254)
  fromAddress!: string;
}

/** The form's unsaved values; an empty body tests the saved settings. */
export class TestMailDto {
  @ApiPropertyOptional({ maxLength: 253 })
  @IsOptional()
  @IsString()
  @MaxLength(253)
  host?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 65535 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65535)
  port?: number;

  @ApiPropertyOptional({ enum: MAIL_SECURITIES })
  @IsOptional()
  @IsIn(MAIL_SECURITIES)
  security?: MailSecurity;

  @ApiPropertyOptional({ maxLength: 254 })
  @IsOptional()
  @IsString()
  @MaxLength(254)
  username?: string;

  @ApiPropertyOptional({
    description:
      'Typed into the form; absent = the saved password. Never stored.',
    maxLength: 500,
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  password?: string;

  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  fromName?: string;

  @ApiPropertyOptional({ maxLength: 254 })
  @IsOptional()
  @IsString()
  @MaxLength(254)
  fromAddress?: string;
}

export class MailSettingsResponseDto {
  @ApiProperty() enabled!: boolean;
  @ApiProperty() host!: string;
  @ApiProperty() port!: number;
  @ApiProperty({ enum: MAIL_SECURITIES }) security!: MailSecurity;
  @ApiProperty() username!: string;
  @ApiProperty() hasPassword!: boolean;
  @ApiProperty({ nullable: true, type: String, example: '…1234' })
  passwordHint!: string | null;
  @ApiProperty() fromName!: string;
  @ApiProperty() fromAddress!: string;
  @ApiProperty() ready!: boolean;
  @ApiProperty() canStorePassword!: boolean;
  @ApiProperty() privateHostsAllowed!: boolean;
  @ApiProperty() testRecipient!: string;
}

export class TestMailResponseDto {
  @ApiProperty() ok!: true;
  @ApiProperty() to!: string;
  @ApiProperty() millis!: number;
  @ApiProperty() response!: string;
}

/** The redacted details of a failed SMTP conversation (502 body `smtp`). */
export class SmtpErrorDto {
  @ApiProperty({ enum: MAIL_ERROR_KINDS }) kind!: MailErrorKind;
  @ApiProperty() host!: string;
  @ApiProperty() port!: number;
  @ApiProperty({ nullable: true, type: Number }) smtpCode!: number | null;
  @ApiProperty({ nullable: true, type: String }) response!: string | null;
  @ApiProperty({ nullable: true, type: String }) command!: string | null;
  @ApiProperty({ nullable: true, type: String }) code!: string | null;
}

export class MailTemplateTextDto {
  @ApiProperty({ maxLength: SUBJECT_MAX })
  @IsString()
  @MaxLength(SUBJECT_MAX)
  subject!: string;

  @ApiProperty({ maxLength: BODY_MAX })
  @IsString()
  @MaxLength(BODY_MAX)
  body!: string;
}

export class RenderedMailDto {
  @ApiProperty() subject!: string;
  @ApiProperty() body!: string;
  @ApiProperty({ type: [String] }) unknownPlaceholders!: string[];
}

export class MailTemplateResponseDto {
  @ApiProperty({ example: 'de-CH' }) language!: string;
  @ApiProperty() subject!: string;
  @ApiProperty() body!: string;
  @ApiProperty() isDefault!: boolean;
  @ApiProperty() defaultSubject!: string;
  @ApiProperty() defaultBody!: string;
  @ApiProperty({ enum: MAIL_PLACEHOLDERS, isArray: true })
  placeholders!: readonly MailPlaceholder[];
  @ApiProperty({ type: 'object', additionalProperties: { type: 'string' } })
  sampleValues!: Record<string, string>;
  @ApiProperty({ type: RenderedMailDto }) preview!: RenderedMailDto;
}

export class ComposeMailDto {
  @ApiPropertyOptional({
    type: [String],
    description: 'Chosen attachments; absent = the preselection',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  exportIds?: string[];
}

export class AttachmentOptionDto {
  @ApiProperty() id!: string;
  @ApiProperty() kind!: string;
  @ApiProperty() fileName!: string;
  @ApiProperty() size!: number;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty() internal!: boolean;
  @ApiProperty() selected!: boolean;
}

export class MailCompositionResponseDto {
  @ApiProperty() mailerReady!: boolean;
  @ApiProperty() to!: string;
  @ApiProperty() advisorName!: string;
  @ApiProperty() ownAddress!: string;
  @ApiProperty() subject!: string;
  @ApiProperty() body!: string;
  @ApiProperty({ type: [String] }) unknownPlaceholders!: string[];
  @ApiProperty({ type: [AttachmentOptionDto] })
  attachments!: AttachmentOptionDto[];
  @ApiProperty() maxAttachmentBytes!: number;
  @ApiProperty() calculated!: boolean;
}

export class SendMailDto {
  @ApiProperty({ example: 'treuhand@example.ch', maxLength: 254 })
  @IsString()
  @MaxLength(254)
  to!: string;

  @ApiProperty() @IsBoolean() ccMe!: boolean;

  @ApiProperty({ maxLength: SUBJECT_MAX })
  @IsString()
  @MaxLength(SUBJECT_MAX)
  subject!: string;

  @ApiProperty({ maxLength: BODY_MAX })
  @IsString()
  @MaxLength(BODY_MAX)
  body!: string;

  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  exportIds!: string[];

  @ApiProperty({
    description: 'Must be true: the dialog asked for explicit confirmation',
  })
  @IsBoolean()
  confirmed!: boolean;
}

export class MailLogAttachmentDto {
  @ApiProperty() exportId!: string;
  @ApiProperty() fileName!: string;
  @ApiProperty() size!: number;
}

export class MailLogEntryDto {
  @ApiProperty() id!: string;
  @ApiProperty() to!: string;
  @ApiProperty({ nullable: true, type: String }) cc!: string | null;
  @ApiProperty() subject!: string;
  @ApiProperty({ type: [MailLogAttachmentDto] })
  attachments!: MailLogAttachmentDto[];
  @ApiProperty({ enum: MAIL_LOG_STATUSES }) status!: MailLogStatus;
  @ApiProperty({ nullable: true, type: String }) error!: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;

  static from(entry: MailLogEntry): MailLogEntryDto {
    return {
      id: entry.id,
      to: entry.to,
      cc: entry.cc,
      subject: entry.subject,
      attachments: entry.attachments.map((item) => ({ ...item })),
      status: entry.status,
      error: entry.error,
      createdAt: entry.createdAt,
    };
  }
}
