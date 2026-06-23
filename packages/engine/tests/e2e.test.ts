import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { RAGEngine } from '../src/rag/RAGEngine.js';
import { MemoryVectorStore } from '../src/rag/MemoryVectorStore.js';
import { LLMEmbeddingProvider } from '../src/rag/LLMEmbeddingProvider.js';
import { DefaultTelemetryBus } from '../src/telemetry/TelemetryBus.js';
import { AgentOrchestrator } from '../src/agent/AgentOrchestrator.js';
import { SubAgentManager } from '../src/agent/SubAgentManager.js';
import { AgentEventBus } from '../src/EventBus.js';
import { DefaultPluginLoader } from '../src/plugin/PluginLoader.js';
import { NamespaceSandbox } from '../src/sandbox/NamespaceSandbox.js';
import { DefaultStorageAdapter } from '../src/storage/StorageAdapter.js';
import { SessionStore } from '../src/session/SessionStore.js';
import { PostgresStorageAdapter } from '../src/storage/PostgresStorageAdapter.js';
import type { TelemetryEvent } from '@agentx/shared';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// ─── 1. RAG INTEGRATION ───
describe('RAG Engine (MemoryVectorStore + pseudo-embeddings)', () => {
  let store: MemoryVectorStore;
  let embedder: LLMEmbeddingProvider;
  let rag: RAGEngine;

  beforeAll(async () => {
    store = new MemoryVectorStore(4);
    embedder = new LLMEmbeddingProvider({} as never, 'text-embedding-3-small', 4);
    rag = new RAGEngine(store, embedder, { enabled: true, chunkSize: 50, chunkOverlap: 10, minScore: 0.1, maxResults: 5, embeddingModel: '' });
    await rag.storeBackend.connect();
  });

  it('indexes documents and searches semantically', async () => {
    const docId = await rag.indexDocument({ id: 'test-doc-1', content: 'The quick brown fox jumps over the lazy dog near the riverbank' });
    expect(docId).toBe('test-doc-1');

    const results = await rag.search('fox jumping');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.score).toBeGreaterThan(0);
  });

  it('returns multiple relevant results', async () => {
    await rag.indexDocument({ id: 'test-doc-2', content: 'Python is a programming language used for web development and data science' });
    await rag.indexDocument({ id: 'test-doc-3', content: 'JavaScript runs in the browser and on servers via Node.js' });

    const results = await rag.search('programming language');
    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  it('deletes a document', async () => {
    await rag.deleteDocument('test-doc-1');
    const all = await rag.search('fox');
    expect(all.every((d) => d.metadata?.['docId'] !== 'test-doc-1')).toBe(true);
  });

  it('clears all documents', async () => {
    await rag.clearAll();
    const results = await rag.search('anything');
    expect(results).toHaveLength(0);
  });
});

// ─── 2. TELEMETRY ───
describe('DefaultTelemetryBus', () => {
  let bus: DefaultTelemetryBus;

  beforeAll(() => {
    bus = new DefaultTelemetryBus({ enabled: true });
    bus.start();
  });

  afterAll(() => {
    bus.stop();
  });

  it('counts events and produces metric samples', () => {
    bus.increment('requests_total', 1, { route: '/api/chat' });
    bus.increment('requests_total', 1, { route: '/api/chat' });
    const samples = bus.snapshot();
    const total = samples.filter((s) => s.name === 'agentx_requests_total_total').reduce((s, m) => s + m.value, 0);
    expect(total).toBe(2);
  });

  it('records gauge values', () => {
    bus.gauge('memory_mb', 512);
    bus.gauge('memory_mb', 256);
    const samples = bus.snapshot();
    const gauge = samples.find((s) => s.name === 'agentx_memory_mb');
    expect(gauge).toBeDefined();
    expect(gauge!.value).toBe(256);
  });

  it('records histogram (observe) values with percentiles', () => {
    for (let i = 1; i <= 100; i++) {
      bus.observe('response_ms', i * 10);
    }
    const samples = bus.snapshot();
    const count = samples.find((s) => s.name === 'agentx_response_ms_count');
    const p99 = samples.find((s) => s.name === 'agentx_response_ms_p99');
    expect(count).toBeDefined();
    expect(count!.value).toBe(100);
    expect(p99).toBeDefined();
    // sorted[Math.floor(count * 0.99)] gives index 99 → 1000
    expect(p99!.value).toBe(1000);
  });

  it('emits events to subscribers', () => {
    const events: string[] = [];
    const unsub = bus.onEvent((event: TelemetryEvent) => { events.push(event.type); });

    const testEvent: TelemetryEvent = {
      type: 'tool_execution',
      timestamp: new Date().toISOString(),
      metadata: { tool: 'echo' },
    };
    bus.emit(testEvent);
    expect(events).toContain('tool_execution');
    unsub();

    bus.emit(testEvent);
    expect(events).toHaveLength(1);
  });

  it('can be disabled', () => {
    const disabled = new DefaultTelemetryBus({ enabled: false });
    disabled.start();
    disabled.increment('should_not_count');
    const samples = disabled.snapshot();
    expect(samples.filter((s) => s.name.includes('should_not_count'))).toHaveLength(0);
    disabled.stop();
  });
});

// ─── 3. STORAGE ADAPTERS ───
describe('DefaultStorageAdapter', () => {
  let adapter: DefaultStorageAdapter;

  beforeAll(() => {
    adapter = new DefaultStorageAdapter();
  });

  it('creates and retrieves a session', () => {
    const session = adapter.createSession({
      title: 'Test Session', status: 'active', providerId: 'openai',
      modelId: 'gpt-4', scopePath: '/', tokenUsed: 0, tokenAvailable: 128000,
    });
    expect(session.id).toBeDefined();
    const retrieved = adapter.getSession(session.id);
    expect(retrieved).not.toBeNull();
    expect(retrieved!.title).toBe('Test Session');
  });

  it('adds and retrieves messages', () => {
    const session = adapter.createSession({
      title: 'Msg Session', status: 'active', providerId: 'openai',
      modelId: 'gpt-4', scopePath: '/', tokenUsed: 0, tokenAvailable: 128000,
    });
    const msg = adapter.addMessage(session.id, {
      sessionId: session.id, role: 'user', content: 'Hello!', tokenCount: 5,
    });
    expect(msg.id).toBeDefined();
    const messages = adapter.getMessages(session.id);
    expect(messages).toHaveLength(1);
    expect(messages[0]!.content).toBe('Hello!');
    expect(adapter.getMessageCount(session.id)).toBe(1);
  });

  it('lists sessions ordered by update time', () => {
    const sessions = adapter.listSessions(5);
    expect(sessions.length).toBeGreaterThanOrEqual(2);
  });

  it('handles permissions', () => {
    const session = adapter.createSession({
      title: 'Perm Session', status: 'active', providerId: 'openai',
      modelId: 'gpt-4', scopePath: '/', tokenUsed: 0, tokenAvailable: 128000,
    });
    adapter.addPermission(session.id, { sessionId: session.id, toolName: 'file_read', targetPath: '/tmp', decision: 'allow' });
    const perms = adapter.getPermissions(session.id);
    expect(perms.length).toBeGreaterThanOrEqual(1);
    expect(perms.some((p) => p.toolName === 'file_read')).toBe(true);
  });

  it('deletes messages', () => {
    const session = adapter.createSession({
      title: 'Del Session', status: 'active', providerId: 'openai',
      modelId: 'gpt-4', scopePath: '/', tokenUsed: 0, tokenAvailable: 128000,
    });
    adapter.addMessage(session.id, { sessionId: session.id, role: 'user', content: 'x', tokenCount: 1 });
    adapter.deleteMessages(session.id);
    expect(adapter.getMessageCount(session.id)).toBe(0);
  });

  afterAll(() => {
    adapter.close();
  });
});

describe('PostgresStorageAdapter', () => {
  const pgUrl = process.env['DATABASE_URL'] || process.env['PG_URL'];
  const runPG = pgUrl ? it : it.skip;

  runPG('persists sub-agent pseudo session ids', async () => {
    const adapter = new PostgresStorageAdapter({ connectionString: pgUrl, max: 1 });
    await adapter.connect();

    const parent = adapter.createSession({
      title: 'Parent', status: 'active', providerId: 'openai',
      modelId: 'gpt-4', scopePath: '/tmp', tokenUsed: 0, tokenAvailable: 128000,
    });

    const subId = `sub-${crypto.randomUUID()}`;
    adapter.createSession({
      id: subId,
      title: 'Child Session',
      status: 'active',
      providerId: 'openai',
      modelId: 'gpt-4',
      scopePath: '/tmp',
      tokenUsed: 0,
      tokenAvailable: 128000,
      parentId: parent.id,
    } as Omit<import('@agentx/shared').StorableSession, 'id' | 'createdAt' | 'updatedAt'> & { id: string });

    expect(adapter.getSession(subId)).not.toBeNull();

    adapter.insertMessage({
      sessionId: subId,
      role: 'user',
      content: 'sub-agent task',
    });
    expect(adapter.getMessages(subId)).toHaveLength(1);

    adapter.insertPart(subId, { type: 'tool-call', toolName: 'read', toolCallId: 'tc1' });
    expect(adapter.getParts(subId)).toHaveLength(1);

    adapter.clearAll();
    await adapter.disconnect();
  });

  runPG('connects and performs CRUD', async () => {
    const adapter = new PostgresStorageAdapter({ connectionString: pgUrl, max: 1 });
    await adapter.connect();
    expect(adapter.isConnected()).toBe(true);

    const session = adapter.createSession({
      title: 'PG Test', status: 'active', providerId: 'openai',
      modelId: 'gpt-4', scopePath: '/', tokenUsed: 0, tokenAvailable: 128000,
    });
    expect(session.id).toBeDefined();
    expect(adapter.getSession(session.id)).not.toBeNull();

    const msg = adapter.addMessage(session.id, {
      sessionId: session.id, role: 'user', content: 'PG hello', tokenCount: 3,
    });
    expect(msg.id).toBeDefined();
    expect(adapter.getMessages(session.id)).toHaveLength(1);

    adapter.clearAll();
    expect(adapter.listSessions()).toHaveLength(0);
    await adapter.disconnect();
  });
});

// ─── 4. PLUGIN LOADER ───
describe('DefaultPluginLoader', () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = join(tmpdir(), `agentx-test-plugins-${Date.now()}`);
    // Create a plugin with package.json in a scan subdirectory
    mkdirSync(join(tmpDir, 'hello-plugin'), { recursive: true });
    writeFileSync(join(tmpDir, 'hello-plugin', 'package.json'), JSON.stringify({
      name: '@test/hello-plugin',
      keywords: ['agent-x-plugin'],
      main: 'index.js',
      'agent-x': {
        plugin: {
          id: 'hello-plugin',
          name: 'Hello Plugin',
          version: '1.0.0',
          description: 'Test plugin',
          tools: [],
        },
      },
    }));

    // Create a plugin with .plugin.json
    mkdirSync(join(tmpDir, 'my-custom-plugin'), { recursive: true });
    writeFileSync(join(tmpDir, 'my-custom-plugin', 'plugin.json'), JSON.stringify({
      id: 'my-custom-plugin',
      name: 'My Custom Plugin',
      version: '1.0.0',
      description: 'A custom plugin',
      tools: [],
    }));
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('discovers plugins from package.json with agent-x plugin metadata', async () => {
    const loader = new DefaultPluginLoader([tmpDir]);
    const manifest = await loader.discover();
    const found = manifest.find((m) => m.id === 'hello-plugin');
    expect(found).toBeDefined();
    expect(found!.name).toBe('Hello Plugin');
    expect(found!.source).toBe('plugin');
  });

  it('discovers plugins from plugin.json manifest files', async () => {
    const loader = new DefaultPluginLoader([tmpDir]);
    const manifest = await loader.discover();
    const found = manifest.find((m) => m.id === 'my-custom-plugin');
    expect(found).toBeDefined();
    expect(found!.name).toBe('My Custom Plugin');
  });

  it('loads a discovered plugin', async () => {
    const loader = new DefaultPluginLoader([tmpDir]);
    const manifest = await loader.discover();
    const hello = manifest.find((m) => m.id === 'hello-plugin');
    expect(hello).toBeDefined();
    const instance = await loader.load(hello!);
    expect(instance).toBeDefined();
    expect(instance.enabled).toBe(true);
    expect(instance.manifest.id).toBe('hello-plugin');
  });
});

