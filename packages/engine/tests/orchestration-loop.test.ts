import { describe, it, expect, beforeEach } from 'vitest';
import {
  requiresPlanIntent,
  requiresExecutionIntent,
  shouldEscalateForExecution,
  shouldGeneratePlan,
  shouldUseInteractivePlanGates,
  isWriteTool,
  isReadOnlyTool,
  isPlanDeniedTool,
  ALL_PLAN_DENIED_TOOLS,
} from '../src/agent/plan-mode-utils.js';
import { ToolLedger } from '../src/agent/ToolLedger.js';
import { TurnStateManager } from '../src/agent/TurnStateManager.js';
import { EnhancedToolExecutor } from '../src/tools/EnhancedToolExecutor.js';
import { ToolRegistry } from '../src/tools/ToolRegistry.js';
import { BUILTIN_AGENTS } from '../src/agent/agent-configs.js';

describe('plan-mode-utils', () => {
  it('detects plan intent keywords', () => {
    expect(requiresPlanIntent('create a plan for auth')).toBe(true);
    expect(requiresPlanIntent('hello there')).toBe(false);
  });

  it('detects execution intent keywords for edit/delete', () => {
    expect(requiresExecutionIntent('delete the old config file')).toBe(true);
    expect(requiresExecutionIntent('edit line 42 in main.ts')).toBe(true);
    expect(requiresExecutionIntent('what is plan mode?')).toBe(false);
    expect(requiresExecutionIntent('create a new API endpoint')).toBe(false);
  });

  it('does not escalate for execution in plan mode', () => {
    expect(shouldEscalateForExecution('build the API endpoint', 'task')).toBe(false);
    expect(shouldEscalateForExecution('create a plan to build the API', 'task')).toBe(false);
    expect(shouldEscalateForExecution('hello', 'greeting')).toBe(false);
  });

  it('shouldGeneratePlan uses classifier + keywords', () => {
    expect(shouldGeneratePlan('outline the migration')).toBe(true);
    expect(shouldGeneratePlan('deploy to prod', 'task')).toBe(false);
    expect(shouldGeneratePlan('need a roadmap', 'task')).toBe(true);
  });

  it('shouldGeneratePlan skips conversational travel/lifestyle planning', () => {
    expect(shouldGeneratePlan('Can you help me plan the itinerary?')).toBe(false);
    expect(shouldGeneratePlan('I am planning a vacation with my family')).toBe(false);
    expect(shouldGeneratePlan('create a plan for the auth microservice migration')).toBe(true);
  });

  it('isWriteTool covers edit/delete tools only', () => {
    expect(isWriteTool('file_write')).toBe(false);
    expect(isWriteTool('doc_markdown')).toBe(false);
    expect(isWriteTool('bash')).toBe(false);
    expect(isWriteTool('file_edit')).toBe(true);
    expect(isWriteTool('file_delete')).toBe(true);
    expect(isWriteTool('glob')).toBe(false);
    expect(ALL_PLAN_DENIED_TOOLS.has('delegate_to_subagent')).toBe(true);
  });

  it('isReadOnlyTool reflects plan-allowed non-edit tools', () => {
    expect(isReadOnlyTool('file_read')).toBe(true);
    expect(isReadOnlyTool('http_get')).toBe(true);
    expect(isReadOnlyTool('file_write')).toBe(true);
    expect(isReadOnlyTool('doc_markdown')).toBe(true);
    expect(isReadOnlyTool('file_edit')).toBe(false);
  });

  it('interactive plan gates are disabled', () => {
    expect(shouldUseInteractivePlanGates(true, false)).toBe(false);
    expect(shouldUseInteractivePlanGates(true, true)).toBe(false);
    expect(shouldUseInteractivePlanGates(false, false)).toBe(false);
  });
});

