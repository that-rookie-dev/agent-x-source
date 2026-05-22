import type {
  CompletionRequest,
  CompletionChunk,
  ModelInfo,
  ProviderId,
} from '@agentx/shared';

export interface ProviderInterface {
  readonly id: ProviderId;
  readonly name: string;

  /**
   * Validate that the provider is properly configured and reachable.
   */
  validate(): Promise<boolean>;

  /**
   * Fetch available models from the provider.
   */
  listModels(): Promise<ModelInfo[]>;

  /**
   * Send a completion request and get a streaming response.
   */
  complete(request: CompletionRequest): AsyncIterable<CompletionChunk>;
}
