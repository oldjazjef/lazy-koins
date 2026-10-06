import { HttpException, UnprocessableEntityException } from '@nestjs/common';
import {
  CommandHandler,
  type ICommandHandler,
  type IQueryHandler,
  QueryHandler,
} from '@nestjs/cqrs';
import { AiGate } from '../../ai/application/ai-gate';
import { aiReady } from '../../ai/domain/ai-settings';
import {
  DEFAULT_SYSTEM_PROMPT,
  SAFETY_RULES,
} from '../domain/assistant-prompt';
import {
  type AssistantSettings,
  MAX_SYSTEM_PROMPT,
} from '../domain/assistant-settings';
import { titleFrom } from '../domain/chat';
import {
  AssistantSettingsRepositoryPort,
  ChatRepositoryPort,
} from '../ports/assistant.repository.port';
import { ChatEngine, type ChatQuestion } from './chat-engine';
import {
  type ConversationSummary,
  type ConversationView,
  summaryOf,
} from './chat-views';

// --- Einstellungen › AI › Assistent (F11.15) ---

export interface AssistantSettingsView {
  /** The prompt in use: the user's own, or the default. */
  readonly systemPrompt: string;
  readonly isDefault: boolean;
  readonly defaultPrompt: string;
  /** Always appended on the server; shown read-only. */
  readonly safetyRules: string;
  readonly maxLength: number;
  readonly chatConsentAt: string | null;
}

function settingsView(settings: AssistantSettings): AssistantSettingsView {
  return {
    systemPrompt: settings.systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
    isDefault: settings.systemPrompt === null,
    defaultPrompt: DEFAULT_SYSTEM_PROMPT,
    safetyRules: SAFETY_RULES,
    maxLength: MAX_SYSTEM_PROMPT,
    chatConsentAt: settings.chatConsentAt,
  };
}

export class GetAssistantSettingsQuery {
  constructor(readonly userId: string) {}
}

@QueryHandler(GetAssistantSettingsQuery)
export class GetAssistantSettingsHandler implements IQueryHandler<
  GetAssistantSettingsQuery,
  AssistantSettingsView
> {
  constructor(private readonly engine: ChatEngine) {}

  async execute({
    userId,
  }: GetAssistantSettingsQuery): Promise<AssistantSettingsView> {
    return settingsView(await this.engine.assistantSettings(userId));
  }
}

export interface SaveAssistantSettingsInput {
  /** `null` = back to the default (F11.15 "auf Standard zurücksetzen"). */
  readonly systemPrompt?: string | null;
  /** F5.14: withdraw the chat consent — the notice shows again. */
  readonly revokeChatConsent?: boolean;
}

export class SaveAssistantSettingsCommand {
  constructor(
    readonly userId: string,
    readonly input: SaveAssistantSettingsInput,
  ) {}
}

@CommandHandler(SaveAssistantSettingsCommand)
export class SaveAssistantSettingsHandler implements ICommandHandler<
  SaveAssistantSettingsCommand,
  AssistantSettingsView
> {
  constructor(
    private readonly engine: ChatEngine,
    private readonly settings: AssistantSettingsRepositoryPort,
  ) {}

  async execute({
    userId,
    input,
  }: SaveAssistantSettingsCommand): Promise<AssistantSettingsView> {
    const current = await this.engine.assistantSettings(userId);
    let systemPrompt = current.systemPrompt;
    if (input.systemPrompt !== undefined) {
      const text = input.systemPrompt?.trim() ?? '';
      if (text.length > MAX_SYSTEM_PROMPT) {
        throw new UnprocessableEntityException({
          statusCode: 422,
          message: `The prompt may have at most ${MAX_SYSTEM_PROMPT} characters`,
          code: 'promptTooLong',
        });
      }
      // An empty text or the default itself = the default (it then follows future updates).
      systemPrompt =
        text === '' || text === DEFAULT_SYSTEM_PROMPT.trim() ? null : text;
    }
    const { userId: _id, updatedAt: _at, ...rest } = current;
    return settingsView(
      await this.settings.save(userId, {
        ...rest,
        systemPrompt,
        chatConsentAt: input.revokeChatConsent ? null : current.chatConsentAt,
      }),
    );
  }
}

// --- Chat status for the sidebar ---

export interface ChatStatus {
  /** The AI plugin is on and configured — otherwise the sidebar shows the setup hint. */
  readonly available: boolean;
  /** Why not: `aiDisabled | aiNotConfigured | privateUrl | invalidUrl | keyUnreadable`. */
  readonly code: string | null;
  readonly detail: string | null;
  /** F5.14: the one-time notice has to be accepted before the first message. */
  readonly consentRequired: boolean;
  readonly provider: string;
  readonly model: string;
}

export class GetChatStatusQuery {
  constructor(readonly userId: string) {}
}

