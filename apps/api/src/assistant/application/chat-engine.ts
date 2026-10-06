import { randomUUID } from 'node:crypto';
import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AiGate, aiConflict } from '../../ai/application/ai-gate';
import {
  type AiChatMessage,
  AiCompletionPort,
  type AiToolSpec,
  type AiUsage,
} from '../../integrations/ai/ai-completion.port';
import { ProjectsService } from '../../projects/projects.service';
import { ToolExecutor } from '../../tools/application/tool-executor';
import { availableIn, type ToolContext } from '../../tools/domain/tool';
import {
  buildSystemPrompt,
  type ChatPageContext,
} from '../domain/assistant-prompt';
import {
  type AssistantSettings,
  defaultAssistantSettings,
} from '../domain/assistant-settings';
import {
  type ChatAttachment,
  type ChatMessage,
  type Conversation,
  type NewChatMessage,
  type NewChatProposal,
  titleFrom,
} from '../domain/chat';
import {
  AssistantSettingsRepositoryPort,
  ChatRepositoryPort,
} from '../ports/assistant.repository.port';
import { conversationView, type ConversationView } from './chat-views';

/** Model ↔ tools round trips per question; then the answer is cut short. */
export const MAX_TOOL_STEPS = 8;
/** History sent with a question (data minimisation: older turns stay in the database only). */
export const MAX_HISTORY_MESSAGES = 40;
/** A tool result as the model sees it, at most this long. */
export const MAX_TOOL_RESULT_CHARS = 12_000;
/** Older tool results in the history are cut harder. */
const MAX_HISTORY_TOOL_CHARS = 2_000;
const MAX_ANSWER_TOKENS = 4096;
const CHAT_TIMEOUT_MS = 120_000;

export interface ChatQuestion {
  readonly text: string;
  readonly context: ChatPageContext;
  /** F5.14 for the chat: the one-time notice was accepted with this message. */
  readonly consent: boolean;
}

const LIMIT_NOTE =
  'Ich habe für diese Frage zu viele Schritte gebraucht und höre hier auf. Formuliere sie bitte enger oder frag nach dem nächsten Teil.';

/**
 * The chat loop (F11.14): question → model with the tool layer's chat tools → read tools run at
 * once, write/destructive tools become **proposals** (cards with before/after; nothing runs until
 * the user clicks "Ausführen") → their results back to the model → … at most `MAX_TOOL_STEPS`
 * times. The turn is stored only when it completed (an AI error leaves the conversation as it was,
 * so the question can be sent again).
 */
@Injectable()
export class ChatEngine {
  constructor(
    private readonly ai: AiCompletionPort,
    private readonly gate: AiGate,
    private readonly executor: ToolExecutor,
    private readonly chats: ChatRepositoryPort,
    private readonly settings: AssistantSettingsRepositoryPort,
    private readonly projects: ProjectsService,
  ) {}

  async assistantSettings(userId: string): Promise<AssistantSettings> {
    return (
      (await this.settings.find(userId)) ?? defaultAssistantSettings(userId)
    );
  }

  /** Someone else's conversation reads as missing (404), like a project. */
  async ownConversation(
    userId: string,
    conversationId: string,
  ): Promise<Conversation> {
    const conversation = await this.chats.findConversation(conversationId);
    if (!conversation || conversation.userId !== userId) {
      throw new NotFoundException('Conversation not found');
    }
    return conversation;
  }

  async view(conversation: Conversation): Promise<ConversationView> {
    const [messages, proposals] = await Promise.all([
      this.chats.messages(conversation.id),
      this.chats.proposals(conversation.id),
    ]);
    return conversationView(conversation, messages, proposals);
  }

