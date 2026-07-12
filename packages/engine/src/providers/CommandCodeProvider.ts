import type { ModelInfo } from '@agentx/shared';
import {
  apiRecordToModelInfo,
  parseCommandCodeModelProtocol,
  resolveCommandCodeOpenAiBaseUrl,
} from '@agentx/shared';
import { OpenAICompatibleProvider } from './OpenAICompatibleProvider.js';

/**
 * CommandCode Provider API exposes two native shapes on one key:
 * - OpenAI Chat Completions at /provider/v1/chat/completions
 * - Anthropic Messages at /provider/v1/messages
 *
 * Model listing uses the OpenAI-compat /models path; per-model protocol is
 * attached from API metadata when present, otherwise from the documented catalog split.
 */
export class CommandCodeProvider extends OpenAICompatibleProvider {
  constructor(apiKey: string, baseUrl?: string) {
    super(
      'commandcode',
      'CommandCode',
      apiKey,
      resolveCommandCodeOpenAiBaseUrl(baseUrl),
    );
  }

  protected override parseModels(items: Array<Record<string, unknown>>): ModelInfo[] {
    const models: ModelInfo[] = [];
    for (const record of items) {
      const id = String(record['id'] ?? record['name'] ?? '').trim();
      const info = apiRecordToModelInfo(record, this.id, this.getCapabilities(id));
      if (!info) continue;
      models.push({
        ...info,
        apiProtocol: parseCommandCodeModelProtocol(id, record),
      });
    }
    return models.sort((a, b) => a.name.localeCompare(b.name));
  }
}