// ─── 5. SANDBOX ───
describe('NamespaceSandbox', () => {
  it('executes a simple command and returns output', async () => {
    const sandbox = new NamespaceSandbox([tmpdir()]);
    const result = await sandbox.exec('echo hello world');
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('hello world');
  });

  it('enforces timeouts', async () => {
    const sandbox = new NamespaceSandbox([tmpdir()]);
    const result = await sandbox.exec('sleep 5', { timeout: 100 });
    expect(result.exitCode).toBe(-1);
    expect(result.error).toBe('TIMEOUT');
  });

  it('writes and reads files', async () => {
    const sandbox = new NamespaceSandbox([tmpdir()]);
    const testPath = join(tmpdir(), 'agentx-e2e-sandbox-file.txt');
    const content = 'hello sandbox file';
    await sandbox.writeFile(testPath, content);
    const read = await sandbox.readFile(testPath);
    expect(read).toBe(content);
  });
});

// ─── 6. ORCHESTRATOR ───
describe('AgentOrchestrator', () => {
  let orchestrator: AgentOrchestrator;

  beforeAll(() => {
    const subAgents = new SubAgentManager({} as never, {} as never);
    const eventBus = new AgentEventBus();
    orchestrator = new AgentOrchestrator(subAgents, eventBus);
  });

  it('creates a plan from a goal', async () => {
    const plan = await orchestrator.createPlan('Research and summarize AI trends');
    expect(plan.id).toMatch(/^plan_/);
    expect(plan.goal).toBe('Research and summarize AI trends');
    expect(plan.status).toBe('planning');
  });

  it('lists all plans', () => {
    const plans = orchestrator.listPlans();
    expect(plans.length).toBeGreaterThanOrEqual(1);
    expect(plans.some((p) => p.id.startsWith('plan_'))).toBe(true);
  });

  it('cancels a running plan', async () => {
    const plan = await orchestrator.createPlan('Cancel test');
    orchestrator.cancel(plan.id);
    const cancelled = orchestrator.getPlan(plan.id)!;
    expect(cancelled.status).toBe('failed');
  });

  it('returns undefined for unknown plan', () => {
    expect(orchestrator.getPlan('nonexistent')).toBeUndefined();
  });
});