  async ask(
    userId: string,
    conversationId: string | null,
    question: ChatQuestion,
  ): Promise<ConversationView> {
    const connection = this.gate.connectionOf(
      await this.gate.settingsOf(userId),
    );
    const settings = await this.assistantSettings(userId);
    if (!settings.chatConsentAt) {
      if (!question.consent) {
        throw aiConflict(
          'consentRequired',
          'Agree that chat messages and tool results go to the AI provider first',
          'The chat sends your messages and what the tools read for them (projects, figures, file rows) to the configured AI provider. Accept the notice in the chat once (revocable under Einstellungen → AI → Assistent).',
        );
      }
      const { userId: _id, updatedAt: _at, ...rest } = settings;
      await this.settings.save(userId, {
        ...rest,
        chatConsentAt: new Date().toISOString(),
      });
    }

    const existing = conversationId
      ? await this.ownConversation(userId, conversationId)
      : null;
    const history = existing
      ? toAiHistory(await this.chats.messages(existing.id))
      : [];
    const context = await this.enrich(userId, question.context);
    const system = buildSystemPrompt(
      settings.systemPrompt,
      context,
      new Date().toISOString().slice(0, 10),
    );
    const toolContext: ToolContext = { userId, source: 'chat' };
    const tools = this.toolSpecs();

    const stored: NewChatMessage[] = [
      { role: 'user', content: question.text, data: {} },
    ];
    const messages: AiChatMessage[] = [
      ...history,
      { role: 'user', content: question.text },
    ];
    const proposals: NewChatProposal[] = [];
    const attachments: ChatAttachment[] = [];
    const toolsUsed = new Set<string>();
    let usage: AiUsage | undefined;
    let model = '';
    let answer: string | undefined;

    for (let step = 0; step < MAX_TOOL_STEPS && answer === undefined; step++) {
      const turn = await this.gate.call(
        () =>
          this.ai.converse(connection, {
            system,
            messages,
            tools,
            maxTokens: MAX_ANSWER_TOKENS,
            timeoutMs: CHAT_TIMEOUT_MS,
          }),
        connection,
        // F11.12: a failing chat call notifies like every other AI call (code + status only).
        { userId },
      );
      model = turn.model;
      usage = addUsage(usage, turn.usage);
      if (turn.toolCalls.length === 0) {
        answer = turn.text;
        break;
      }
      messages.push({
        role: 'assistant',
        content: turn.text,
        toolCalls: turn.toolCalls,
      });
      stored.push({
        role: 'assistant',
        content: turn.text,
        data: { toolCalls: turn.toolCalls },
      });
      for (const call of turn.toolCalls) {
        toolsUsed.add(call.name);
        const { result, isError } = await this.runTool(
          toolContext,
          call.name,
          call.input,
          proposals,
          attachments,
        );
        const content = cut(JSON.stringify(result), MAX_TOOL_RESULT_CHARS);
        messages.push({
          role: 'tool',
          toolCallId: call.id,
          name: call.name,
          content,
          isError,
        });
        stored.push({
          role: 'tool',
          content,
          data: { toolCallId: call.id, toolName: call.name, isError },
        });
      }
    }

    stored.push({
      role: 'assistant',
      content:
        answer === undefined
          ? LIMIT_NOTE
          : answer.trim() === '' && proposals.length > 0
            ? 'Ich habe folgende Änderung vorbereitet:'
            : answer,
      data: {
        attachments,
        proposalIds: proposals.map((p) => p.id),
        toolsUsed: [...toolsUsed],
        ...(usage ? { usage } : {}),
        ...(model ? { model } : {}),
      },
    });
    const conversation =
      existing ??
      (await this.chats.createConversation(userId, titleFrom(question.text)));
    await this.chats.append(conversation.id, stored, proposals);
    return this.view(
      (await this.chats.findConversation(conversation.id)) ?? conversation,
    );
  }

  /**
   * "Ausführen" / "Abbrechen" on a proposal card. Confirm runs the write tool through the same
   * executor (audited, owner-scoped, closed projects still 409) and records an event the model
   * sees on the next question.
   */
  async decide(
    userId: string,
    conversationId: string,
    proposalId: string,
    action: 'confirm' | 'cancel',
  ): Promise<ConversationView> {
    const conversation = await this.ownConversation(userId, conversationId);
    const proposal = await this.chats.findProposal(proposalId);
    if (!proposal || proposal.conversationId !== conversation.id) {
      throw new NotFoundException('Proposal not found');
    }
    const claimed = await this.chats.decideProposal(
      proposal.id,
      action === 'confirm' ? 'executed' : 'cancelled',
      null,
    );
    if (!claimed) {
      throw new ConflictException('This proposal was already decided');
    }
    let event: string;
    if (action === 'cancel') {
      event = `Abgebrochen: ${proposal.preview.title} – ${proposal.preview.summary}`;
    } else {
      const outcome = await this.executor.call(
        { userId, source: 'chat' },
        proposal.tool,
        proposal.args,
        { confirmed: true },
      );
      if (outcome.ok) {
        await this.chats.setProposalResult(proposal.id, 'executed', {
          // The tool's (shortened) answer, kept with the proposal; the card shows only the status.
          output: cut(JSON.stringify(outcome.output), 2000),
        });
        event = `Ausgeführt: ${proposal.preview.title} – ${proposal.preview.summary}`;
      } else {
        await this.chats.setProposalResult(proposal.id, 'failed', {
          error: { code: outcome.error.code, message: outcome.error.message },
        });
        event = `Fehlgeschlagen: ${proposal.preview.title} – ${outcome.error.message}`;
      }
    }
    await this.chats.append(conversation.id, [
      { role: 'event', content: event, data: { proposalId: proposal.id } },
    ]);
    return this.view(conversation);
  }

