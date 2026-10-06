import {
  type AiCompletion,
  AiCompletionPort,
  type AiCompletionRequest,
  type AiConnection,
} from './ai-completion.port';
import type { FetchLike } from './ai-http';
import { AnthropicAdapter } from './anthropic.adapter';
import { OpenAiCompatibleAdapter } from './openai-compatible.adapter';

/** What `AiCompletionPort` is bound to: the adapter for the connection's provider kind. */
export class ProviderSwitchingAiCompletion extends AiCompletionPort {
  private readonly openAi: OpenAiCompatibleAdapter;
  private readonly anthropic: AnthropicAdapter;

  constructor(fetchImpl: FetchLike = fetch) {
    super();
    this.openAi = new OpenAiCompatibleAdapter(fetchImpl);
    this.anthropic = new AnthropicAdapter(fetchImpl);
  }

  complete(
    connection: AiConnection,
    request: AiCompletionRequest,
  ): Promise<AiCompletion> {
    return connection.kind === 'anthropic'
      ? this.anthropic.complete(connection, request)
      : this.openAi.complete(connection, request);
  }
}
