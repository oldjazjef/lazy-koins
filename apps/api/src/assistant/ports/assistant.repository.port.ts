import type {
  AssistantSettings,
  SaveAssistantSettings,
} from '../domain/assistant-settings';
import type {
  ChatMessage,
  ChatProposal,
  Conversation,
  NewChatMessage,
  NewChatProposal,
  ProposalStatus,
} from '../domain/chat';

/** F11.15/F11.16 settings per user; no row = `defaultAssistantSettings`. */
export abstract class AssistantSettingsRepositoryPort {
  abstract find(userId: string): Promise<AssistantSettings | null>;
  abstract save(
    userId: string,
    settings: SaveAssistantSettings,
  ): Promise<AssistantSettings>;
}

/** F11.14: conversations, their messages and proposals. Ownership is checked by the handlers. */
export abstract class ChatRepositoryPort {
  /** The user's conversations, most recently changed first. */
  abstract listConversations(userId: string): Promise<Conversation[]>;
  abstract findConversation(id: string): Promise<Conversation | null>;
  abstract createConversation(
    userId: string,
    title: string,
  ): Promise<Conversation>;
  abstract renameConversation(id: string, title: string): Promise<Conversation>;
  /** Deletes the conversation with its messages and proposals (cascade). */
  abstract deleteConversation(id: string): Promise<void>;

  /** In order (`seq`). */
  abstract messages(conversationId: string): Promise<ChatMessage[]>;
  /**
   * Appends messages (numbered after the last) and stores proposals, in one transaction; touches
   * the conversation's `updatedAt`.
   */
  abstract append(
    conversationId: string,
    messages: readonly NewChatMessage[],
    proposals?: readonly NewChatProposal[],
  ): Promise<ChatMessage[]>;

  abstract proposals(conversationId: string): Promise<ChatProposal[]>;
  abstract findProposal(id: string): Promise<ChatProposal | null>;
  /**
   * Moves a `pending` proposal to a decision — atomically, so a double click cannot run a tool
   * twice; `null` when it was not pending any more.
   */
  abstract decideProposal(
    id: string,
    status: Exclude<ProposalStatus, 'pending'>,
    result: unknown,
  ): Promise<ChatProposal | null>;
  /** Records the outcome of a proposal that was already decided (executed → failed, result). */
  abstract setProposalResult(
    id: string,
    status: Exclude<ProposalStatus, 'pending'>,
    result: unknown,
  ): Promise<ChatProposal>;
}
