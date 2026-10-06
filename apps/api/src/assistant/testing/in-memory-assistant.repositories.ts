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
import {
  AssistantSettingsRepositoryPort,
  ChatRepositoryPort,
} from '../ports/assistant.repository.port';

/** Port double over a Map. */
export class InMemoryAssistantSettingsRepository extends AssistantSettingsRepositoryPort {
  readonly rows = new Map<string, AssistantSettings>();

  async find(userId: string): Promise<AssistantSettings | null> {
    return this.rows.get(userId) ?? null;
  }

  async save(
    userId: string,
    settings: SaveAssistantSettings,
  ): Promise<AssistantSettings> {
    const row: AssistantSettings = {
      ...settings,
      mcpAreas: [...settings.mcpAreas],
      userId,
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    this.rows.set(userId, row);
    return row;
  }
}

/** Port double: conversations, messages and proposals in Maps; ids are counters. */
export class InMemoryChatRepository extends ChatRepositoryPort {
  readonly conversations = new Map<string, Conversation>();
  readonly messageRows = new Map<string, ChatMessage[]>();
  readonly proposalRows = new Map<string, ChatProposal>();
  private next = 1;
  private clock = 0;

  private now(): string {
    this.clock += 1;
    return new Date(Date.UTC(2026, 0, 1, 0, 0, this.clock)).toISOString();
  }

  /** UUID-shaped (the controllers parse ids with ParseUUIDPipe), counting up. */
  private id(): string {
    const n = String(this.next++).padStart(12, '0');
    return `00000000-0000-7000-8000-${n}`;
  }

  async listConversations(userId: string): Promise<Conversation[]> {
    return [...this.conversations.values()]
      .filter((c) => c.userId === userId)
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  }

  async findConversation(id: string): Promise<Conversation | null> {
    return this.conversations.get(id) ?? null;
  }

  async createConversation(
    userId: string,
    title: string,
  ): Promise<Conversation> {
    const at = this.now();
    const conversation = {
      id: this.id(),
      userId,
      title,
      createdAt: at,
      updatedAt: at,
    };
    this.conversations.set(conversation.id, conversation);
    this.messageRows.set(conversation.id, []);
    return conversation;
  }

  async renameConversation(id: string, title: string): Promise<Conversation> {
    const current = this.conversations.get(id);
    if (!current) throw new Error('missing conversation');
    const renamed = { ...current, title, updatedAt: this.now() };
    this.conversations.set(id, renamed);
    return renamed;
  }

  async deleteConversation(id: string): Promise<void> {
    this.conversations.delete(id);
    this.messageRows.delete(id);
    for (const [pid, proposal] of this.proposalRows) {
      if (proposal.conversationId === id) this.proposalRows.delete(pid);
    }
  }

  async messages(conversationId: string): Promise<ChatMessage[]> {
    return [...(this.messageRows.get(conversationId) ?? [])];
  }

  async append(
    conversationId: string,
    messages: readonly NewChatMessage[],
    proposals: readonly NewChatProposal[] = [],
  ): Promise<ChatMessage[]> {
    const rows = this.messageRows.get(conversationId);
    if (!rows) throw new Error('missing conversation');
    for (const proposal of proposals) {
      this.proposalRows.set(proposal.id, {
        ...proposal,
        conversationId,
        status: 'pending',
        result: null,
        createdAt: this.now(),
        decidedAt: null,
      });
    }
    const out: ChatMessage[] = [];
    for (const message of messages) {
      const row: ChatMessage = {
        ...message,
        id: this.id(),
        conversationId,
        seq: rows.length,
        createdAt: this.now(),
      };
      rows.push(row);
      out.push(row);
    }
    const conversation = this.conversations.get(conversationId);
    if (conversation) {
      this.conversations.set(conversationId, {
        ...conversation,
        updatedAt: this.now(),
      });
    }
    return out;
  }

  async proposals(conversationId: string): Promise<ChatProposal[]> {
    return [...this.proposalRows.values()].filter(
      (p) => p.conversationId === conversationId,
    );
  }

  async findProposal(id: string): Promise<ChatProposal | null> {
    return this.proposalRows.get(id) ?? null;
  }

  async decideProposal(
    id: string,
    status: Exclude<ProposalStatus, 'pending'>,
    result: unknown,
  ): Promise<ChatProposal | null> {
    const proposal = this.proposalRows.get(id);
    if (!proposal || proposal.status !== 'pending') return null;
    const decided = { ...proposal, status, result, decidedAt: this.now() };
    this.proposalRows.set(id, decided);
    return decided;
  }

  async setProposalResult(
    id: string,
    status: Exclude<ProposalStatus, 'pending'>,
    result: unknown,
  ): Promise<ChatProposal> {
    const proposal = this.proposalRows.get(id);
    if (!proposal) throw new Error('missing proposal');
    const updated = { ...proposal, status, result };
    this.proposalRows.set(id, updated);
    return updated;
  }
}
