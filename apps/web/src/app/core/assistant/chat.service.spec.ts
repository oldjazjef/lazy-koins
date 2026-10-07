import { ActivityService } from '../activity/activity.service';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import type {
  ChatStatus,
  ConversationView,
  ProposalView,
} from '../api/assistant.types';
import { NotificationService } from '../notifications/notification.service';
import { DataChanges } from '../data/data-changes';
import { ChatContextService } from './chat-context.service';
import { ChatService } from './chat.service';

const status = (over: Partial<ChatStatus> = {}): ChatStatus => ({
  available: true,
  code: null,
  detail: null,
  consentRequired: false,
  provider: 'anthropic',
  model: 'claude-sonnet-5-5',
  ...over,
});

const proposal = (over: Partial<ProposalView> = {}): ProposalView => ({
  id: 'pr1',
  tool: 'create_correction',
  title: 'Kurs überschreiben',
  effect: 'write',
  summary: 'BTC am 31.12.',
  changes: [{ label: 'Kurs', before: '90000', after: '91000' }],
  projectId: 'p1',
  status: 'pending',
  outcome: null,
  decidedAt: null,
  ...over,
});

const view = (over: Partial<ConversationView> = {}): ConversationView => ({
  id: 'c1',
  title: 'Wie viel?',
  createdAt: '2026-10-07T10:00:00.000Z',
  updatedAt: '2026-10-07T10:00:00.000Z',
  messages: [
    {
      id: 'm1',
      role: 'user',
      content: 'Wie viel?',
      createdAt: '2026-10-07T10:00:00.000Z',
      attachments: [],
      proposals: [],
      toolsUsed: [],
    },
    {
      id: 'm2',
      role: 'assistant',
      content: 'So viel.',
      createdAt: '2026-10-07T10:00:01.000Z',
      attachments: [],
      proposals: [proposal()],
      toolsUsed: ['list_positions'],
    },
  ],
  ...over,
});

const settle = async () => {
  await new Promise((resolve) => setTimeout(resolve));
  TestBed.tick();
  await new Promise((resolve) => setTimeout(resolve));
};

async function setup(initial: ChatStatus = status()) {
  localStorage.setItem(`lk.chat.open`, '1');
  const notifications = { success: vi.fn(), error: vi.fn(), info: vi.fn() };
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      provideTranslateService(),
      provideRouter([]),
      { provide: NotificationService, useValue: notifications },
    ],
  });
  const service = TestBed.inject(ChatService);
  const http = TestBed.inject(HttpTestingController);
  await settle();
  http.expectOne('/api/chat/status').flush(initial);
  http.expectOne('/api/chat/conversations').flush([]);
  await settle();
  return { service, http, notifications };
}

