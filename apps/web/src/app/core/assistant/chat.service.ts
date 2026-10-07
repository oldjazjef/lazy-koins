import {
  HttpClient,
  HttpErrorResponse,
  httpResource,
} from '@angular/common/http';
import { computed, inject, Injectable, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { defineAction } from '../actions/action';
import { ActionRunner } from '../actions/action-runner';
import { extractErrorDetail } from '../actions/extract-error-detail';
import { apiUrl } from '../api/api-url';
import type {
  AskRequest,
  ChatStatus,
  ConversationSummary,
  ConversationView,
  ProposalView,
} from '../api/assistant.types';
import { NotificationService } from '../notifications/notification.service';
import {
  aiErrorInfo,
  type AiErrorInfo,
} from '../../shared/ai/ai-error-details';
import { AI_ERROR_CODES } from '../../shared/ai/ai-error-key';
import { AssistantEvents } from './assistant-events';
import { ChatContextService } from './chat-context.service';

// A template literal: i18n-keys.spec.ts reads quoted dotted literals as translation keys.
const OPEN_KEY = `lk.chat.open`;
/** Below this width the sidebar is an overlay (Tailwind `lg`). */
const OVERLAY_QUERY = '(max-width: 1023.98px)';
export const MAX_QUESTION = 4000;

/**
 * The assistant chat (F11.14): open state of the sidebar, the chat's status (available, consent),
 * the conversations, the one on screen, asking, and deciding proposals. Root-provided, so the
 * conversation survives navigation. Every question carries the context (route, project, tab).
 */
@Injectable({ providedIn: 'root' })
export class ChatService {
  private readonly http = inject(HttpClient);
  private readonly actions = inject(ActionRunner);
  private readonly notifications = inject(NotificationService);
  private readonly events = inject(AssistantEvents);
  private readonly contextService = inject(ChatContextService);

  readonly open = signal(readOpen());

  /** Reloaded every time the sidebar opens and after the settings changed. */
  readonly status = httpResource<ChatStatus>(() => {
    this.events.settingsVersion();
    return this.open() ? apiUrl('/chat/status') : undefined;
  });
  readonly conversations = httpResource<ConversationSummary[]>(() =>
    this.open() ? apiUrl('/chat/conversations') : undefined,
  );

  readonly conversation = signal<ConversationView | null>(null);
  /** The question being answered (shown as the user's bubble until the answer is there). */
  readonly pending = signal<string | null>(null);
  readonly thinking = computed(() => this.pending() !== null);
  /** What is typed — kept here so closing the sidebar keeps it. */
  readonly draft = signal('');
  /** The last failed question, with the provider's details. */
  readonly error = signal<AiErrorInfo | null>(null);
  /** F5.14: the user agreed in the notice; the next question sends `consent: true`. */
  readonly consentAccepted = signal(false);

  readonly ready = computed(() => {
    if (!this.status.hasValue()) return false;
    return this.status.value().available;
  });
  readonly needsConsent = computed(
    () =>
      this.status.hasValue() &&
      this.status.value().available &&
      this.status.value().consentRequired &&
      !this.consentAccepted(),
  );

  private readonly decideAction = defineAction<
    { conversationId: string; proposalId: string; decision: Decision },
    ConversationView
  >({
    run: ({ conversationId, proposalId, decision }) =>
      firstValueFrom(
        this.http.post<ConversationView>(
          apiUrl(
            `/chat/conversations/${conversationId}/proposals/${proposalId}/${decision}`,
          ),
          {},
        ),
      ),
  });

  private readonly renameAction = defineAction<
    { id: string; title: string },
    ConversationSummary
  >({
    run: ({ id, title }) =>
      firstValueFrom(
        this.http.patch<ConversationSummary>(
          apiUrl(`/chat/conversations/${id}`),
          { title },
        ),
      ),
    messages: { success: 'chat.renamed', error: 'chat.renameFailed' },
  });

  private readonly deleteAction = defineAction<string, void>({
    run: (id) =>
      firstValueFrom(
        this.http.delete<void>(apiUrl(`/chat/conversations/${id}`)),
      ),
    messages: { success: 'chat.deleted', error: 'chat.deleteFailed' },
  });

  private readonly decisionStatus = this.actions.status<unknown>('chat-decide');
  readonly deciding = computed(
    () => this.decisionStatus()?.state === 'pending',
  );

  toggle(): void {
    this.setOpen(!this.open());
  }

  close(): void {
    this.setOpen(false);
  }

  /** After following a link from the chat: on narrow screens the overlay gets out of the way. */
  navigated(): void {
    if (isOverlay()) this.close();
  }

  acceptConsent(): void {
    this.consentAccepted.set(true);
  }

  newChat(): void {
    this.conversation.set(null);
    this.error.set(null);
  }

  async select(id: string): Promise<void> {
    this.error.set(null);
    try {
      this.conversation.set(
        await firstValueFrom(
          this.http.get<ConversationView>(apiUrl(`/chat/conversations/${id}`)),
        ),
      );
    } catch (error) {
      this.notifications.error('chat.loadFailed', extractErrorDetail(error));
    }
  }

  /**
   * Sends a question — a new conversation when none is on screen. Resolves true when answered;
   * on failure nothing was stored, so the caller keeps the text in the input.
   */
  async ask(text: string): Promise<boolean> {
    const question = text.trim();
    if (question === '' || this.thinking()) return false;
    const consent = this.consentAccepted();
    const body: AskRequest = {
      text: question.slice(0, MAX_QUESTION),
      context: this.contextService.context(),
      ...(consent ? { consent: true } : {}),
    };
    const current = this.conversation();
    const url = current
      ? apiUrl(`/chat/conversations/${current.id}/messages`)
      : apiUrl('/chat/conversations');
    this.error.set(null);
    this.pending.set(question);
    try {
      // No activity snackbar: the chat shows its own "thinking" state (user rule).
      const view = await firstValueFrom(
        this.http.post<ConversationView>(url, body),
      );
      this.conversation.set(view);
      if (consent) {
        // Stored by the API: never asked again (until revoked in the settings).
        if (this.status.hasValue()) {
          this.status.set({ ...this.status.value(), consentRequired: false });
        }
        this.consentAccepted.set(false);
      }
      this.conversations.reload();
      return true;
    } catch (error) {
      this.failed(error);
      return false;
    } finally {
      this.pending.set(null);
    }
  }

  /** "Ausführen": the API runs the proposed change; the rest of the app reloads what it shows. */
  confirm(proposal: ProposalView): Promise<void> {
    return this.decide(proposal, 'confirm');
  }

  /** "Abbrechen": nothing is changed. */
  cancel(proposal: ProposalView): Promise<void> {
    return this.decide(proposal, 'cancel');
  }

  async rename(id: string, title: string): Promise<void> {
    const summary = await this.actions.run(this.renameAction, { id, title });
    this.conversation.update((view) =>
      view && view.id === id ? { ...view, title: summary.title } : view,
    );
    this.conversations.reload();
  }

  async remove(id: string): Promise<void> {
    await this.actions.run(this.deleteAction, id);
    if (this.conversation()?.id === id) this.newChat();
    this.conversations.reload();
  }

  private async decide(
    proposal: ProposalView,
    decision: Decision,
  ): Promise<void> {
    const conversationId = this.conversation()?.id;
    if (!conversationId) return;
    try {
      const view = await this.actions.run(
        this.decideAction,
        { conversationId, proposalId: proposal.id, decision },
        {
          key: 'chat-decide',
          silent: true,
        },
      );
      this.conversation.set(view);
      if (decision === 'confirm') this.events.changed(proposal.projectId);
    } catch (error) {
      const decided =
        error instanceof HttpErrorResponse && error.status === 409;
      this.notifications.error(
        decided ? 'chat.proposal.alreadyDecided' : 'chat.proposal.failed',
        decided ? undefined : extractErrorDetail(error),
      );
      if (decided) await this.select(conversationId);
    }
  }

  private failed(error: unknown): void {
    const code =
      error instanceof HttpErrorResponse
        ? (error.error as { code?: unknown } | null)?.code
        : undefined;
    const aiCode =
      typeof code === 'string' &&
      (AI_ERROR_CODES as readonly string[]).includes(code);
    if (aiCode || (error instanceof HttpErrorResponse && error.status === 0)) {
      this.error.set(aiErrorInfo(error));
      if (code === 'consentRequired') this.consentAccepted.set(false);
      if (
        aiCode &&
        error instanceof HttpErrorResponse &&
        error.status === 409
      ) {
        this.status.reload();
      }
      return;
    }
    this.notifications.error('chat.askFailed', extractErrorDetail(error));
  }

  private setOpen(open: boolean): void {
    this.open.set(open);
    try {
      localStorage.setItem(OPEN_KEY, open ? '1' : '0');
    } catch {
      // Blocked storage: the sidebar simply starts closed next time.
    }
  }
}

type Decision = 'confirm' | 'cancel';

function readOpen(): boolean {
  try {
    return localStorage.getItem(OPEN_KEY) === '1';
  } catch {
    return false;
  }
}

function isOverlay(): boolean {
  try {
    return window.matchMedia(OVERLAY_QUERY).matches;
  } catch {
    return false;
  }
}
