import { createDefaultToolkit, EnhancedToolExecutor } from '@agentx/engine';
import type { ToolRegistry, ToolExecutor } from '@agentx/engine';

export interface VSCodeToolkit {
  registry: ToolRegistry;
  executor: EnhancedToolExecutor;
  factoryExecutor: ToolExecutor;
}

export function createVSCodeToolkit(workspaceRoot: string): VSCodeToolkit {
  const toolkit = createDefaultToolkit(workspaceRoot);

  const executor = new EnhancedToolExecutor(toolkit.registry, workspaceRoot);

  const handlersMap = (toolkit.executor as unknown as Record<string, unknown>)['handlers'] as
    | Map<string, (..._args: unknown[]) => Promise<import('@agentx/shared').ToolResult>>
    | undefined;

  if (handlersMap) {
    for (const [name, handler] of handlersMap) {
      executor.registerHandler(name, handler);
    }
  }

  return {
    registry: toolkit.registry,
    executor,
    factoryExecutor: toolkit.executor,
  };
}