@QueryHandler(GetChatStatusQuery)
export class GetChatStatusHandler implements IQueryHandler<
  GetChatStatusQuery,
  ChatStatus
> {
  constructor(
    private readonly gate: AiGate,
    private readonly engine: ChatEngine,
  ) {}

  async execute({ userId }: GetChatStatusQuery): Promise<ChatStatus> {
    const ai = await this.gate.settingsOf(userId);
    const assistant = await this.engine.assistantSettings(userId);
    let code: string | null = null;
    let detail: string | null = null;
    try {
      this.gate.connectionOf(ai);
    } catch (error) {
      if (!(error instanceof HttpException)) throw error;
      const body = error.getResponse() as { code?: string; detail?: string };
      code = body.code ?? 'aiNotConfigured';
      detail = body.detail ?? null;
    }
    return {
      available: code === null && aiReady(ai),
      code,
      detail,
      consentRequired: assistant.chatConsentAt === null,
      provider: ai.provider,
      model: ai.model,
    };
  }
}

// --- Conversations ---

export class ListConversationsQuery {
  constructor(readonly userId: string) {}
}

@QueryHandler(ListConversationsQuery)
export class ListConversationsHandler implements IQueryHandler<
  ListConversationsQuery,
  ConversationSummary[]
> {
  constructor(private readonly chats: ChatRepositoryPort) {}

  async execute({
    userId,
  }: ListConversationsQuery): Promise<ConversationSummary[]> {
    return (await this.chats.listConversations(userId)).map(summaryOf);
  }
}

export class GetConversationQuery {
  constructor(
    readonly userId: string,
    readonly conversationId: string,
  ) {}
}

@QueryHandler(GetConversationQuery)
export class GetConversationHandler implements IQueryHandler<
  GetConversationQuery,
  ConversationView
> {
  constructor(private readonly engine: ChatEngine) {}

  async execute({
    userId,
    conversationId,
  }: GetConversationQuery): Promise<ConversationView> {
    return this.engine.view(
      await this.engine.ownConversation(userId, conversationId),
    );
  }
}

export class RenameConversationCommand {
  constructor(
    readonly userId: string,
    readonly conversationId: string,
    readonly title: string,
  ) {}
}

@CommandHandler(RenameConversationCommand)
export class RenameConversationHandler implements ICommandHandler<
  RenameConversationCommand,
  ConversationSummary
> {
  constructor(
    private readonly engine: ChatEngine,
    private readonly chats: ChatRepositoryPort,
  ) {}

  async execute({
    userId,
    conversationId,
    title,
  }: RenameConversationCommand): Promise<ConversationSummary> {
    const conversation = await this.engine.ownConversation(
      userId,
      conversationId,
    );
    return summaryOf(
      await this.chats.renameConversation(conversation.id, titleFrom(title)),
    );
  }
}

export class DeleteConversationCommand {
  constructor(
    readonly userId: string,
    readonly conversationId: string,
  ) {}
}

/** Deletes the chat with every message and proposal (F11.14 "Verlauf … löschbar"). */
@CommandHandler(DeleteConversationCommand)
export class DeleteConversationHandler implements ICommandHandler<
  DeleteConversationCommand,
  void
> {
  constructor(
    private readonly engine: ChatEngine,
    private readonly chats: ChatRepositoryPort,
  ) {}

  async execute({
    userId,
    conversationId,
  }: DeleteConversationCommand): Promise<void> {
    const conversation = await this.engine.ownConversation(
      userId,
      conversationId,
    );
    await this.chats.deleteConversation(conversation.id);
  }
}

export class AskAssistantCommand {
  constructor(
    readonly userId: string,
    /** null = a new conversation (created when the answer is there). */
    readonly conversationId: string | null,
    readonly question: ChatQuestion,
  ) {}
}

@CommandHandler(AskAssistantCommand)
export class AskAssistantHandler implements ICommandHandler<
  AskAssistantCommand,
  ConversationView
> {
  constructor(private readonly engine: ChatEngine) {}

  execute({
    userId,
    conversationId,
    question,
  }: AskAssistantCommand): Promise<ConversationView> {
    return this.engine.ask(userId, conversationId, question);
  }
}

export class DecideProposalCommand {
  constructor(
    readonly userId: string,
    readonly conversationId: string,
    readonly proposalId: string,
    readonly action: 'confirm' | 'cancel',
  ) {}
}

@CommandHandler(DecideProposalCommand)
export class DecideProposalHandler implements ICommandHandler<
  DecideProposalCommand,
  ConversationView
> {
  constructor(private readonly engine: ChatEngine) {}

  execute({
    userId,
    conversationId,
    proposalId,
    action,
  }: DecideProposalCommand): Promise<ConversationView> {
    return this.engine.decide(userId, conversationId, proposalId, action);
  }
}
