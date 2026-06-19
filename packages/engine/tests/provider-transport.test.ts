import { describe, it, expect } from 'vitest';
import { makeRoute, openAIProtocol } from '../src/providers/routes/Route.js';
import { BaseTransport } from '../src/providers/transports/BaseTransport.js';
import { RequestPreparer } from '../src/communication/RequestPreparer.js';

describe('Route Protocol', () => {
  it('openAIProtocol converts messages', () => {
    const proto = openAIProtocol();
    const result = proto.convertMessages([
      { role: 'system', content: 'You are helpful' },
      { role: 'user', content: 'Hello' },
    ]);
    expect(Array.isArray(result)).toBe(true);
    expect((result as Array<{ role: string }>)[0]!.role).toBe('system');
  });

  it('openAIProtocol converts tools', () => {
    const proto = openAIProtocol();
    const result = proto.convertTools([
      { type: 'function', function: { name: 'read', description: 'Read file', parameters: {} } },
    ]);
    expect(Array.isArray(result)).toBe(true);
  });

  it('makeRoute creates a valid route config', () => {
    const route = makeRoute({
      id: 'test-chat',
      provider: 'test',
      protocol: openAIProtocol(),
      endpoint: { baseUrl: 'https://api.test.com', path: '/v1/chat' },
      auth: { type: 'bearer', getHeaders: async () => ({ Authorization: 'Bearer test' }) },
      framing: 'sse',
    });
    expect(route.id).toBe('test-chat');
    expect(route.framing).toBe('sse');
  });
});

describe('RequestPreparer', () => {
  it('prepares a provider plan', () => {
    const preparer = new RequestPreparer({
      provider: { id: 'openai', name: 'OpenAI', validate: async () => true, listModels: async () => [], complete: async function*() {} },
      defaultMaxTokens: 4096,
      defaultTimeoutMs: 120000,
      maxRetries: 3,
    });

    const plan = preparer.prepare(
      {
        stablePrefix: '', cacheBoundary: '', dynamicSuffix: '', volatileSuffix: '',
        fullSystemPrompt: 'You are helpful', stableHash: 'abc',
      },
      {
        id: 's1', title: '', providerId: 'openai', modelId: 'gpt-4o',
        scopePath: '/tmp', tokenUsed: 0, tokenAvailable: 128000, status: 'active',
        createdAt: '', updatedAt: '',
      },
      [{ id: 'm1', sessionId: 's1', role: 'user', content: 'Hi', toolCalls: null, tokenCount: 1, createdAt: '' }],
      [],
    );
    expect(plan.providerId).toBe('openai');
    expect(plan.modelId).toBe('gpt-4o');
    expect(plan.messages.length).toBeGreaterThan(0);
  });
});
