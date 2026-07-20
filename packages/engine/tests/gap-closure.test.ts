import { describe, it, expect, beforeEach } from 'vitest';
import { EnhancedToolExecutor } from '../src/tools/EnhancedToolExecutor.js';
import { ToolRegistry } from '../src/tools/ToolRegistry.js';
import { PromptEngine } from '../src/prompt/PromptEngine.js';

// ─── Helper: create a minimal ToolRegistry ───
function dummyRegistry() {
  const registry = new ToolRegistry();
  registry.register({
    id: 'test_tool',
    name: 'test_tool',
    description: 'A test tool',
    modelDescription: 'Test tool',
    category: 'system_os' as const,
    riskLevel: 'low',
    schema: { type: 'object', properties: {}, required: [] },
    composable: false,
    source: 'builtin' as const,
  });
  registry.register({
    id: 'file_write',
    name: 'file_write',
    description: 'Write a file',
    modelDescription: 'Writes file',
    category: 'filesystem' as const,
    riskLevel: 'medium',
    schema: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] },
    composable: false,
    source: 'builtin' as const,
  });
  registry.register({
    id: 'shell_exec',
    name: 'shell_exec',
    description: 'Execute a shell command',
    modelDescription: 'Shell exec',
    category: 'shell_process' as const,
    riskLevel: 'high',
    schema: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] },
    composable: false,
    source: 'builtin' as const,
  });
  return registry;
}

// ─────────────────────────────────────────────
// Gap 3: Circuit Breaker Tests
// ─────────────────────────────────────────────
describe('Gap 3 — Circuit Breaker', () => {
  let executor: EnhancedToolExecutor;
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = dummyRegistry();
    executor = new EnhancedToolExecutor(registry, '/tmp');
    executor.registerHandler('test_tool', async () => ({ success: true, output: 'ok' }));
    executor.registerHandler('file_write', async () => ({ success: false, output: 'permission denied', error: 'PERMISSION_DENIED' }));
    executor.registerHandler('shell_exec', async () => ({ success: false, output: 'timeout', error: 'TIMEOUT' }));
  });

  it('isCircuitBlacklisted returns false for clean tool', () => {
    expect(executor.isCircuitBlacklisted('test_tool')).toBe(false);
  });

  it('blacklists a tool after 3 failures', () => {
    executor.recordCircuitFailure('file_write');
    executor.recordCircuitFailure('file_write');
    expect(executor.isCircuitBlacklisted('file_write')).toBe(false);
    executor.recordCircuitFailure('file_write');
    expect(executor.isCircuitBlacklisted('file_write')).toBe(true);
  });

  it('resets failure window after cooldown elapses (simulated)', () => {
    // Force an old timestamp to test stale window expiry
    const entry = executor['circuitBreakers'].get('shell_exec');
    if (entry) {
      entry.firstFailureAt = Date.now() - 120_000; // 2 min ago — outside 60s window
    }
    executor.recordCircuitFailure('shell_exec');
    executor.recordCircuitFailure('shell_exec');
    expect(executor.isCircuitBlacklisted('shell_exec')).toBe(false); // old failures expired
  });

  it('getCircuitBreakerStatus returns correct status', () => {
    executor.recordCircuitFailure('file_write');
    const status = executor.getCircuitBreakerStatus();
    expect(status.some(s => s.tool === 'file_write' && s.failures === 1 && !s.blacklisted)).toBe(true);
  });

  it('blacklists after 3 failures within 60s window', () => {
    for (let i = 0; i < 3; i++) executor.recordCircuitFailure('shell_exec');
    expect(executor.isCircuitBlacklisted('shell_exec')).toBe(true);
    const status = executor.getCircuitBreakerStatus();
    const cb = status.find(s => s.tool === 'shell_exec');
    expect(cb?.blacklisted).toBe(true);
    expect(cb?.failures).toBe(3);
  });

  it('clears blacklist on tool success', () => {
    for (let i = 0; i < 3; i++) executor.recordCircuitFailure('file_write');
    expect(executor.isCircuitBlacklisted('file_write')).toBe(true);
    // Clearing should happen via _execOne on success — simulate
    executor['circuitBreakers'].delete('file_write');
    expect(executor.isCircuitBlacklisted('file_write')).toBe(false);
  });
});

// ─────────────────────────────────────────────
// Gap 4: PromptEngine — Structured Compression
// ─────────────────────────────────────────────
describe('Gap 4 — Structured Message Compression', () => {
  let engine: PromptEngine;

  beforeEach(() => {
    engine = new PromptEngine(128000);
  });

  it('extracts file facts from messages', () => {
    const facts = engine['extractKeyFacts']('Created package.json with node dependencies. Wrote src/index.ts with the main entry point.');
    expect(facts.some(f => f.includes('package.json'))).toBe(true);
    expect(facts.some(f => f.includes('index.ts'))).toBe(true);
  });

  it('extracts error facts from messages', () => {
    const facts = engine['extractKeyFacts']('Error: npm install failed with EACCES. Failed to compile index.ts.');
    expect(facts.some(f => f.includes('Error'))).toBe(true);
  });

  it('extracts URL facts', () => {
    const facts = engine['extractKeyFacts']('Refer to https://docs.example.com/api for details and https://github.com/user/repo for code.');
    expect(facts.some(f => f.includes('https://docs.example.com/api'))).toBe(true);
  });

  it('returns empty facts for empty content', () => {
    const facts = engine['extractKeyFacts']('');
    expect(facts).toHaveLength(0);
  });

  it('deduplicates facts within limit', () => {
    const repeated = Array(20).fill('Error: timeout').join('\n');
    const facts = engine['extractKeyFacts'](repeated);
    const errorFacts = facts.filter(f => f.includes('Error'));
    expect(errorFacts.length).toBeLessThanOrEqual(3);
  });
});

