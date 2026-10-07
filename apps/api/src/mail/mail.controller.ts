import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  ApiBadGatewayResponse,
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { AuthenticatedUser } from '../auth/authenticated-user';
import { CurrentUser } from '../auth/current-user.decorator';
import { SUPPORTED_LOCALES } from '../common/i18n/locale';
import { BEARER_SCHEME } from '../openapi/security-schemes';
import { ProjectSentResponseDto } from '../projects/dto/project-sent.dto';
import {
  ComposeMailDto,
  MailCompositionResponseDto,
  MailLogEntryDto,
  MailSettingsResponseDto,
  MailTemplateResponseDto,
  MailTemplateTextDto,
  RenderedMailDto,
  SaveMailSettingsDto,
  SendMailDto,
  TestMailDto,
  TestMailResponseDto,
} from './dto/mail.dto';
import { MailService } from './mail.service';

/** Mails leave the server: at most 20 per account in 10 minutes. */
const MAIL_BUDGET = { writes: { limit: 20, ttl: 10 * 60_000 } };

const MAIL_CONFLICT =
  'body.code: mailDisabled | mailNotConfigured | passwordUnreadable | privateHost | invalidHost';
const SMTP_FAILED =
  'The mail server refused or failed — body.code smtpFailed, body.smtp = { kind: auth | tls | connection | dns | timeout | rejected | protocol | unknown, host, port, smtpCode, response (redacted), command, code }';

/** F11.2: a template per language; without the parameter the user's language. */
const LANGUAGE_QUERY = {
  name: 'language',
  required: false,
  enum: SUPPORTED_LOCALES,
  description: 'The template of this language; default the user’s language',
} as const;

@ApiTags('mail')
@ApiBearerAuth(BEARER_SCHEME)
@Controller('mail')
export class MailSettingsController {
  constructor(private readonly mail: MailService) {}

  @Get('settings')
  @ApiOperation({ summary: 'My mailer (F11.10) — the password only as a hint' })
  @ApiOkResponse({ type: MailSettingsResponseDto })
  settings(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<MailSettingsResponseDto> {
    return this.mail.settings(user.userId);
  }

  @Put('settings')
  @ApiOperation({
    summary:
      'Save server, port, security, user, password (encrypted at rest), sender and on/off',
  })
  @ApiOkResponse({ type: MailSettingsResponseDto })
  @ApiUnprocessableEntityResponse({
    description:
      'body.code: invalidHost | privateHost | invalidAddress | encryptionUnavailable',
  })
  saveSettings(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: SaveMailSettingsDto,
  ): Promise<MailSettingsResponseDto> {
    return this.mail.saveSettings(user.userId, dto);
  }

  @Post('settings/test')
  @HttpCode(200)
  @Throttle(MAIL_BUDGET)
  @ApiOperation({
    summary:
      '"Test-Mail an mich senden" — with the saved settings, or the unsaved form values in the body',
  })
  @ApiOkResponse({ type: TestMailResponseDto })
  @ApiConflictResponse({ description: MAIL_CONFLICT })
  @ApiBadGatewayResponse({ description: SMTP_FAILED })
  test(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: TestMailDto,
  ): Promise<TestMailResponseDto> {
    return this.mail.sendTest(
      user.userId,
      dto.host === undefined
        ? undefined
        : {
            host: dto.host,
            port: dto.port ?? 587,
            security: dto.security ?? 'starttls',
            username: dto.username ?? '',
            fromName: dto.fromName ?? '',
            fromAddress: dto.fromAddress ?? '',
            ...(dto.password === undefined ? {} : { password: dto.password }),
          },
    );
  }

  @Get('template')
  @ApiOperation({
    summary:
      'My text template for the Treuhänder (F11.10) with default, placeholders and a preview',
  })
  @ApiOkResponse({ type: MailTemplateResponseDto })
  @ApiQuery(LANGUAGE_QUERY)
  template(
    @CurrentUser() user: AuthenticatedUser,
    @Query('language') language?: string,
  ): Promise<MailTemplateResponseDto> {
    return this.mail.template(user.userId, language);
  }

  @Put('template')
  @ApiOperation({ summary: 'Save my template (it applies to every project)' })
  @ApiOkResponse({ type: MailTemplateResponseDto })
  @ApiUnprocessableEntityResponse({
    description:
      'body.code: emptyMail | unknownPlaceholders (body.placeholders)',
  })
  @ApiQuery(LANGUAGE_QUERY)
  saveTemplate(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: MailTemplateTextDto,
    @Query('language') language?: string,
  ): Promise<MailTemplateResponseDto> {
    return this.mail.saveTemplate(user.userId, language, dto);
  }

  @Delete('template')
  @ApiOperation({ summary: '"Auf Standard zurücksetzen"' })
  @ApiOkResponse({ type: MailTemplateResponseDto })
  @ApiQuery(LANGUAGE_QUERY)
  resetTemplate(
    @CurrentUser() user: AuthenticatedUser,
    @Query('language') language?: string,
  ): Promise<MailTemplateResponseDto> {
    return this.mail.resetTemplate(user.userId, language);
  }

  @Post('template/preview')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Live preview of unsaved template text with sample values; unknown placeholders are listed',
  })
  @ApiOkResponse({ type: RenderedMailDto })
  @ApiQuery(LANGUAGE_QUERY)
  preview(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: MailTemplateTextDto,
    @Query('language') language?: string,
  ): Promise<RenderedMailDto> {
    return this.mail.previewTemplate(user.userId, dto, language);
  }
}

@ApiTags('mail')
@ApiBearerAuth(BEARER_SCHEME)
@Controller('projects/:projectId/mail')
export class ProjectMailController {
  constructor(private readonly mail: MailService) {}

  @Post('compose')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'F10.6a: the mail to the Treuhänder from my template and the latest calculation, with the statements to attach',
  })
  @ApiOkResponse({ type: MailCompositionResponseDto })
  @ApiNotFoundResponse({ description: 'Missing, or not mine' })
  compose(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() dto: ComposeMailDto,
  ): Promise<MailCompositionResponseDto> {
    return this.mail.compose(user.userId, projectId, dto.exportIds);
  }

  @Post('send')
  @HttpCode(200)
  @Throttle(MAIL_BUDGET)
  @ApiOperation({
    summary:
      'Send the reviewed mail with the chosen statements (≤ 20 MB) — logged, and on success the project is "an Treuhänder gesendet" (F4.7)',
  })
  @ApiOkResponse({ description: '{ log, sent }' })
  @ApiBadRequestResponse({ description: 'body.code confirmationRequired' })
  @ApiConflictResponse({ description: MAIL_CONFLICT })
  @ApiUnprocessableEntityResponse({
    description:
      'body.code: invalidAddress | emptyMail | unknownExport | attachmentsTooLarge',
  })
  @ApiBadGatewayResponse({ description: SMTP_FAILED })
  async send(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() dto: SendMailDto,
  ): Promise<{ log: MailLogEntryDto; sent: ProjectSentResponseDto }> {
    const result = await this.mail.send(user.userId, projectId, dto);
    return {
      log: MailLogEntryDto.from(result.log),
      sent: ProjectSentResponseDto.from(result.sent),
    };
  }

  @Get('log')
  @ApiOperation({ summary: 'The send log of the project, newest first' })
  @ApiOkResponse({ type: [MailLogEntryDto] })
  @ApiNotFoundResponse({ description: 'Missing, or not mine' })
  async log(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ): Promise<MailLogEntryDto[]> {
    return (await this.mail.log(user.userId, projectId)).map(
      MailLogEntryDto.from,
    );
  }
}
