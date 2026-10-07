import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { MAX_SYSTEM_PROMPT } from '../domain/assistant-settings';

export class SaveAssistantSettingsDto {
  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description:
      'The own system prompt; null or "" = back to the default. The safety rules are always appended.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_SYSTEM_PROMPT)
  systemPrompt?: string | null;

  @ApiPropertyOptional({ description: 'Withdraw the chat consent (F5.14)' })
  @IsOptional()
  @IsBoolean()
  revokeChatConsent?: boolean;
}

export const WORKSPACE_TAB_NAMES = [
  'general',
  'files',
  'hints',
  'wallets',
  'rates',
  'result',
  'checks',
  'corrections',
  'exports',
] as const;

/** Where the user is (F11.14 "kennt den Kontext") — no project data, only ids. */
export class ChatContextDto {
  @ApiPropertyOptional({ example: '/app/projects/0199…' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  @Matches(/^\/[A-Za-z0-9/_.#?=&%-]*$/)
  route?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  projectId?: string;

  @ApiPropertyOptional({ enum: WORKSPACE_TAB_NAMES })
  @IsOptional()
  @IsIn(WORKSPACE_TAB_NAMES)
  tab?: string;
}

export class AskAssistantDto {
  @ApiProperty({ maxLength: 4000 })
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  text!: string;

  @ApiPropertyOptional({ type: ChatContextDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => ChatContextDto)
  context?: ChatContextDto;

  @ApiPropertyOptional({
    description:
      'F5.14: the user accepted the one-time notice that chat content goes to the provider',
  })
  @IsOptional()
  @IsBoolean()
  consent?: boolean;
}

export class RenameConversationDto {
  @ApiProperty({ maxLength: 120 })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  title!: string;
}
