import {
  type AiChatMessage,
  type AiCompletion,
  AiCompletionPort,
  type AiCompletionRequest,
  type AiConnection,
  type AiConverseRequest,
  type AiConverseTurn,
  AiProviderError,
  type AiUsage,
} from './ai-completion.port';
import { type FetchLike, joinUrl, plainSchema, postJson } from './ai-http';
import { safeUrl } from './redact';

export const ANTHROPIC_DEFAULT_BASE_URL = 'https://api.anthropic.com';
export const ANTHROPIC_DEFAULT_MODEL = 'claude-sonnet-5-5';
export const ANTHROPIC_VERSION = '2023-06-01';
const DEFAULT_MAX_TOKENS = 8192;

interface MessagesResponse {
  model?: string;
  content?: {
    type: string;
    id?: string;
    name?: string;
    input?: unknown;
    text?: string;
  }[];
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
    return {
      json: call.input,
      text: JSON.stringify(call.input),
      model: response.model ?? model,
      usage: usageOf(response.usage),
    };
  }

  /**
   * F11.14: Messages with `tools` (`tool_choice` auto). The answer's `tool_use` blocks are the
   * calls; results go back as `tool_result` blocks in the next user turn. Consecutive turns of
   * the same role are merged — the API wants them alternating.
   */
  async converse(
    connection: AiConnection,
    request: AiConverseRequest,
  ): Promise<AiConverseTurn> {
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
        messages: anthropicMessages(request.messages),
        ...(request.tools.length > 0
          ? {
              tools: request.tools.map((tool) => ({
                name: tool.name,
                description: tool.description,
                input_schema: {
                  type: 'object',
                  ...plainSchema(tool.inputSchema),
                },
              })),
              tool_choice: { type: 'auto' },
            }
          : {}),
      },
      request.timeoutMs,
    );
    const response = body as MessagesResponse & { stop_reason?: string };
    if (!Array.isArray(response.content)) {
      throw new AiProviderError('badResponse', {
        url: safeUrl(url),
        model: response.model ?? model,
        cause: 'the answer has no content',
      });
    }
    const text = response.content
      .filter(
        (block) => block.type === 'text' && typeof block.text === 'string',
      )
      .map((block) => block.text)
      .join('');
    const toolCalls = response.content
      .filter((block) => block.type === 'tool_use' && block.name)
      .map((block, index) => ({
        id: block.id ?? `toolu_${index}`,
        name: block.name ?? '',
        input: block.input ?? {},
      }));
    const stop = response.stop_reason;
    return {
      text,
      toolCalls,
      model: response.model ?? model,
      usage: usageOf(response.usage),
      stop:
        toolCalls.length > 0 || stop === 'tool_use'
          ? 'toolUse'
          : stop === 'max_tokens'
            ? 'maxTokens'
            : stop === 'end_turn' || stop === undefined
              ? 'end'
              : 'other',
    };
  }
}

function usageOf(usage: MessagesResponse['usage']): AiUsage | undefined {
  return usage &&
    typeof usage.input_tokens === 'number' &&
    typeof usage.output_tokens === 'number'
    ? { inputTokens: usage.input_tokens, outputTokens: usage.output_tokens }
    : undefined;
}

type AnthropicBlock = Record<string, unknown>;

/** Provider-neutral turns as Anthropic messages: tool results become user `tool_result` blocks. */
export function anthropicMessages(
  messages: readonly AiChatMessage[],
): { role: 'user' | 'assistant'; content: AnthropicBlock[] }[] {
  const out: { role: 'user' | 'assistant'; content: AnthropicBlock[] }[] = [];
  const push = (role: 'user' | 'assistant', blocks: AnthropicBlock[]) => {
    if (blocks.length === 0) return;
    const last = out[out.length - 1];
    if (last && last.role === role) last.content.push(...blocks);
    else out.push({ role, content: blocks });
  };
  for (const message of messages) {
    if (message.role === 'tool') {
      push('user', [
        {
          type: 'tool_result',
          tool_use_id: message.toolCallId,
          content: message.content,
          ...(message.isError ? { is_error: true } : {}),
        },
      ]);
    } else if (message.role === 'assistant') {
      push('assistant', [
        ...(message.content !== ''
          ? [{ type: 'text', text: message.content }]
          : []),
        ...(message.toolCalls ?? []).map((call) => ({
          type: 'tool_use',
          id: call.id,
          name: call.name,
          input: call.input ?? {},
        })),
      ]);
    } else {
      push('user', [{ type: 'text', text: message.content }]);
    }
  }
  return out;
}
