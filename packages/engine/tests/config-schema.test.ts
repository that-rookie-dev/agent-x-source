import { describe, it, expect } from 'vitest';
import { agentXConfigSchema } from '../src/config/ConfigSchema.js';

describe('ConfigSchema', () => {
  it('preserves localModel and featureRouting fields on parse', () => {
    const config = {
      provider: {
        activeProvider: 'openai',
        activeModel: 'gpt-4o',
        providers: {
          openai: {
            apiKey: 'sk-test',
            configured: true,
          },
        },
      },
      ui: {
        theme: 'dark',
        showTokenBar: true,
        showTimers: true,
      },
      user: {
        callsign: 'tester',
      },
      setupComplete: true,
      localModel: {
        enabled: true,
        modelId: 'smollm-360m',
        modelName: 'HuggingFaceTB/SmolLM-360M-Instruct',
        displayName: 'SmolLM 2 (360M)',
        cacheDir: '/home/test/.agentx/models',
        downloadedAt: '2024-01-01T00:00:00.000Z',
        dtype: 'q4',
        downloadedModels: [
          {
            modelId: 'smollm-360m',
            modelName: 'HuggingFaceTB/SmolLM-360M-Instruct',
            displayName: 'SmolLM 2 (360M)',
            downloadedAt: '2024-01-01T00:00:00.000Z',
            dtype: 'q4',
          },
        ],
      },
      featureRouting: {
        memoryExtraction: 'local',
        memoryConsolidation: 'local',
      },
    };

    const parsed = agentXConfigSchema.parse(config);

    expect(parsed.localModel).toEqual(config.localModel);
    expect(parsed.featureRouting).toEqual(config.featureRouting);
  });

  it('preserves optional tuning and agent fields', () => {
    const config = {
      provider: {
        activeProvider: 'openai',
        activeModel: 'gpt-4o',
        providers: {
          openai: {
            apiKey: 'sk-test',
            configured: true,
          },
        },
      },
      ui: {
        theme: 'dark',
        showTokenBar: true,
        showTimers: true,
      },
      user: {
        callsign: 'tester',
      },
      maxSubAgents: 5,
      maxSteps: 15,
      maxRetries: 3,
      maxOutputTokens: 4096,
      useSandbox: true,
      permissions: {
        shell: 'ask',
      },
      agents: {
        planner: {
          model: 'gpt-4o-mini',
          temperature: 0.2,
          systemPrompt: 'You are a planner.',
          deniedTools: ['writeFile'],
          permissions: [
            { id: 'p1', action: 'read', pattern: '*.md', effect: 'allow', comment: 'ok' },
          ],
        },
      },
    };

    const parsed = agentXConfigSchema.parse(config);

    expect(parsed.maxSubAgents).toBe(5);
    expect(parsed.maxSteps).toBe(15);
    expect(parsed.maxRetries).toBe(3);
    expect(parsed.maxOutputTokens).toBe(4096);
    expect(parsed.useSandbox).toBe(true);
    expect(parsed.permissions).toEqual(config.permissions);
    expect(parsed.agents).toEqual(config.agents);
  });

  it('preserves notification channels on parse', () => {
    const config = {
      provider: {
        activeProvider: 'openai',
        activeModel: 'gpt-4o',
        providers: {
          openai: {
            apiKey: 'sk-test',
            configured: true,
          },
        },
      },
      ui: {
        theme: 'dark',
        showTokenBar: true,
        showTimers: true,
        animationSpeed: 'normal',
      },
      user: {
        callsign: 'tester',
      },
      channels: {
        telegram: {
          enabled: true,
          inbound: true,
          outbound: true,
          botToken: '123:ABC',
          chatId: '999',
        },
        slack: { enabled: false, inbound: true, outbound: true },
      },
    };

    const parsed = agentXConfigSchema.parse(config);

    expect(parsed.channels?.telegram?.enabled).toBe(true);
    expect(parsed.channels?.telegram?.botToken).toBe('123:ABC');
    expect(parsed.channels?.telegram?.chatId).toBe('999');
    expect(parsed.channels?.slack?.enabled).toBe(false);
  });

  it('allows localModel and featureRouting to be omitted', () => {
    const config = {
      provider: {
        activeProvider: 'openai',
        activeModel: 'gpt-4o',
        providers: {
          openai: {
            apiKey: 'sk-test',
            configured: true,
          },
        },
      },
      ui: {
        theme: 'dark',
        showTokenBar: true,
        showTimers: true,
      },
      user: {
        callsign: 'tester',
      },
    };

    const parsed = agentXConfigSchema.parse(config);

    expect(parsed.localModel).toBeUndefined();
    expect(parsed.featureRouting).toBeUndefined();
  });
});
