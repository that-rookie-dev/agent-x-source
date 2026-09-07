import { generateId, generatedToolId, GENERATED_TOOL_ID_PREFIX, type ToolCapability, type ToolDefinition, type ToolResult } from '@agentx/shared';
import type { ToolRegistry } from '../tools/ToolRegistry.js';
import type { ToolExecutor } from '../tools/ToolExecutor.js';
import type { CapabilitySandbox, CapabilityStore } from './interfaces.js';

export interface ToolkitBridge {
  registry: ToolRegistry;
  executor: ToolExecutor;
}

export class GeneratedToolRuntime {
  constructor(
    private store: CapabilityStore,
    private sandbox: CapabilitySandbox,
  ) {}

  toDefinition(cap: ToolCapability): ToolDefinition {
    const schema: ToolDefinition['schema'] = cap.inputSchema?.type === 'object'
      ? cap.inputSchema as unknown as ToolDefinition['schema']
      : { type: 'object', properties: {} };
    const risk = cap.sideEffects.some((s) => s.includes('network') || s.includes('write'))
      ? 'high' as const
      : cap.sideEffects.length
        ? 'medium' as const
        : 'low' as const;
    return {
      id: generatedToolId(cap.name),
      name: cap.name,
      description: cap.description,
      modelDescription: `${cap.description} (generated capability; not an Executable Skill package)`,
      category: 'data_processing',
      riskLevel: risk,
      schema,
      composable: false,
      source: 'generated',
    };
  }

  async sync(bridge: ToolkitBridge | null): Promise<void> {
    if (!bridge) return;
    bridge.registry.unregisterByPrefix(GENERATED_TOOL_ID_PREFIX);
    bridge.executor.unregisterHandlersByPrefix(GENERATED_TOOL_ID_PREFIX);
    const registered = await this.store.getCapabilities('registered', 'tool', 200, 0);
    const trial = await this.store.getCapabilities('in-trial', 'tool', 200, 0);
    for (const cap of [...registered, ...trial]) {
      if (cap.kind !== 'tool') continue;
      const def = this.toDefinition(cap);
      if (!bridge.registry.registerGeneratedTool(def)) continue;
      bridge.executor.registerHandler(def.id, async (args, context) => this.execute(cap, args, context.sessionId));
    }
  }

  async execute(cap: ToolCapability, args: Record<string, unknown>, sessionId?: string): Promise<ToolResult> {
    const result = await this.sandbox.runTool(cap.sourceCode, cap.language, args, cap.entryPoint);
    await this.store.recordUsage({
      id: generateId('use'),
      capabilityId: cap.id,
      sessionId,
      success: result.passed,
      createdAt: Date.now(),
      executionTimeMs: result.executionTimeMs,
    });
    if (cap.status === 'in-trial') {
      await this.store.updateCapability(cap.id, { trialCount: cap.trialCount + 1 });
    }
    if (!result.passed) {
      return {
        success: false,
        output: result.stderr || 'Generated tool failed in sandbox.',
        error: 'SI_SANDBOX_FAILED',
        metadata: { capabilityId: cap.id, exitCode: result.exitCode, trial: cap.status === 'in-trial' },
      };
    }
    return {
      success: true,
      output: result.stdout || 'Generated tool completed.',
      metadata: { capabilityId: cap.id, sideEffects: result.detectedSideEffects, trial: cap.status === 'in-trial' },
    };
  }
}
