import {
  type AiCompletionRequest,
  type AiConnection,
  AiProviderError,
} from './ai-completion.port';
import { extractJson, type FetchLike } from './ai-http';
import { AnthropicAdapter } from './anthropic.adapter';
import { OpenAiCompatibleAdapter } from './openai-compatible.adapter';
import { ProviderSwitchingAiCompletion } from './provider-switching.adapter';

/** A recording `fetch` double: answers queued responses in order, never touches the network. */
function fakeFetch(...answers: (Response | Error)[]) {
  const calls: {
    url: string;
    init: RequestInit;
    body: Record<string, unknown>;
  }[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({
      url,
      init,
      body: JSON.parse(String(init.body)) as Record<string, unknown>,
    });
    const next = answers.shift();
    if (!next) throw new Error('no answer queued');
    if (next instanceof Error) throw next;
    return next;
  };
  return { fetchImpl, calls };
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const request: AiCompletionRequest = {
  system: 'You write mappings.',
  messages: [{ role: 'user', content: '{"fileName":"x.csv"}' }],
  output: {
    name: 'mapping_spec',
    description: 'A mapping',
    schema: {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      properties: { name: { type: 'string' } },
    },
  },
};

const openAi: AiConnection = {
  kind: 'openai_compatible',
  baseUrl: 'http://localhost:11434/v1/',
  model: 'llama3.1',
  apiKey: 'sk-test-1234',
};

describe('OpenAiCompatibleAdapter', () => {
  it('asks for json_schema output and parses the answer + usage', async () => {
    const { fetchImpl, calls } = fakeFetch(
      json(200, {
        model: 'llama3.1',
        choices: [{ message: { content: '{"name":"Kraken"}' } }],
        usage: { prompt_tokens: 120, completion_tokens: 30 },
      }),
    );
    const answer = await new OpenAiCompatibleAdapter(fetchImpl).complete(
      openAi,
      request,
    );
    expect(answer).toMatchObject({
      json: { name: 'Kraken' },
      model: 'llama3.1',
      usage: { inputTokens: 120, outputTokens: 30 },
    });
    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call?.url).toBe('http://localhost:11434/v1/chat/completions');
    expect(
      (call?.init.headers as Record<string, string>)['authorization'],
    ).toBe('Bearer sk-test-1234');
    expect(call?.body['response_format']).toMatchObject({
      type: 'json_schema',
      json_schema: { name: 'mapping_spec', schema: { type: 'object' } },
    });
    // `$schema` is dropped: some servers reject it.
    expect(
      JSON.stringify(call?.body['response_format']).includes('$schema'),
    ).toBe(false);
    expect((call?.body['messages'] as { role: string }[])[0]?.role).toBe(
      'system',
    );
  });

  it('falls back to plain JSON in the text when json_schema is refused', async () => {
    const { fetchImpl, calls } = fakeFetch(
      json(400, { error: { message: 'response_format not supported' } }),
      json(200, {
        choices: [
          {
            message: {
              content: 'Here it is:\n```json\n{"name":"Fallback"}\n```',
            },
          },
        ],
      }),
    );
    const answer = await new OpenAiCompatibleAdapter(fetchImpl).complete(
      { ...openAi, apiKey: undefined },
      request,
    );
    expect(answer.json).toEqual({ name: 'Fallback' });
    expect(answer.usage).toBeUndefined();
    expect(calls).toHaveLength(2);
    expect(calls[1]?.body['response_format']).toBeUndefined();
    const system = (calls[1]?.body['messages'] as { content: string }[])[0];
    expect(system?.content).toContain('JSON Schema');
    // No key configured → no Authorization header (local Ollama).
    expect(
      (calls[0]?.init.headers as Record<string, string>)['authorization'],
    ).toBeUndefined();
  });

  it('uses the OpenAI defaults when base URL and model are empty', async () => {
    const { fetchImpl, calls } = fakeFetch(
      json(200, { choices: [{ message: { content: '{}' } }] }),
    );
    await new OpenAiCompatibleAdapter(fetchImpl).complete(
      { kind: 'openai_compatible', baseUrl: '', model: '' },
      request,
    );
    expect(calls[0]?.url).toBe('https://api.openai.com/v1/chat/completions');
    expect(calls[0]?.body['model']).toBeTruthy();
  });

  it.each([
    [401, 'invalidKey'],
    [403, 'invalidKey'],
    [429, 'rateLimited'],
    [404, 'modelNotFound'],
    [500, 'providerError'],
  ])('maps HTTP %i to %s', async (status, code) => {
    const { fetchImpl } = fakeFetch(json(status, { error: 'nope' }));
    await expect(
      new OpenAiCompatibleAdapter(fetchImpl).complete(openAi, request),
    ).rejects.toMatchObject({ code, status });
  });

  it('maps a refused connection to network and an abort to timeout', async () => {
    const refused = Object.assign(new TypeError('fetch failed'), {
      cause: { code: 'ECONNREFUSED' },
    });
    await expect(
      new OpenAiCompatibleAdapter(fakeFetch(refused).fetchImpl).complete(
        openAi,
        request,
      ),
    ).rejects.toMatchObject({ code: 'network' });
    const timeout = Object.assign(new Error('timed out'), {
      name: 'TimeoutError',
    });
    await expect(
      new OpenAiCompatibleAdapter(fakeFetch(timeout).fetchImpl).complete(
        openAi,
        request,
      ),
    ).rejects.toMatchObject({ code: 'timeout' });
  });

  it('never puts the key into an error message', async () => {
    const { fetchImpl } = fakeFetch(
      json(401, { error: { message: 'bad key' } }),
    );
    const error = await new OpenAiCompatibleAdapter(fetchImpl)
      .complete(openAi, request)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AiProviderError);
    expect(String((error as Error).message)).not.toContain('sk-test-1234');
  });

  it('rejects an answer without JSON as badResponse', async () => {
    const { fetchImpl } = fakeFetch(
      json(200, { choices: [{ message: { content: 'I cannot help.' } }] }),
    );
    await expect(
      new OpenAiCompatibleAdapter(fetchImpl).complete(openAi, request),
    ).rejects.toMatchObject({ code: 'badResponse' });
  });
});