// ─── 7. CROSS-MODULE INTEGRATION ───
describe('Cross-module integration', () => {
  it('TelemetryBus + RAGEngine work together', async () => {
    const telemetry = new DefaultTelemetryBus({ enabled: true });
    telemetry.start();

    const store = new MemoryVectorStore(4);
    const embedder = new LLMEmbeddingProvider({} as never, 'text-embedding-3-small', 4);
    const rag = new RAGEngine(store, embedder, { enabled: true, chunkSize: 100, chunkOverlap: 20, minScore: 0, maxResults: 5, embeddingModel: '' });
    await rag.storeBackend.connect();

    telemetry.increment('rag_documents_indexed');
    const indexed = await rag.indexDocument({ id: 'integ-test', content: 'Integration testing ensures modules work together correctly' });
    expect(indexed).toBe('integ-test');

    const results = await rag.search('integration');
    expect(results.length).toBeGreaterThan(0);

    const samples = telemetry.snapshot();
    expect(samples.filter((s) => s.name.includes('rag_documents_indexed_total')).reduce((a, s) => a + s.value, 0)).toBe(1);

    telemetry.stop();
    await rag.clearAll();
  });

  it('DefaultStorageAdapter + SessionStore integration', () => {
    const store = new SessionStore();
    const adapter = new DefaultStorageAdapter(store);
    const session = adapter.createSession({
      title: 'Integration Test', status: 'active', providerId: 'openai',
      modelId: 'gpt-4', scopePath: '/', tokenUsed: 0, tokenAvailable: 128000,
    });
    expect(session.id).toBeDefined();
    expect(adapter.getSession(session.id)).not.toBeNull();
    expect(adapter.getMessages(session.id)).toEqual([]);
    adapter.close();
  });
});
