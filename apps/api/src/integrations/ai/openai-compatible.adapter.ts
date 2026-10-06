import {
  type AiCompletion,
  AiCompletionPort,
  type AiCompletionRequest,
  type AiConnection,
  AiProviderError,
} from './ai-completion.port';
import {
  extractJson,
  type FetchLike,
  joinUrl,
  plainSchema,
  postJson,
} from './ai-http';

export const OPENAI_DEFAULT_BASE_URL = 'https://api.openai.com/v1';
export const OPENAI_DEFAULT_MODEL = 'gpt-4.1-mini';

interface ChatResponse {
  model?: string;
  choices?: { message?: { content?: string | null } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

/**
 * Any OpenAI-compatible Chat Completions API: OpenAI, Mistral, Groq, OpenRouter, a local Ollama
 * (`http://localhost:11434/v1`) or LM Studio. Asks for structured output with
 * `response_format: { type: 'json_schema' }` first; a server that rejects it (400/422 — older
 * Ollama builds, some gateways) is asked again without, with the schema in the instructions,
 * and the JSON is taken from the text.
 */
export class OpenAiCompatibleAdapter extends AiCompletionPort {
  constructor(private readonly fetchImpl: FetchLike = fetch) {
    super();
  }

  async complete(
    connection: AiConnection,
    request: AiCompletionRequest,
  ): Promise<AiCompletion> {
    const url = joinUrl(
      connection.baseUrl || OPENAI_DEFAULT_BASE_URL,
      '/chat/completions',
    );
    const headers: Record<string, string> = connection.apiKey
      ? { authorization: `Bearer ${connection.apiKey}` }
      : {};
    const model = connection.model || OPENAI_DEFAULT_MODEL;
    const messages = request.messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));
    const base = {
      model,
      temperature: 0,
      ...(request.maxTokens ? { max_tokens: request.maxTokens } : {}),
    };

    let body: ChatResponse;
    try {
      body = (
        await postJson(
          this.fetchImpl,
          url,
          headers,
          {
            ...base,
            messages: [
              { role: 'system', content: request.system },
              ...messages,
            ],
            response_format: {
              type: 'json_schema',
              json_schema: {
                name: request.output.name,
                description: request.output.description,
                schema: plainSchema(request.output.schema),
                strict: false,
              },
            },
          },
          request.timeoutMs,
        )
      ).body as ChatResponse;
    } catch (error) {
      if (
        !(error instanceof AiProviderError) ||
        error.code !== 'providerError' ||
        (error.status !== 400 && error.status !== 422)
      ) {
        throw error;
      }
      // Fallback: plain JSON in the text.
      body = (
        await postJson(
          this.fetchImpl,
          url,
          headers,
          {
            ...base,
            messages: [
              {
                role: 'system',
                content: `${request.system}\n\nAnswer with exactly one JSON object and nothing else. It must conform to this JSON Schema (${request.output.name}: ${request.output.description}):\n${JSON.stringify(plainSchema(request.output.schema))}`,
              },
              ...messages,
            ],
          },
          request.timeoutMs,
        )
      ).body as ChatResponse;
    }

    const text = body.choices?.[0]?.message?.content;
    if (typeof text !== 'string' || text.trim() === '') {
      throw new AiProviderError('badResponse', undefined, 'empty answer');
    }
    const usage = body.usage;
    return {
      json: extractJson(text),
      text,
      model: body.model ?? model,
      usage:
        usage &&
        typeof usage.prompt_tokens === 'number' &&
        typeof usage.completion_tokens === 'number'
          ? {
              inputTokens: usage.prompt_tokens,
              outputTokens: usage.completion_tokens,
            }
          : undefined,
    };
  }
}
