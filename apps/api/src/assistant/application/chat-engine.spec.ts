import {
  BadGatewayException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { AiGate, AiRuntime } from '../../ai/application/ai-gate';
import { InMemoryAiSettingsRepository } from '../../ai/testing/in-memory-ai-settings.repository';
import { SecretBox } from '../../common/crypto/secret-box';
import {
  type AiCompletion,
  AiCompletionPort,
  type AiConverseRequest,
  type AiConverseTurn,
  AiProviderError,
  type AiToolCall,
} from '../../integrations/ai/ai-completion.port';
import { NotificationService } from '../../notifications/application/notification.service';
import { Topics } from '../../notifications/domain/notification';
import { InMemoryNotificationRepository } from '../../notifications/testing/in-memory-notification.repository';
import { toolSetup } from '../../tools/testing/tool-fixture';
import { SAFETY_RULES } from '../domain/assistant-prompt';
import {
  InMemoryAssistantSettingsRepository,
  InMemoryChatRepository,
} from '../testing/in-memory-assistant.repositories';
import { ChatEngine, MAX_TOOL_STEPS, toAiHistory } from './chat-engine';

type Step =
  AiConverseTurn | Error | ((request: AiConverseRequest) => AiConverseTurn);

/** A scripted model: answers the queued turns in order and records every request. */
class ScriptedAi extends AiCompletionPort {
  readonly requests: AiConverseRequest[] = [];
  private readonly steps: Step[] = [];

  then(...steps: Step[]): this {
    this.steps.push(...steps);
    return this;
  }

  complete(): Promise<AiCompletion> {
    return Promise.reject(new Error('not used'));
  }

  async converse(
    _connection: unknown,
    request: AiConverseRequest,
  ): Promise<AiConverseTurn> {
    this.requests.push(structuredClone(request));
    const step = this.steps.shift();
    if (!step) throw new Error('ScriptedAi: no turn queued');
    if (step instanceof Error) throw step;
    return typeof step === 'function' ? step(request) : step;
  }
}

function must<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('missing value');
  return value;
}

const calls = (...toolCalls: AiToolCall[]): AiConverseTurn => ({
  text: '',
  toolCalls,
  model: 'scripted',
  stop: 'toolUse',
  usage: { inputTokens: 10, outputTokens: 5 },
});
const say = (text: string): AiConverseTurn => ({
  text,
  toolCalls: [],
  model: 'scripted',
  stop: 'end',
  usage: { inputTokens: 10, outputTokens: 5 },
});

async function chatSetup() {
  const t = await toolSetup();
  const aiSettings = new InMemoryAiSettingsRepository();
  await aiSettings.save('anna', {
    enabled: true,
    provider: 'openai_compatible',
    baseUrl: 'https://ai.example.ch/v1',
    model: 'scripted',
    apiKeyCipher: null,
    apiKeyHint: null,
    consentAt: null,
  });
  const notificationRows = new InMemoryNotificationRepository();
  const gate = new AiGate(
    aiSettings,
    new AiRuntime(new SecretBox(''), false),
    new NotificationService(notificationRows),
  );
  const ai = new ScriptedAi();
  const chats = new InMemoryChatRepository();
  const assistant = new InMemoryAssistantSettingsRepository();
  const engine = new ChatEngine(
    ai,
    gate,
    t.executor,
    chats,
    assistant,
    t.services.projects,
  );
  const ask = (text: string, conversationId: string | null = null) =>
    engine.ask('anna', conversationId, {
      text,
      context: {
        route: `/app/projects/${t.project.id}`,
        projectId: t.project.id,
        tab: 'result',
      },
      consent: true,
    });
  return {
    ...t,
    aiSettings,
    gate,
    ai,
    chats,
    assistant,
    engine,
    ask,
    notificationRows,
  };
}

