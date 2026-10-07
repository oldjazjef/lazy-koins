import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';
import type { RemoteLibraryTest } from '../application/remote-library.handlers';
import {
  type LibraryStatus,
  REMOTE_URL_MAX,
  type RemoteLibrarySettings,
} from '../domain/remote-library';

/** `GET /api/library/status` (web and desktop). */
export class LibraryStatusDto {
  @ApiProperty({ enum: ['web', 'remote'] }) mode!: 'web' | 'remote';
  @ApiProperty() available!: boolean;
  @ApiProperty({ description: 'No publish / rate / delete' })
  readOnly!: boolean;
  @ApiProperty({ type: String, nullable: true }) server!: string | null;
  @ApiProperty() suggestions!: boolean;
  @ApiProperty({
    type: String,
    nullable: true,
    enum: ['libraryNotConfigured', 'offline'],
  })
  reason!: LibraryStatus['reason'];

  static from(status: LibraryStatus): LibraryStatusDto {
    return { ...status };
  }
}

/** Einstellungen › Bibliothek (desktop, F5.18). */
export class RemoteLibrarySettingsDto {
  @ApiProperty({ description: "The web deployment's address; '' = none" })
  url!: string;
  @ApiProperty() enabled!: boolean;
  @ApiProperty({
    description: 'Suggestions in the files tab (sends header row + file name)',
  })
  suggestions!: boolean;
  @ApiProperty({ type: String, nullable: true, format: 'date-time' })
  updatedAt!: string | null;

  static from(settings: RemoteLibrarySettings): RemoteLibrarySettingsDto {
    return {
      url: settings.url,
      enabled: settings.enabled,
      suggestions: settings.suggestions,
      updatedAt: settings.updatedAt,
    };
  }
}

export class SaveRemoteLibrarySettingsDto {
  @ApiProperty({
    maxLength: REMOTE_URL_MAX,
    description: "https://… (http only for localhost); '' = none",
  })
  @IsString()
  @MaxLength(REMOTE_URL_MAX + 50)
  url!: string;

  @ApiProperty() @IsBoolean() enabled!: boolean;

  @ApiProperty() @IsBoolean() suggestions!: boolean;
}

export class TestRemoteLibraryDto {
  @ApiPropertyOptional({ description: 'The unsaved address; absent = saved' })
  @IsOptional()
  @IsString()
  @MaxLength(REMOTE_URL_MAX + 50)
  url?: string;
}

export class RemoteLibraryTestDto {
  @ApiProperty() server!: string;
  @ApiProperty({ description: 'Entries in that library' }) total!: number;

  static from(test: RemoteLibraryTest): RemoteLibraryTestDto {
    return { server: test.server, total: test.total };
  }
}
