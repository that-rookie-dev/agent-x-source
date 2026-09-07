import { GENERATED_TOOL_ID_PREFIX, generatedToolId, type ToolCapability, type ToolDefinition } from '@agentx/shared';
import { GeneratedToolRuntime, type ToolkitBridge } from './GeneratedToolRuntime.js';
import type { CapabilityStore } from './interfaces.js';

export class ToolRegistrar {
  constructor(
    private runtime: GeneratedToolRuntime,
    private store: CapabilityStore,
    private getToolkit: () => ToolkitBridge | null,
  ) {}

  toDefinition(cap: ToolCapability): ToolDefinition {
    return this.runtime.toDefinition(cap);
  }

  async registerTool(capability: ToolCapability): Promise<void> {
    const toolkit = this.getToolkit();
    if (!toolkit) return;
    const def = this.runtime.toDefinition(capability);
    if (!toolkit.registry.registerGeneratedTool(def)) return;
    toolkit.executor.registerHandler(def.id, async (args, context) =>
      this.runtime.execute(capability, args, context.sessionId),
    );
  }

  async unregisterTool(capabilityId: string): Promise<void> {
    const toolkit = this.getToolkit();
    const cap = await this.store.getCapability(capabilityId);
    if (toolkit && cap?.kind === 'tool') {
      const id = generatedToolId(cap.name);
      toolkit.registry.unregister(id);
      toolkit.executor.unregisterHandler(id);
    }
    if (cap && cap.status !== 'archived') {
      await this.store.updateCapabilityStatus(capabilityId, 'disabled');
    }
  }

  async getRegisteredTools(): Promise<ToolCapability[]> {
    const registered = await this.store.getCapabilities('registered', 'tool', 200, 0);
    const trial = await this.store.getCapabilities('in-trial', 'tool', 200, 0);
    return [...registered, ...trial].filter((c): c is ToolCapability => c.kind === 'tool');
  }

  async sync(): Promise<void> {
    await this.runtime.sync(this.getToolkit());
  }

  prefix(): string {
    return GENERATED_TOOL_ID_PREFIX;
  }
}
