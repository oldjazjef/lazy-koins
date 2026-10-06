import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import {
  ApiBadGatewayResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { AuthenticatedUser } from '../auth/authenticated-user';
import { CurrentUser } from '../auth/current-user.decorator';
import { BEARER_SCHEME } from '../openapi/security-schemes';
import type {
  AssistantSettingsView,
  ChatStatus,
} from './application/assistant.handlers';
import type {
  ConversationSummary,
  ConversationView,
} from './application/chat-views';
import { AssistantService } from './assistant.service';
import {
  AskAssistantDto,
  RenameConversationDto,
  SaveAssistantSettingsDto,
} from './dto/assistant.dto';

/** Each question may take several provider calls: 60 questions per account in 10 minutes. */
const CHAT_BUDGET = { writes: { limit: 60, ttl: 10 * 60_000 } };

const OBJECT = { schema: { type: 'object' } };

@ApiTags('assistant')
@ApiBearerAuth(BEARER_SCHEME)
@Controller('assistant')
export class AssistantSettingsController {
  constructor(private readonly assistant: AssistantService) {}

  @Get('settings')
  @ApiOperation({
    summary:
      'F11.15: the assistant prompt in use, the default, the fixed safety rules, chat consent',
  })
  @ApiOkResponse(OBJECT)
  settings(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<AssistantSettingsView> {
    return this.assistant.settings(user.userId);
  }

  @Put('settings')
  @ApiOperation({
    summary:
      'Save the own prompt (null/"" = default) or withdraw the chat consent',
  })
  @ApiOkResponse(OBJECT)
  save(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: SaveAssistantSettingsDto,
  ): Promise<AssistantSettingsView> {
    return this.assistant.saveSettings(user.userId, body);
  }
}

@ApiTags('assistant')
@ApiBearerAuth(BEARER_SCHEME)
@Controller('chat')
export class ChatController {
  constructor(private readonly assistant: AssistantService) {}

  @Get('status')
  @ApiOperation({
    summary:
      'Whether the chat can be used (AI plugin on and configured) and whether the consent notice is due',
  })
  @ApiOkResponse(OBJECT)
  status(@CurrentUser() user: AuthenticatedUser): Promise<ChatStatus> {
    return this.assistant.status(user.userId);
  }

  @Get('conversations')
  @ApiOperation({ summary: 'My chats, most recent first' })
  @ApiOkResponse(OBJECT)
  list(@CurrentUser() user: AuthenticatedUser): Promise<ConversationSummary[]> {
    return this.assistant.conversations(user.userId);
  }

  @Post('conversations')
  @Throttle(CHAT_BUDGET)
  @ApiOperation({
    summary:
      'Ask in a new chat: the model reads with tools; changes come back as proposals',
  })
  @ApiOkResponse(OBJECT)
  @ApiConflictResponse({
    description:
      'body.code: aiDisabled | aiNotConfigured | consentRequired | keyUnreadable | privateUrl',
  })
  @ApiBadGatewayResponse({ description: 'The provider failed (details)' })
  start(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: AskAssistantDto,
  ): Promise<ConversationView> {
    return this.assistant.ask(user.userId, null, {
      text: body.text,
      context: body.context ?? {},
      consent: body.consent === true,
    });
  }

  @Get('conversations/:id')
  @ApiOperation({ summary: 'One chat with its messages and proposal cards' })
  @ApiOkResponse(OBJECT)
  @ApiNotFoundResponse()
  get(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ConversationView> {
    return this.assistant.conversation(user.userId, id);
  }

  @Post('conversations/:id/messages')
  @Throttle(CHAT_BUDGET)
  @ApiOperation({ summary: 'Ask in an existing chat' })
  @ApiOkResponse(OBJECT)
  @ApiConflictResponse({ description: 'see POST /chat/conversations' })
  @ApiBadGatewayResponse({ description: 'The provider failed (details)' })
  ask(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: AskAssistantDto,
  ): Promise<ConversationView> {
    return this.assistant.ask(user.userId, id, {
      text: body.text,
      context: body.context ?? {},
      consent: body.consent === true,
    });
  }

  @Patch('conversations/:id')
  @ApiOperation({ summary: 'Rename a chat' })
  @ApiOkResponse(OBJECT)
  rename(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: RenameConversationDto,
  ): Promise<ConversationSummary> {
    return this.assistant.rename(user.userId, id, body.title);
  }

  @Delete('conversations/:id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete a chat with all its messages' })
  @ApiNoContentResponse()
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.assistant.remove(user.userId, id);
  }

  @Post('conversations/:id/proposals/:proposalId/confirm')
  @HttpCode(200)
  @ApiOperation({
    summary:
      '"Ausführen": runs the proposed change (audited; closed projects stay read-only)',
  })
  @ApiOkResponse(OBJECT)
  @ApiConflictResponse({ description: 'Already decided' })
  confirm(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('proposalId', ParseUUIDPipe) proposalId: string,
  ): Promise<ConversationView> {
    return this.assistant.decide(user.userId, id, proposalId, 'confirm');
  }

  @Post('conversations/:id/proposals/:proposalId/cancel')
  @HttpCode(200)
  @ApiOperation({ summary: '"Abbrechen": the proposal is dropped' })
  @ApiOkResponse(OBJECT)
  @ApiConflictResponse({ description: 'Already decided' })
  cancel(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('proposalId', ParseUUIDPipe) proposalId: string,
  ): Promise<ConversationView> {
    return this.assistant.decide(user.userId, id, proposalId, 'cancel');
  }
}