describe('plan mode tool executor blocking', () => {
  const planAgent = BUILTIN_AGENTS.find((a) => a.id === 'plan')!;

  function makeExecutor(toolIds: string[]): EnhancedToolExecutor {
    const registry = new ToolRegistry();
    for (const id of toolIds) {
      registry.register({
        id,
        name: id,
        description: id,
        modelDescription: id,
        category: 'filesystem' as const,
        riskLevel: 'low',
        schema: { type: 'object', properties: {}, required: [] },
        composable: false,
        source: 'builtin' as const,
      });
    }
    const executor = new EnhancedToolExecutor(registry, '/tmp');
    executor.registerHandler('glob', async () => ({ success: true, output: 'ok' }));
    executor.registerHandler('doc_markdown', async () => ({ success: true, output: 'written' }));
    executor.setMode('plan');
    executor.setAgent(planAgent);
    return executor;
  }

  it('blocks file_edit in plan mode', async () => {
    const executor = makeExecutor(['glob', 'file_edit']);
    const result = await executor.execute('file_edit', { path: 'x.ts', old_string: 'a', new_string: 'b' }, 'sid');
    expect(result.success).toBe(false);
    expect(result.error).toBe('MODE_RESTRICTED');
  });

  it('allows doc_markdown in plan mode', async () => {
    const executor = makeExecutor(['glob', 'doc_markdown']);
    executor.registerHandler('doc_markdown', async () => ({ success: true, output: 'written' }));
    const result = await executor.execute('doc_markdown', { file: 'plan.md', sections: [] }, 'sid');
    expect(result.success).toBe(true);
  });

  it('allows glob in plan mode', async () => {
    const executor = makeExecutor(['glob', 'doc_markdown']);
    const result = await executor.execute('glob', { pattern: '*.ts' }, 'sid');
    expect(result.success).toBe(true);
  });

  it('isPlanDeniedTool matches executor gate', () => {
    expect(isPlanDeniedTool('file_edit')).toBe(true);
    expect(isPlanDeniedTool('doc_markdown')).toBe(false);
    expect(isPlanDeniedTool('glob')).toBe(false);
  });
});

describe('ToolLedger', () => {
  let ledger: ToolLedger;

  beforeEach(() => {
    ledger = new ToolLedger();
  });

  it('records and formats entries for history', () => {
    ledger.record({ name: 'glob', success: true, output: 'found 3 files', elapsed: 12 });
    ledger.record({ name: 'file_write', success: false, output: 'denied', elapsed: 5, path: '/tmp/x' });
    const formatted = ledger.formatForHistory();
    expect(formatted).toContain('[TURN TOOL LEDGER]');
    expect(formatted).toContain('[TOOL glob OK]');
    expect(formatted).toContain('[TOOL file_write FAILED path=/tmp/x]');
  });

  it('reset clears entries', () => {
    ledger.record({ name: 'glob', success: true, output: 'ok', elapsed: 1 });
    ledger.reset();
    expect(ledger.getEntries()).toHaveLength(0);
    expect(ledger.formatForHistory()).toBe('');
  });

  it('partitions successful vs failed writes', () => {
    ledger.record({ name: 'file_write', success: true, output: 'written', elapsed: 1 });
    ledger.record({ name: 'file_write', success: false, output: 'fail', elapsed: 1 });
    expect(ledger.getSuccessfulWrites()).toHaveLength(1);
    expect(ledger.getFailedWrites()).toHaveLength(1);
  });
});

describe('TurnStateManager', () => {
  let mgr: TurnStateManager;

  beforeEach(() => {
    mgr = new TurnStateManager();
  });

  it('starts in idle and transitions through phases', () => {
    expect(mgr.getSnapshot().phase).toBe('idle');
    mgr.start('turn-1', 'receiving');
    expect(mgr.phaseNow).toBe('running');
    mgr.setPhase('awaiting_plan', 'plan_review');
    expect(mgr.getSnapshot()).toMatchObject({ phase: 'awaiting_plan', stage: 'plan_review', turnId: 'turn-1' });
    mgr.complete();
    expect(mgr.getSnapshot().phase).toBe('done');
  });

  it('tracks stage and step updates', () => {
    mgr.start('t2');
    mgr.setStage('thinking', 0);
    mgr.setStage('execution', 3);
    const snap = mgr.getSnapshot();
    expect(snap.stage).toBe('execution');
    expect(snap.step).toBe(3);
    expect(snap.startedAt).toBeTruthy();
    expect(snap.lastActivityAt).toBeTruthy();
  });

  it('cancel and reset restore idle', () => {
    mgr.start('t3');
    mgr.cancel();
    expect(mgr.getSnapshot().phase).toBe('cancelled');
    mgr.reset();
    expect(mgr.getSnapshot()).toMatchObject({
      phase: 'idle',
      turnId: null,
      stage: '',
      step: 0,
    });
  });
});