describe('ChatEngine (F11.14)', () => {
  it('asks for the consent once (F5.14) and then stores it', async () => {
    const { engine, ai, assistant, project } = await chatSetup();
    const refused = await engine
      .ask('anna', null, { text: 'Hallo', context: {}, consent: false })
      .catch((e: unknown) => e);
    expect(refused).toBeInstanceOf(ConflictException);
    expect((refused as ConflictException).getResponse()).toEqual(
      expect.objectContaining({ code: 'consentRequired' }),
    );
    expect(ai.requests).toHaveLength(0);

    ai.then(say('Hallo!'), say('Nochmals hallo.'));
    await engine.ask('anna', null, {
      text: 'Hallo',
      context: { projectId: project.id },
      consent: true,
    });
    expect((await assistant.find('anna'))?.chatConsentAt).toBeTruthy();
    // No consent needed any more.
    await engine.ask('anna', null, { text: 'Hi', context: {}, consent: false });
    expect(ai.requests).toHaveLength(2);
  });

  it('is unavailable while the AI plugin is off (the gate’s 409)', async () => {
    const { engine, aiSettings } = await chatSetup();
    const current = await aiSettings.find('anna');
    await aiSettings.save('anna', { ...must(current), enabled: false });
    const error = await engine
      .ask('anna', null, { text: 'Hallo', context: {}, consent: true })
      .catch((e: unknown) => e);
    expect((error as ConflictException).getResponse()).toEqual(
      expect.objectContaining({ code: 'aiDisabled' }),
    );
  });

  it('explains with read tools: "Warum fehlt der Kurs für DOT?" → positions, rates → answer with a link', async () => {
    const { ask, ai, project, calculate, audit } = await chatSetup();
    const { CalculateProjectCommand } =
      await import('../../calculation/application/calculation.handlers');
    await calculate.execute(new CalculateProjectCommand('anna', project.id));

    let positionLink = '';
    ai.then(
      calls({
        id: 'c1',
        name: 'list_positions',
        input: { projectId: project.id, asset: 'DOT' },
      }),
      (request) => {
        const result = JSON.parse(
          (request.messages.at(-1) as { content: string }).content,
        ) as { positions: { status: string; link: string }[] };
        expect(result.positions[0]?.status).toBe('missingPrice');
        positionLink = result.positions[0]?.link ?? '';
        return calls({
          id: 'c2',
          name: 'list_rates',
          input: { projectId: project.id, asset: 'DOT' },
        });
      },
      (request) => {
        const result = JSON.parse(
          (request.messages.at(-1) as { content: string }).content,
        ) as { rates: unknown[] };
        expect(result.rates).toEqual([]);
        return say(
          `Für DOT ist kein Kurs gespeichert. [Position ansehen](${positionLink})`,
        );
      },
    );
    const view = await ask('Warum fehlt der Kurs für DOT?');

    // The system prompt: own/default prompt + fixed safety rules + the page context.
    const system = ai.requests[0]?.system ?? '';
    expect(system).toContain(SAFETY_RULES);
    expect(system).toContain('Steuern 2025');
    expect(system).toContain('Offener Tab: result');
    // Tools are offered with JSON Schemas; writes are marked as proposals.
    const tools = ai.requests[0]?.tools ?? [];
    expect(
      tools.find((t) => t.name === 'list_positions')?.inputSchema['type'],
    ).toBe('object');
    expect(
      tools.find((t) => t.name === 'set_price_override')?.description,
    ).toContain('proposal');
    expect(tools.some((t) => t.name === 'upload_file')).toBe(false);

    expect(view.title).toBe('Warum fehlt der Kurs für DOT?');
    expect(view.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
    const answer = view.messages[1];
    expect(answer?.content).toContain(`(${positionLink})`);
    expect(positionLink).toContain(
      `/app/projects/${project.id}?tab=result&figure=`,
    );
    expect(answer?.toolsUsed).toEqual(['list_positions', 'list_rates']);
    expect(audit.rows.map((r) => [r.source, r.tool, r.status])).toEqual([
      ['chat', 'list_positions', 'ok'],
      ['chat', 'list_rates', 'ok'],
    ]);
  });

  it('turns a write tool into a proposal card; only "Ausführen" creates the correction', async () => {
    const { ask, ai, engine, project, corrections, chats, audit } =
      await chatSetup();
    ai.then(
      calls({
        id: 'c1',
        name: 'set_price_override',
        input: {
          projectId: project.id,
          asset: 'DOT',
          date: '2025-12-31',
          priceChf: '4.50',
          reason: 'Kurs laut ESTV-Kursliste',
        },
      }),
      (request) => {
        const result = JSON.parse(
          (request.messages.at(-1) as { content: string }).content,
        ) as { status: string };
        expect(result.status).toBe('proposed');
        return say('Ich habe die Änderung vorbereitet. Bitte bestätige sie.');
      },
    );
    const view = await ask('Setz den Kurs von DOT per 31.12. auf 4.50 CHF');
    expect(await corrections.listByProject(project.id)).toEqual([]);
    const card = view.messages[1]?.proposals[0];
    expect(card).toEqual(
      expect.objectContaining({
        tool: 'set_price_override',
        title: 'Kurs überschreiben',
        effect: 'write',
        status: 'pending',
        projectId: project.id,
      }),
    );
    expect(card?.changes[0]).toEqual({
      label: 'Kurs DOT (CHF)',
      before: null,
      after: '4.50 CHF (Override)',
    });
    expect(audit.rows.at(-1)).toEqual(
      expect.objectContaining({
        tool: 'set_price_override',
        status: 'proposed',
      }),
    );

    const after = await engine.decide(
      'anna',
      view.id,
      must(card).id,
      'confirm',
    );
    const stored = await corrections.listByProject(project.id);
    expect(stored).toHaveLength(1);
    expect(stored[0]?.reason).toBe('Kurs laut ESTV-Kursliste');
    expect(after.messages.at(-1)).toEqual(
      expect.objectContaining({ role: 'event' }),
    );
    expect(after.messages.at(-1)?.content).toMatch(
      /^Ausgeführt: Kurs überschreiben/,
    );
    expect(after.messages[1]?.proposals[0]?.status).toBe('executed');
    expect(audit.rows.at(-1)).toEqual(
      expect.objectContaining({
        tool: 'set_price_override',
        status: 'ok',
        source: 'chat',
      }),
    );

    // A second click cannot run it again.
    await expect(
      engine.decide('anna', view.id, must(card).id, 'confirm'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(await corrections.listByProject(project.id)).toHaveLength(1);

    // The model learns about it on the next question.
    ai.then(say('Gern.'));
    await ask('Danke', view.id);
    const history = ai.requests.at(-1)?.messages ?? [];
    expect(
      history.some(
        (m) =>
          m.role === 'user' &&
          m.content.startsWith('[App] Ausgeführt: Kurs überschreiben'),
      ),
    ).toBe(true);
    expect((await chats.messages(view.id)).some((m) => m.role === 'tool')).toBe(
      true,
    );
  });

  it('cancels a proposal without running it, and a failed run is shown on the card', async () => {
    const { ask, ai, engine, project, corrections, projects } =
      await chatSetup();
    const propose = calls({
      id: 'c1',
      name: 'set_price_override',
      input: {
        projectId: project.id,
        asset: 'DOT',
        date: '2025-12-31',
        priceChf: '4.5',
        reason: 'Kurs laut ESTV-Kursliste',
      },
    });
    ai.then(
      propose,
      say('Bitte bestätigen.'),
      propose,
      say('Bitte bestätigen.'),
    );
    const first = await ask('Kurs setzen');
    const cancelled = await engine.decide(
      'anna',
      first.id,
      must(first.messages[1]?.proposals[0]).id,
      'cancel',
    );
    expect(cancelled.messages[1]?.proposals[0]?.status).toBe('cancelled');
    expect(cancelled.messages.at(-1)?.content).toMatch(/^Abgebrochen/);

    // A closed project stays read-only: the confirmed tool fails with the service's 409.
    const second = await ask('Nochmals', first.id);
    await projects.update(project.id, { status: 'closed' });
    const card = must(second.messages.at(-1)?.proposals[0]);
    const failed = await engine.decide('anna', second.id, card.id, 'confirm');
    const shown = failed.messages
      .flatMap((m) => m.proposals)
      .find((p) => p.id === card.id);
    expect(shown?.status).toBe('failed');
    expect(shown?.outcome?.error?.code).toBe('conflict');
    expect(await corrections.listByProject(project.id)).toEqual([]);
  });

  it('stops after the loop limit', async () => {
    const { ask, ai, project } = await chatSetup();
    for (let i = 0; i < MAX_TOOL_STEPS; i++) {
      ai.then(
        calls({
          id: `c${i}`,
          name: 'get_project',
          input: { projectId: project.id },
        }),
      );
    }
    const view = await ask('Endlos');
    expect(ai.requests).toHaveLength(MAX_TOOL_STEPS);
    expect(view.messages.at(-1)?.content).toMatch(/zu viele Schritte/);
  });

  it('reports a bad tool call back to the model instead of failing', async () => {
    const { ask, ai } = await chatSetup();
    ai.then(
      calls({ id: 'c1', name: 'get_project', input: { projectId: 7 } }),
      (request) => {
        const last = request.messages.at(-1) as {
          content: string;
          isError?: boolean;
        };
        expect(last.isError).toBe(true);
        expect(last.content).toContain('invalidArguments');
        return calls({ id: 'c2', name: 'no_such_tool', input: {} });
      },
      (request) => {
        expect(
          (request.messages.at(-1) as { content: string }).content,
        ).toContain('unknownTool');
        return say('Das hat nicht geklappt.');
      },
    );
    const view = await ask('Test');
    expect(view.messages.at(-1)?.content).toBe('Das hat nicht geklappt.');
  });

  it('offers an upload drop zone and links as attachments', async () => {
    const { ask, ai, project } = await chatSetup();
    ai.then(
      calls(
        {
          id: 'c1',
          name: 'request_file_upload',
          input: {
            projectId: project.id,
            message: 'Kraken-Kontoauszug Dezember',
          },
        },
        {
          id: 'c2',
          name: 'navigate',
          input: { projectId: project.id, tab: 'hints', label: 'Hinweise' },
        },
      ),
      say('Lade bitte den Kontoauszug hoch.'),
    );
    const view = await ask('Was fehlt?');
    expect(view.messages[1]?.attachments).toEqual([
      {
        kind: 'upload',
        projectId: project.id,
        message: 'Kraken-Kontoauszug Dezember',
      },
      {
        kind: 'link',
        href: `/app/projects/${project.id}?tab=hints`,
        label: 'Hinweise',
      },
    ]);
  });

  it('stores nothing when the provider fails (502 with details) — the question can be sent again', async () => {
    const { engine, ai, chats, notificationRows } = await chatSetup();
    ai.then(
      new AiProviderError('rateLimited', {
        status: 429,
        providerMessage: 'slow down',
      }),
    );
    const error = await engine
      .ask('anna', null, { text: 'Hallo', context: {}, consent: true })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BadGatewayException);
    expect((error as BadGatewayException).getResponse()).toEqual(
      expect.objectContaining({ code: 'rateLimited', status: 429 }),
    );
    expect(await chats.listConversations('anna')).toEqual([]);
    // F11.12: like every AI call, a failing chat call raises the notification.
    expect(notificationRows.topic(Topics.aiCallFailed(), 'anna')).toMatchObject(
      { kind: 'error' },
    );
  });

  it('keeps conversations per user: someone else’s is not found; delete removes the messages', async () => {
    const { ask, ai, engine, chats } = await chatSetup();
    ai.then(say('Hallo!'));
    const view = await ask('Hallo');
    await expect(
      engine.ownConversation('mallory', view.id),
    ).rejects.toBeInstanceOf(NotFoundException);
    await chats.deleteConversation(view.id);
    expect(await chats.messages(view.id)).toEqual([]);
  });
});

describe('toAiHistory', () => {
  it('starts at a user message and never in the middle of a tool round trip', () => {
    const at = '2026-01-01T00:00:00.000Z';
    const history = toAiHistory([
      {
        id: '1',
        conversationId: 'c',
        seq: 0,
        role: 'tool',
        content: 'x'.repeat(5000),
        data: { toolCallId: 'a' },
        createdAt: at,
      },
      {
        id: '2',
        conversationId: 'c',
        seq: 1,
        role: 'assistant',
        content: 'old',
        data: {},
        createdAt: at,
      },
      {
        id: '3',
        conversationId: 'c',
        seq: 2,
        role: 'user',
        content: 'Frage',
        data: {},
        createdAt: at,
      },
      {
        id: '4',
        conversationId: 'c',
        seq: 3,
        role: 'assistant',
        content: '',
        data: { toolCalls: [{ id: 't', name: 'x', input: {} }] },
        createdAt: at,
      },
      {
        id: '5',
        conversationId: 'c',
        seq: 4,
        role: 'tool',
        content: 'y'.repeat(5000),
        data: { toolCallId: 't', toolName: 'x' },
        createdAt: at,
      },
      {
        id: '6',
        conversationId: 'c',
        seq: 5,
        role: 'event',
        content: 'Ausgeführt: X',
        data: {},
        createdAt: at,
      },
    ]);
    expect(history.map((m) => m.role)).toEqual([
      'user',
      'assistant',
      'tool',
      'user',
    ]);
    expect((history[2] as { content: string }).content.length).toBeLessThan(
      2100,
    );
    expect((history[3] as { content: string }).content).toBe(
      '[App] Ausgeführt: X',
    );
  });
});