describe('ChatService', () => {
  afterEach(() => {
    try {
      TestBed.inject(HttpTestingController).verify();
    } finally {
      TestBed.resetTestingModule();
      localStorage.clear();
    }
  });

  it('loads the status while the sidebar is open', async () => {
    const { service } = await setup(
      status({ available: false, code: 'aiNotConfigured' }),
    );
    expect(service.open()).toBe(true);
    expect(service.ready()).toBe(false);
  });

  it('asks for consent once, then sends it with the context in a new conversation', async () => {
    const { service, http } = await setup(status({ consentRequired: true }));
    expect(service.needsConsent()).toBe(true);
    service.acceptConsent();
    expect(service.needsConsent()).toBe(false);

    const context = TestBed.inject(ChatContextService);
    context.projectId.set('p1');
    context.tab.set('result');

    const asked = service.ask('  Wie viel?  ');
    const request = http.expectOne('/api/chat/conversations');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({
      text: 'Wie viel?',
      context: { route: '/', projectId: 'p1', tab: 'result' },
      consent: true,
    });
    expect(service.thinking()).toBe(true);
    request.flush(view());
    expect(await asked).toBe(true);
    expect(service.thinking()).toBe(false);
    expect(service.conversation()?.id).toBe('c1');
    // Never again until revoked.
    expect(service.needsConsent()).toBe(false);
    expect(service.status.value()?.consentRequired).toBe(false);
    await settle();
    http.expectOne('/api/chat/conversations').flush([]);
  });

  it('continues the conversation on screen, without consent', async () => {
    const { service, http } = await setup();
    service.conversation.set(view());
    const asked = service.ask('Und jetzt?');
    const request = http.expectOne('/api/chat/conversations/c1/messages');
    expect(request.request.body).toEqual({
      text: 'Und jetzt?',
      context: { route: '/' },
    });
    request.flush(view({ title: 'Neu' }));
    expect(await asked).toBe(true);
    expect(service.conversation()?.title).toBe('Neu');
    await settle();
    http.expectOne('/api/chat/conversations').flush([]);
  });

  it('shows no activity snackbar while the assistant answers (the chat shows it itself)', async () => {
    const { service, http } = await setup();
    const activity = TestBed.inject(ActivityService);
    service.conversation.set(view());
    const asked = service.ask('Und jetzt?');
    expect(activity.count()).toBe(0);
    http.expectOne('/api/chat/conversations/c1/messages').flush(view());
    expect(await asked).toBe(true);
    await settle();
    http.expectOne('/api/chat/conversations').flush([]);
  });

  it('keeps the question when the provider fails and shows the details', async () => {
    const { service, http, notifications } = await setup();
    const asked = service.ask('Wie viel?');
    http.expectOne('/api/chat/conversations').flush(
      {
        code: 'timeout',
        detail: 'no answer after 120 s',
        model: 'claude-sonnet-5-5',
      },
      { status: 502, statusText: 'Bad Gateway' },
    );
    expect(await asked).toBe(false);
    expect(service.conversation()).toBeNull();
    expect(service.error()).toMatchObject({
      key: 'ai.errors.timeout',
      code: 'timeout',
      model: 'claude-sonnet-5-5',
    });
    expect(notifications.error).not.toHaveBeenCalled();
  });

  it('asks again for consent when the API wants it', async () => {
    const { service, http } = await setup();
    const asked = service.ask('Wie viel?');
    http
      .expectOne('/api/chat/conversations')
      .flush(
        { code: 'consentRequired', detail: 'consent first' },
        { status: 409, statusText: 'Conflict' },
      );
    expect(await asked).toBe(false);
    expect(service.error()?.key).toBe('ai.errors.consentRequired');
    await settle();
    http.expectOne('/api/chat/status').flush(status({ consentRequired: true }));
    await settle();
    expect(service.needsConsent()).toBe(true);
  });

  it('runs a proposal and tells the app what changed', async () => {
    const { service, http } = await setup();
    const changes = TestBed.inject(DataChanges);
    service.conversation.set(view());
    const confirmed = service.confirm(proposal());
    const request = http.expectOne(
      '/api/chat/conversations/c1/proposals/pr1/confirm',
    );
    expect(request.request.method).toBe('POST');
    const executed = view();
    request.flush({
      ...executed,
      messages: executed.messages.map((message) =>
        message.id === 'm2'
          ? {
              ...message,
              proposals: [
                proposal({
                  status: 'executed',
                  outcome: { summary: 'Erledigt' },
                }),
              ],
            }
          : message,
      ),
    });
    await confirmed;
    expect(service.conversation()?.messages[1]?.proposals[0]?.status).toBe(
      'executed',
    );
    expect(changes.projectVersion('p1')).toBe(1);
    expect(changes.projectVersion('p2')).toBe(0);
    expect(changes.globalVersion('mappings')).toBe(1);
  });

  it('cancels a proposal without touching the app', async () => {
    const { service, http } = await setup();
    const changes = TestBed.inject(DataChanges);
    service.conversation.set(view());
    const cancelled = service.cancel(proposal());
    http
      .expectOne('/api/chat/conversations/c1/proposals/pr1/cancel')
      .flush(view());
    await cancelled;
    expect(changes.projectVersion('p1')).toBe(0);
  });

  it('reloads the conversation when the proposal was already decided', async () => {
    const { service, http, notifications } = await setup();
    service.conversation.set(view());
    const confirmed = service.confirm(proposal());
    http
      .expectOne('/api/chat/conversations/c1/proposals/pr1/confirm')
      .flush({ message: 'decided' }, { status: 409, statusText: 'Conflict' });
    await settle();
    http.expectOne('/api/chat/conversations/c1').flush(view());
    await confirmed;
    expect(notifications.error).toHaveBeenCalledWith(
      'chat.proposal.alreadyDecided',
      undefined,
    );
  });
});
