import { generateText } from 'ai';
import type { AgentXConfig } from '@agentx/shared';
import { createAiSdkModel } from '../agent/AiSdkBridge.js';
import { LocalLLMJudge } from '../neural/LocalLLMJudge.js';
import type { GenerateFn } from './interfaces.js';

/**
 * Runtime consumer of `featureRouting.capabilityGeneration`.
 * Config keys alone do nothing — this adapter is the consumer.
 */
export async function buildCapabilityGenerator(config: AgentXConfig): Promise<GenerateFn> {
  const inner = await buildRawGenerator(config);
  return withRetries(inner, 3, 45_000);
}

async function buildRawGenerator(config: AgentXConfig): Promise<GenerateFn> {
  const route = config.featureRouting?.capabilityGeneration ?? 'cloud';
  if (route === 'local') {
    const judge = new LocalLLMJudge({ maxNewTokens: 2048, temperature: 0.2 });
    return async (prompt, system) => judge.generate(`${system}\n\n${prompt}`, { maxTokens: 2048 });
  }
  const model = createAiSdkModel(config);
  return async (prompt, system) => {
    const result = await generateText({
      model,
      system,
      prompt,
      maxOutputTokens: 2048,
      temperature: 0.2,
    });
    return result.text;
  };
}

export function withRetries(fn: GenerateFn, attempts = 3, timeoutMs = 45_000): GenerateFn {
  return async (prompt, system) => {
    let last: unknown;
    for (let i = 0; i < attempts; i++) {
      try {
        return await Promise.race([
          fn(prompt, system),
          new Promise<string>((_, reject) => {
            setTimeout(() => reject(new Error('LLM timeout')), timeoutMs);
          }),
        ]);
      } catch (err) {
        last = err;
      }
    }
    throw last instanceof Error ? last : new Error(String(last));
  };
}
