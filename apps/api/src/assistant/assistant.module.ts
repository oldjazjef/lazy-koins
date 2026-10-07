import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { AiModule } from '../ai/ai.module';
import { ProjectsModule } from '../projects/projects.module';
import { SettingsModule } from '../settings/settings.module';
import { ToolsModule } from '../tools/tools.module';
import {
  AskAssistantHandler,
  DecideProposalHandler,
  DeleteConversationHandler,
  GetAssistantSettingsHandler,
  GetChatStatusHandler,
  GetConversationHandler,
  ListConversationsHandler,
  RenameConversationHandler,
  SaveAssistantSettingsHandler,
} from './application/assistant.handlers';
import { ChatEngine } from './application/chat-engine';
import {
  AssistantSettingsController,
  ChatController,
} from './assistant.controller';
import { AssistantService } from './assistant.service';

/**
 * The AI assistant (F11.14, F11.15): the chat sidebar's conversations, the loop over the AI
 * plugin with the shared tool layer (writes only as confirmed proposals), and the assistant's
 * prompt in Einstellungen › AI.
 */
@Module({
  imports: [CqrsModule, AiModule, ProjectsModule, ToolsModule, SettingsModule],
  controllers: [AssistantSettingsController, ChatController],
  providers: [
    AssistantService,
    ChatEngine,
    GetAssistantSettingsHandler,
    SaveAssistantSettingsHandler,
    GetChatStatusHandler,
    ListConversationsHandler,
    GetConversationHandler,
    RenameConversationHandler,
    DeleteConversationHandler,
    AskAssistantHandler,
    DecideProposalHandler,
  ],
  exports: [ChatEngine],
})
export class AssistantModule {}