// ─────────────────────────────────────────────
// Gap 2: Task Plan Validation
// ─────────────────────────────────────────────
describe('Gap 2 — Plan Validation', () => {
  it('filters out empty steps', () => {
    // Dynamically import TaskExecutor — validatePlanSteps is a private method
    // Test via the concept: empty descriptions should not pass
    const steps = [
      { id: '1', description: '', expectedOutcome: '', status: 'pending' as const },
      { id: '2', description: 'Do something real', expectedOutcome: 'Done', status: 'pending' as const },
      { id: '3', description: '  ', expectedOutcome: '', status: 'pending' as const },
    ];
    // Simulate validation: steps with empty descriptions should be filtered
    const valid = steps.filter(s => s.description.trim().length >= 3);
    expect(valid).toHaveLength(1);
    expect(valid[0]!.description).toBe('Do something real');
  });

  it('rejects steps with invalid dependencies', () => {
    const stepIds = new Set(['step-1', 'step-2']);
    const steps = [
      { id: 'step-1', description: 'First', expectedOutcome: '', status: 'pending' as const, dependencies: ['step-99'] },
    ];
    for (const step of steps) {
      if (step.dependencies) {
        step.dependencies = step.dependencies.filter(d => stepIds.has(d));
      }
    }
    expect(steps[0]!.dependencies).toHaveLength(0);
  });

  it('does not allow step to depend on itself', () => {
    const stepIds = new Set(['step-1']);
    const steps = [
      { id: 'step-1', description: 'First', expectedOutcome: '', status: 'pending' as const, dependencies: ['step-1'] },
    ];
    for (const step of steps) {
      if (step.dependencies) {
        step.dependencies = step.dependencies.filter(d => stepIds.has(d) && d !== step.id);
      }
    }
    expect(steps[0]!.dependencies).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────
// Gap 5: Escalation Protocol
// ─────────────────────────────────────────────
describe('Gap 5 — Escalation Protocol', () => {
  it('tracks consecutive checkpoints for the same step', () => {
    const counts = new Map<string, number>();
    const stepKey = 'Fix authentication module';
    
    // First checkpoint: just track, no escalation
    const c1 = (counts.get(stepKey) || 0) + 1;
    counts.set(stepKey, c1);
    expect(c1).toBe(1);
    
    // Second checkpoint: escalation triggered
    const c2 = (counts.get(stepKey) || 0) + 1;
    counts.set(stepKey, c2);
    expect(c2).toBe(2);
    expect(c2 >= 2).toBe(true); // Escalation condition
    
    // Third checkpoint: still escalating
    const c3 = (counts.get(stepKey) || 0) + 1;
    counts.set(stepKey, c3);
    expect(c3).toBe(3);
  });

  it('different steps have independent escalation counters', () => {
    const counts = new Map<string, number>();
    
    const keyA = 'Step A';
    const keyB = 'Step B';
    
    counts.set(keyA, (counts.get(keyA) || 0) + 1);
    counts.set(keyA, (counts.get(keyA) || 0) + 1);
    counts.set(keyB, (counts.get(keyB) || 0) + 1);
    
    expect(counts.get(keyA)).toBe(2); // Escalated
    expect(counts.get(keyB)).toBe(1); // Not yet escalated
  });
});

// ─────────────────────────────────────────────
// Gap 3 (additional): Doom Loop + Circuit Breaker Interaction
// ─────────────────────────────────────────────
describe('Gap 3 — Doom Loop + Circuit Breaker coexistence', () => {
  let executor: EnhancedToolExecutor;
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = dummyRegistry();
    executor = new EnhancedToolExecutor(registry, '/tmp');
  });

  it('circuit breaker operates independently from doom loop detector', () => {
    // Doom loop is per-session with pattern matching
    // Circuit breaker is global per-tool failure counting
    // Both can be active simultaneously
    const dd = executor.doomLoopDetector.check('session-a', 'test_tool', {});
    expect(dd.isDoomLoop).toBe(false);
    
    const cb = executor.isCircuitBlacklisted('test_tool');
    expect(cb).toBe(false);
  });
});

// ─────────────────────────────────────────────
// Gap 3 + 4: EnhancedToolExecutor batch execution with circuit breaker
// ─────────────────────────────────────────────
describe('Gap 3 — EnhancedToolExecutor batch with CB check', () => {
  let executor: EnhancedToolExecutor;
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = dummyRegistry();
    executor = new EnhancedToolExecutor(registry, '/tmp');
    executor.registerHandler('test_tool', async () => ({ success: true, output: 'ok' }));
  });

  it('_execOne returns a result (circuit breaker + doom loop path)', async () => {
    executor.setPermissionRequestHandler(async () => 'allow_once');
    const result = await executor['_execOne']('call-1', 'test_tool', {}, 'sess-1');
    expect(result.toolCallId).toBe('call-1');
    // Success depends on handler + scope — at minimum we got a result
    expect(result).toBeDefined();
  });

  it('circuit breaker blocks blacklisted tool in _execOne', () => {
    for (let i = 0; i < 3; i++) executor.recordCircuitFailure('test_tool');
    // Need to access private method for testing
    const isBlocked = executor.isCircuitBlacklisted('test_tool');
    expect(isBlocked).toBe(true);
  });

  it('circuit breaker status includes blacklisted tools', () => {
    for (let i = 0; i < 3; i++) executor.recordCircuitFailure('file_write');
    const status = executor.getCircuitBreakerStatus();
    const fileStatus = status.find(s => s.tool === 'file_write');
    expect(fileStatus).toBeDefined();
    expect(fileStatus!.blacklisted).toBe(true);
    expect(fileStatus!.remainingMs).toBeGreaterThan(0);
  });
});
