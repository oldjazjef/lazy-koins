import { Injectable } from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import {
  AskAssistantCommand,
  type AssistantSettingsView,
  type ChatStatus,
  DecideProposalCommand,
  DeleteConversationCommand,
  GetAssistantSettingsQuery,
  GetChatStatusQuery,
  GetConversationQuery,
  ListConversationsQuery,
  RenameConversationCommand,
  SaveAssistantSettingsCommand,
  type SaveAssistantSettingsInput,
} from './application/assistant.handlers';
import type { ChatQuestion } from './application/chat-engine';
import type {
  ConversationSummary,
  ConversationView,
} from './application/chat-views';

/** Thin façade over the buses — no logic here; it lives in the handlers. */
@Injectable()
export class AssistantService {
  constructor(
    private readonly commands: CommandBus,
    private readonly queries: QueryBus,
  ) {}

  settings(userId: string): Promise<AssistantSettingsView> {
    return this.queries.execute(new GetAssistantSettingsQuery(userId));
  }

  saveSettings(
    userId: string,
    input: SaveAssistantSettingsInput,
  ): Promise<AssistantSettingsView> {
    return this.commands.execute(
      new SaveAssistantSettingsCommand(userId, input),
    );
  }

  status(userId: string): Promise<ChatStatus> {
    return this.queries.execute(new GetChatStatusQuery(userId));
  }

  conversations(userId: string): Promise<ConversationSummary[]> {
    return this.queries.execute(new ListConversationsQuery(userId));
  }

  conversation(
    userId: string,
    conversationId: string,
  ): Promise<ConversationView> {
    return this.queries.execute(
      new GetConversationQuery(userId, conversationId),
    );
  }

  rename(
    userId: string,
    conversationId: string,
    title: string,
  ): Promise<ConversationSummary> {
    return this.commands.execute(
      new RenameConversationCommand(userId, conversationId, title),
    );
  }

  remove(userId: string, conversationId: string): Promise<void> {
    return this.commands.execute(
      new DeleteConversationCommand(userId, conversationId),
    );
  }

  ask(
    userId: string,
    conversationId: string | null,
    question: ChatQuestion,
  ): Promise<ConversationView> {
    return this.commands.execute(
      new AskAssistantCommand(userId, conversationId, question),
    );
  }

  decide(
    userId: string,
    conversationId: string,
    proposalId: string,
    action: 'confirm' | 'cancel',
  ): Promise<ConversationView> {
    return this.commands.execute(
      new DecideProposalCommand(userId, conversationId, proposalId, action),
    );
  }
}
