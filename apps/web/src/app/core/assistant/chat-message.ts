import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import type { ChatAttachment, ChatMessageView } from '../api/assistant.types';
import { eventText } from './proposal-text';
import { appLink, type AppLink } from './chat-markdown';
import { ChatText } from './chat-text';
import { ChatUpload } from './chat-upload';
import { ChatService } from './chat.service';
import { ProposalCard } from './proposal-card';

type ShownAttachment =
  | {
      readonly kind: 'upload';
      readonly projectId: string;
      readonly message: string;
    }
  | {
      readonly kind: 'link';
      readonly label: string;
      readonly link: AppLink | null;
    };

/**
 * One message of a conversation: the user's on the right, the assistant's on the left (safe
 * markdown, links, upload zones, proposals, the tools it used), events as a muted line.
 */
@Component({
  selector: 'lk-chat-message',
  imports: [RouterLink, TranslatePipe, ChatText, ChatUpload, ProposalCard],
  templateUrl: './chat-message.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChatMessage {
  protected readonly chat = inject(ChatService);
  private readonly translate = inject(TranslateService);
  readonly message = input.required<ChatMessageView>();

  /**
   * An event in the user's language (F11.2); a row stored before has no outcome and shows its
   * stored text.
   */
  protected readonly eventLine = computed(() => {
    const message = this.message();
    this.translate.currentLang();
    return message.event
      ? eventText(this.translate, message.event)
      : message.content;
  });

  protected readonly attachments = computed<readonly ShownAttachment[]>(() =>
    this.message().attachments.map((attachment: ChatAttachment) =>
      attachment.kind === 'upload'
        ? attachment
        : {
            kind: 'link',
            label: attachment.label,
            link: appLink(attachment.href),
          },
    ),
  );
}
