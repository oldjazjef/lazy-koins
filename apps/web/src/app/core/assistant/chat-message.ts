import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import type { ChatAttachment, ChatMessageView } from '../api/assistant.types';
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
  readonly message = input.required<ChatMessageView>();

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