  private toolSpecs(): AiToolSpec[] {
    return this.executor.registry.forChat().map((tool) => ({
      name: tool.name,
      description:
        tool.effect === 'readOnly'
          ? tool.description
          : `${tool.description} [Change: the user sees it as a proposal card and it runs only after they confirm.]`,
      inputSchema: this.executor.registry.schemaOf(tool).input,
    }));
  }

  private async runTool(
    context: ToolContext,
    name: string,
    args: unknown,
    proposals: NewChatProposal[],
    attachments: ChatAttachment[],
  ): Promise<{ result: unknown; isError: boolean }> {
    const tool = this.executor.registry.get(name);
    if (tool && availableIn(tool, 'chat') && tool.effect !== 'readOnly') {
      let input: unknown;
      try {
        input = this.executor.parse(tool, args);
      } catch (error) {
        return {
          result: {
            error: {
              code: 'invalidArguments',
              message: error instanceof Error ? error.message : String(error),
            },
          },
          isError: true,
        };
      }
      const preview = await this.executor.preview(context, tool, input);
      const id = randomUUID();
      proposals.push({
        id,
        tool: tool.name,
        args: input as Record<string, unknown>,
        preview: { ...preview, title: tool.title, effect: tool.effect },
      });
      await this.executor.proposed(context, tool.name, input);
      return {
        result: {
          status: 'proposed',
          proposalId: id,
          note: 'Shown to the user as a proposal card. It runs only when the user clicks "Ausführen"; do not call it again and do not claim it is done.',
        },
        isError: false,
      };
    }
    const outcome = await this.executor.call(context, name, args);
    if (!outcome.ok) {
      return { result: { error: outcome.error }, isError: true };
    }
    if (name === 'request_file_upload') {
      const input = args as { projectId: string; message: string };
      attachments.push({
        kind: 'upload',
        projectId: String(input.projectId),
        message: String(input.message),
      });
    } else if (name === 'navigate') {
      const output = outcome.output as { href: string; label: string };
      attachments.push({
        kind: 'link',
        href: output.href,
        label: output.label,
      });
    }
    return { result: outcome.output, isError: false };
  }

  /** The page context with the project's name — only for the user's own project. */
  private async enrich(
    userId: string,
    context: ChatPageContext,
  ): Promise<ChatPageContext> {
    if (!context.projectId) return context;
    try {
      const project = await this.projects.get(userId, context.projectId);
      return {
        ...context,
        projectName: project.name,
        projectTaxYear: project.taxYear,
        projectStatus: project.status,
      };
    } catch {
      const { projectId: _ignored, ...rest } = context;
      return rest;
    }
  }
}

function addUsage(
  total: AiUsage | undefined,
  next: AiUsage | undefined,
): AiUsage | undefined {
  if (!next) return total;
  return {
    inputTokens: (total?.inputTokens ?? 0) + next.inputTokens,
    outputTokens: (total?.outputTokens ?? 0) + next.outputTokens,
  };
}

function cut(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 20)}… [truncated]` : text;
}

/**
 * The stored conversation as the model sees it: the last `MAX_HISTORY_MESSAGES` turns, starting
 * at a user message (never in the middle of a tool round trip), older tool results cut short,
 * events as short user notes.
 */
export function toAiHistory(messages: readonly ChatMessage[]): AiChatMessage[] {
  let recent = messages.slice(-MAX_HISTORY_MESSAGES);
  const firstUser = recent.findIndex(
    (m) => m.role === 'user' || m.role === 'event',
  );
  recent = firstUser < 0 ? [] : recent.slice(firstUser);
  const out: AiChatMessage[] = [];
  for (const message of recent) {
    switch (message.role) {
      case 'user':
        out.push({ role: 'user', content: message.content });
        break;
      case 'event':
        out.push({ role: 'user', content: `[App] ${message.content}` });
        break;
      case 'assistant':
        out.push({
          role: 'assistant',
          content: message.content,
          ...(message.data.toolCalls?.length
            ? { toolCalls: message.data.toolCalls }
            : {}),
        });
        break;
      case 'tool':
        out.push({
          role: 'tool',
          toolCallId: message.data.toolCallId ?? '',
          name: message.data.toolName ?? '',
          content: cut(message.content, MAX_HISTORY_TOOL_CHARS),
          ...(message.data.isError ? { isError: true } : {}),
        });
        break;
    }
  }
  return out;
}
