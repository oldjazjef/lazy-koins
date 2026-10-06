import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  type ElementRef,
  inject,
  Injector,
  signal,
  viewChild,
} from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideBot,
  lucideLoaderCircle,
  lucidePencil,
  lucidePlus,
  lucideSendHorizontal,
  lucideTrash2,
  lucideTriangleAlert,
  lucideX,
} from '@ng-icons/lucide';
import { TranslatePipe } from '@ngx-translate/core';
import { HlmButtonImports } from '@lazykoins/ui/button';
import { HlmDialogImports } from '@lazykoins/ui/dialog';
import { HlmInputImports } from '@lazykoins/ui/input';
import { HlmLabelImports } from '@lazykoins/ui/label';
import { HlmTextareaImports } from '@lazykoins/ui/textarea';
import { z } from 'zod';
import { CHAT_UNAVAILABLE_CODES } from '../api/assistant.types';
import { AiErrorPanel } from '../../shared/ai/ai-error-panel';
import { zodValidator } from '../../shared/forms/zod-validator';
import { ChatMessage } from './chat-message';
import { ChatService, MAX_QUESTION } from './chat.service';

const TitleSchema = z
  .string()
  .trim()
  .min(1, 'chat.rename.required')
  .max(120, 'chat.rename.tooLong');

type Confirm = 'rename' | 'delete';

/**
 * The assistant's sidebar (F11.14): conversations, the one on screen, the question box. Shown by
 * the app shell on every page — beside the page on wide screens, as an overlay on narrow ones.
 */
@Component({
  selector: 'lk-chat-sidebar',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    NgIcon,
    TranslatePipe,
    AiErrorPanel,
    ChatMessage,
    ...HlmButtonImports,
    ...HlmDialogImports,
    ...HlmInputImports,
    ...HlmLabelImports,
    ...HlmTextareaImports,
  ],
  providers: [
    provideIcons({
      lucideBot,
      lucideLoaderCircle,
      lucidePencil,
      lucidePlus,
      lucideSendHorizontal,
      lucideTrash2,
      lucideTriangleAlert,
      lucideX,
    }),
  ],
  templateUrl: './chat-sidebar.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChatSidebar {
  protected readonly chat = inject(ChatService);
  private readonly injector = inject(Injector);
  protected readonly maxLength = MAX_QUESTION;

  private readonly scroller = viewChild<ElementRef<HTMLElement>>('scroller');
  protected readonly confirm = signal<Confirm | null>(null);
  protected readonly title = new FormControl('', {
    nonNullable: true,
    validators: zodValidator(TitleSchema),
  });

  protected readonly list = computed(() =>
    this.chat.conversations.hasValue() ? this.chat.conversations.value() : [],
  );
  protected readonly currentId = computed(
    () => this.chat.conversation()?.id ?? '',
  );
  protected readonly canSend = computed(
    () =>
      this.chat.ready() &&
      !this.chat.needsConsent() &&
      !this.chat.thinking() &&
      this.chat.draft().trim() !== '',
  );
  /** Why the chat cannot answer, as an i18n key. */
  protected readonly unavailableKey = computed(() => {
    const code = this.chat.status.hasValue()
      ? this.chat.status.value().code
      : null;
    return code && (CHAT_UNAVAILABLE_CODES as readonly string[]).includes(code)
      ? `ai.errors.${code}`
      : 'chat.unavailable';
  });

  constructor() {
    // New messages or the typing indicator: keep the newest in view.
    effect(() => {
      this.chat.conversation();
      this.chat.pending();
      afterNextRender(
        () => {
          const element = this.scroller()?.nativeElement;
          if (element) element.scrollTop = element.scrollHeight;
        },
        { injector: this.injector },
      );
    });
  }

  protected pick(id: string): void {
    if (id === '') this.chat.newChat();
    else void this.chat.select(id);
  }

  protected input(event: Event): void {
    this.chat.draft.set((event.target as HTMLTextAreaElement).value);
  }

  /** Enter sends, Shift+Enter starts a new line. */
  protected enter(event: Event): void {
    if (
      (event as KeyboardEvent).shiftKey ||
      (event as KeyboardEvent).isComposing
    )
      return;
    event.preventDefault();
    void this.send();
  }

  protected async send(): Promise<void> {
    if (!this.canSend()) return;
    // On failure nothing was stored: the text stays in the box.
    if (await this.chat.ask(this.chat.draft())) this.chat.draft.set('');
  }

  protected openRename(): void {
    this.title.reset(this.chat.conversation()?.title ?? '');
    this.confirm.set('rename');
  }

  protected dialogState(): 'open' | 'closed' {
    return this.confirm() ? 'open' : 'closed';
  }

  protected dialogChanged(state: 'open' | 'closed'): void {
    if (state === 'closed') this.confirm.set(null);
  }

  protected async confirmed(): Promise<void> {
    const id = this.chat.conversation()?.id;
    const action = this.confirm();
    if (!id || !action) return;
    if (action === 'rename') {
      this.title.markAsTouched();
      const parsed = TitleSchema.safeParse(this.title.value);
      if (!parsed.success) return;
      this.confirm.set(null);
      await this.chat.rename(id, parsed.data).catch(() => undefined);
    } else {
      this.confirm.set(null);
      await this.chat.remove(id).catch(() => undefined);
    }
  }
}