describe('AnthropicAdapter', () => {
  const anthropic: AiConnection = {
    kind: 'anthropic',
    baseUrl: '',
    model: '',
    apiKey: 'sk-ant-test-9876',
  };

  it('forces a tool call with the schema as input_schema and reads its input', async () => {
    const { fetchImpl, calls } = fakeFetch(
      json(200, {
        model: 'claude-sonnet-5-5',
        content: [
          { type: 'text', text: 'Sure.' },
          {
            type: 'tool_use',
            name: 'mapping_spec',
            input: { name: 'Bitfinex' },
          },
        ],
        usage: { input_tokens: 900, output_tokens: 200 },
      }),
    );
    const answer = await new AnthropicAdapter(fetchImpl).complete(
      anthropic,
      request,
    );
    expect(answer).toMatchObject({
      json: { name: 'Bitfinex' },
      text: '{"name":"Bitfinex"}',
      usage: { inputTokens: 900, outputTokens: 200 },
    });
    const [call] = calls;
    expect(call?.url).toBe('https://api.anthropic.com/v1/messages');
    const headers = call?.init.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('sk-ant-test-9876');
    expect(headers['anthropic-version']).toBe('2023-06-01');
    expect(call?.body).toMatchObject({
      model: 'claude-sonnet-5-5',
      system: 'You write mappings.',
      tool_choice: { type: 'tool', name: 'mapping_spec' },
      tools: [
        {
          name: 'mapping_spec',
          input_schema: { type: 'object', properties: { name: {} } },
        },
      ],
    });
    expect(typeof call?.body['max_tokens']).toBe('number');
  });

  it('fails with badResponse when the model answers without the tool', async () => {
    const { fetchImpl } = fakeFetch(
      json(200, { content: [{ type: 'text', text: 'no' }] }),
    );
    await expect(
      new AnthropicAdapter(fetchImpl).complete(anthropic, request),
    ).rejects.toMatchObject({ code: 'badResponse' });
  });

  it('maps 401 to invalidKey', async () => {
    const { fetchImpl } = fakeFetch(
      json(401, { type: 'error', error: { message: 'invalid x-api-key' } }),
    );
    await expect(
      new AnthropicAdapter(fetchImpl).complete(anthropic, request),
    ).rejects.toMatchObject({ code: 'invalidKey' });
  });
});

describe('ProviderSwitchingAiCompletion', () => {
  it('routes by provider kind', async () => {
    const { fetchImpl, calls } = fakeFetch(
      json(200, {
        content: [{ type: 'tool_use', name: 'mapping_spec', input: {} }],
      }),
      json(200, { choices: [{ message: { content: '{}' } }] }),
    );
    const port = new ProviderSwitchingAiCompletion(fetchImpl);
    await port.complete({ kind: 'anthropic', baseUrl: '', model: '' }, request);
    await port.complete(openAi, request);
    expect(calls.map((c) => c.url)).toEqual([
      'https://api.anthropic.com/v1/messages',
      'http://localhost:11434/v1/chat/completions',
    ]);
  });
});

describe('extractJson', () => {
  it('reads bare, fenced and surrounded JSON', () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
    expect(extractJson('```json\n{"a":2}\n```')).toEqual({ a: 2 });
    expect(extractJson('Answer: {"a":3} — done')).toEqual({ a: 3 });
    expect(() => extractJson('nothing')).toThrow(AiProviderError);
  });
});
