import type {
  AiToolCall,
  AiUsage,
} from '../../integrations/ai/ai-completion.port';
import type { ToolEffect, ToolPreview } from '../../tools/domain/tool';

/** F11.14: the chats of a user ("Verlauf pro Benutzer, löschbar"). */
export interface Conversation {
  readonly id: string;
  readonly userId: string;
  readonly title: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export const CHAT_ROLES = ['user', 'assistant', 'tool', 'event'] as const;
/**
 * `tool` = a tool's (shortened) result as the model saw it — hidden in the app; `event` = what
 * happened outside the model (a proposal executed or cancelled) — shown, and told to the model.
 */
export type ChatRole = (typeof CHAT_ROLES)[number];

/** Something the app renders under an assistant message. */
export type ChatAttachment =
  | {
      readonly kind: 'upload';
      readonly projectId: string;
      readonly message: string;
    }
  | { readonly kind: 'link'; readonly href: string; readonly label: string };

/** The JSON `data` of a message — every field optional. */
export interface ChatMessageData {
  /** assistant: the calls of this turn. */
  readonly toolCalls?: readonly AiToolCall[];
  /** tool: which call this answers. */
  readonly toolCallId?: string;
  readonly toolName?: string;
  readonly isError?: boolean;
  /** assistant (final): what to show under the text. */
  readonly attachments?: readonly ChatAttachment[];
  readonly proposalIds?: readonly string[];
  /** assistant (final): the tools run for this answer (shown small, for transparency). */
  readonly toolsUsed?: readonly string[];
  readonly usage?: AiUsage;
  readonly model?: string;
  /** event: the proposal it is about. */
  readonly proposalId?: string;
}

export interface ChatMessage {
  readonly id: string;
  readonly conversationId: string;
  readonly seq: number;
  readonly role: ChatRole;
  readonly content: string;
  readonly data: ChatMessageData;
  readonly createdAt: string;
}

export type NewChatMessage = Pick<ChatMessage, 'role' | 'content' | 'data'>;

export const PROPOSAL_STATUSES = [
  'pending',
  'executed',
  'failed',
  'cancelled',
] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];

/** A change the assistant proposed; the tool runs only on "Ausführen" (F11.14). */
export interface ChatProposal {
  readonly id: string;
  readonly conversationId: string;
  readonly tool: string;
  readonly args: Readonly<Record<string, unknown>>;
  readonly preview: ToolPreview & {
    readonly title: string;
    readonly effect: ToolEffect;
  };
  readonly status: ProposalStatus;
  /** executed: a short summary of the result; failed: `{ code, message }`. */
  readonly result: unknown;
  readonly createdAt: string;
  readonly decidedAt: string | null;
}

export type NewChatProposal = Pick<
  ChatProposal,
  'tool' | 'args' | 'preview'
> & {
  /** Assigned by the caller so the message can name it before both are stored. */
  readonly id: string;
};

/** A title from the first question: one line, at most 60 characters. */
export function titleFrom(text: string): string {
  const line = text.replace(/\s+/g, ' ').trim();
  if (line === '') return 'Neuer Chat';
  return line.length > 60 ? `${line.slice(0, 59)}…` : line;
}
