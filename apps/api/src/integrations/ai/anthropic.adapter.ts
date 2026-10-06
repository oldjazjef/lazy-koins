import {
  type AiCompletion,
  AiCompletionPort,
  type AiCompletionRequest,
  type AiConnection,
  AiProviderError,
} from './ai-completion.port';
import { type FetchLike, joinUrl, plainSchema, postJson } from './ai-http';
import { safeUrl } from './redact';

export const ANTHROPIC_DEFAULT_BASE_URL = 'https://api.anthropic.com';
export const ANTHROPIC_DEFAULT_MODEL = 'claude-sonnet-5-5';
export const ANTHROPIC_VERSION = '2023-06-01';
const DEFAULT_MAX_TOKENS = 8192;

interface MessagesResponse {
  model?: string;
  content?: { type: string; name?: string; input?: unknown; text?: string }[];
  usage?: { input_tokens?: number; output_tokens?: number };
}

/**
 * The Anthropic Messages API (`POST /v1/messages`, `x-api-key`, `anthropic-version`). Structured
 * output through **tool use**: one tool whose `input_schema` is the requested JSON Schema, forced
 * with `tool_choice`, so the answer arrives as the tool call's `input` — already parsed JSON.
 */
export class AnthropicAdapter extends AiCompletionPort {
  constructor(private readonly fetchImpl: FetchLike = fetch) {
    super();
  }

  async complete(
    connection: AiConnection,
    request: AiCompletionRequest,
  ): Promise<AiCompletion> {
    const url = joinUrl(
      connection.baseUrl || ANTHROPIC_DEFAULT_BASE_URL,
      '/v1/messages',
    );
    const model = connection.model || ANTHROPIC_DEFAULT_MODEL;
    const { body } = await postJson(
      this.fetchImpl,
      url,
      {
        'anthropic-version': ANTHROPIC_VERSION,
        ...(connection.apiKey ? { 'x-api-key': connection.apiKey } : {}),
      },
      {
        model,
        max_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
        system: request.system,
        messages: request.messages.map((m) => ({
          role: m.role,
          content: m.content,
        })),
        tools: [
          {
            name: request.output.name,
            description: request.output.description,
            input_schema: {
              type: 'object',
              ...plainSchema(request.output.schema),
            },
          },
        ],
        tool_choice: { type: 'tool', name: request.output.name },
      },
      request.timeoutMs,
    );
    const response = body as MessagesResponse;
    const call = response.content?.find(
      (block) =>
        block.type === 'tool_use' && block.name === request.output.name,
    );
    if (!call || call.input === undefined) {
      throw new AiProviderError('badResponse', {
        url: safeUrl(url),
        model: response.model ?? model,
        cause: 'the model answered without the requested tool call',
      });
    }
    const usage = response.usage;
    return {
      json: call.input,
      text: JSON.stringify(call.input),
      model: response.model ?? model,
      usage:
        usage &&
        typeof usage.input_tokens === 'number' &&
        typeof usage.output_tokens === 'number'
          ? {
              inputTokens: usage.input_tokens,
              outputTokens: usage.output_tokens,
            }
          : undefined,
    };
  }
}
