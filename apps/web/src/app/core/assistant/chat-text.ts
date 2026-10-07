import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { parseChatMarkdown, type ChatInline } from './chat-markdown';
import { ChatService } from './chat.service';

/** One line of tokens. Text goes in through `textContent` only — never as HTML. */
@Component({
  selector: 'lk-chat-inline',
  imports: [RouterLink],
  template: `
    @for (token of tokens(); track $index) {
      @switch (token.kind) {
        @case ('bold') {
          <strong class="font-semibold" [textContent]="token.text"></strong>
        }
        @case ('code') {
          <code
            class="bg-muted rounded px-1 font-mono text-xs"
            [textContent]="token.text"
          ></code>
        }
        @case ('link') {
          <a
            class="text-primary underline underline-offset-2"
            [routerLink]="token.link.path"
            [queryParams]="token.link.queryParams"
            [fragment]="token.link.fragment ?? undefined"
            (click)="chat.navigated()"
            [textContent]="token.text"
          ></a>
        }
        @default {
          <span [textContent]="token.text"></span>
        }
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChatInlineText {
  protected readonly chat = inject(ChatService);
  readonly tokens = input.required<readonly ChatInline[]>();
}

/** An assistant answer as safe minimal markdown (see `chat-markdown.ts`). */
@Component({
  selector: 'lk-chat-text',
  imports: [ChatInlineText],
  host: { class: 'flex flex-col gap-2 break-words' },
  template: `
    @for (block of blocks(); track $index) {
      @if (block.kind === 'paragraph') {
        <p>
          @for (line of block.lines; track $index) {
            @if (!$first) {
              <br />
            }
            <lk-chat-inline [tokens]="line" />
          }
        </p>
      } @else {
        <ul class="flex list-disc flex-col gap-1 pl-5">
          @for (item of block.items; track $index) {
            <li><lk-chat-inline [tokens]="item" /></li>
          }
        </ul>
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChatText {
  readonly text = input.required<string>();
  protected readonly blocks = computed(() => parseChatMarkdown(this.text()));
}
