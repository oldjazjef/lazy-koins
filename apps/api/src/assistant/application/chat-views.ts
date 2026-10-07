import type {
  ToolChange,
  ToolEffect,
  ToolValue,
} from '../../tools/domain/tool';
import type {
  ChatAttachment,
  ChatEventOutcome,
  ChatMessage,
  ChatProposal,
  Conversation,
  ProposalStatus,
} from '../domain/chat';

/** A proposal card (F11.14): what will change, before → after, and what became of it. */
export interface ProposalView {
  readonly id: string;
  readonly tool: string;
  readonly title: string;
  readonly effect: ToolEffect;
  /** F11.2: keys + values the web translates (a proposal stored before: a German sentence). */
  readonly summary: ToolValue;
  readonly changes: readonly ToolChange[];
  readonly projectId: string | null;
  readonly status: ProposalStatus;
  /** executed: a one-line summary; failed: the error. */
  readonly outcome: {
    readonly summary?: string;
    readonly error?: { readonly code: string; readonly message: string };
  } | null;
  readonly decidedAt: string | null;
}

/** What the sidebar shows: the user's and the assistant's messages and events — no tool rows. */
export interface ChatMessageView {
  readonly id: string;
  readonly role: 'user' | 'assistant' | 'event';
  readonly content: string;
  readonly createdAt: string;
  readonly attachments: readonly ChatAttachment[];
  readonly proposals: readonly ProposalView[];
  readonly toolsUsed: readonly string[];
  /** event: what became of which proposal — rendered by the app in the user's language. */
  readonly event?: ChatEventView;
}

export interface ChatEventView {
  readonly outcome: ChatEventOutcome;
  /** The proposal card's title. */
  readonly title: string;
  /** failed: the tool's error code (`conflict`, `notFound`, …). */
  readonly errorCode?: string;
}

export interface ConversationSummary {
  readonly id: string;
  readonly title: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ConversationView extends ConversationSummary {
  readonly messages: readonly ChatMessageView[];
}

export function summaryOf(conversation: Conversation): ConversationSummary {
  return {
    id: conversation.id,
    title: conversation.title,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
  };
}

export function proposalView(proposal: ChatProposal): ProposalView {
  const result = proposal.result as {
    summary?: unknown;
    error?: { code?: unknown; message?: unknown };
  } | null;
  return {
    id: proposal.id,
    tool: proposal.tool,
    title: proposal.preview.title,
    effect: proposal.preview.effect,
    summary: proposal.preview.summary,
    changes: proposal.preview.changes,
    projectId: proposal.preview.projectId ?? null,
    status: proposal.status,
    outcome: result
      ? {
          ...(typeof result.summary === 'string'
            ? { summary: result.summary }
            : {}),
          ...(result.error
            ? {
                error: {
                  code: String(result.error.code ?? 'failed'),
                  message: String(result.error.message ?? ''),
                },
              }
            : {}),
        }
      : null,
    decidedAt: proposal.decidedAt,
  };
}

export function conversationView(
  conversation: Conversation,
  messages: readonly ChatMessage[],
  proposals: readonly ChatProposal[],
): ConversationView {
  const byId = new Map(proposals.map((p) => [p.id, proposalView(p)]));
  const shown: ChatMessageView[] = [];
  for (const message of messages) {
    if (message.role === 'tool') continue;
    const cards = (message.data.proposalIds ?? [])
      .map((id) => byId.get(id))
      .filter((card): card is ProposalView => card !== undefined);
    const attachments = message.data.attachments ?? [];
    if (
      message.role === 'assistant' &&
      message.content.trim() === '' &&
      cards.length === 0 &&
      attachments.length === 0
    ) {
      continue;
    }
    shown.push({
      id: message.id,
      role: message.role,
      content: message.content,
      createdAt: message.createdAt,
      attachments,
      proposals: cards,
      toolsUsed: message.data.toolsUsed ?? [],
      ...eventOf(message, byId),
    });
  }
  return { ...summaryOf(conversation), messages: shown };
}

/** An event row with its outcome (rows stored before F11.2 have none and show their text). */
function eventOf(
  message: ChatMessage,
  proposals: ReadonlyMap<string, ProposalView>,
): { event?: ChatEventView } {
  const { outcome, proposalId } = message.data;
  if (message.role !== 'event' || !outcome || !proposalId) return {};
  const proposal = proposals.get(proposalId);
  if (!proposal) return {};
  const errorCode = proposal.outcome?.error?.code;
  return {
    event: {
      outcome,
      title: proposal.title,
      ...(outcome === 'failed' && errorCode ? { errorCode } : {}),
    },
  };
}
