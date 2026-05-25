import type { ToolResult, ToolExecutionContext } from '@agentx/shared';
import type { SubAgentManager } from '../../agent/SubAgentManager.js';

let subAgentManagerInstance: SubAgentManager | null = null;

export function setSubAgentManagerInstance(manager: SubAgentManager): void {
  subAgentManagerInstance = manager;
}

export function getSubAgentManagerInstance(): SubAgentManager | null {
  return subAgentManagerInstance;
}

/**
 * Spawn a sub-agent to handle a delegated task in the background.
 * The sub-agent runs an independent LLM completion with its own context.
 */
export async function subAgentSpawn(
  args: Record<string, unknown>,
  _context: ToolExecutionContext,
): Promise<ToolResult> {
  const instruction = args['instruction'] as string;
  const toolsRaw = args['tools'] as string | string[] | undefined;
  const tools = Array.isArray(toolsRaw)
    ? toolsRaw
    : typeof toolsRaw === 'string'
      ? toolsRaw.split(',').map((t) => t.trim()).filter(Boolean)
      : [];
  const timeout = (args['timeout'] as number | undefined) ?? 60_000;

  if (!instruction) {
    return { success: false, output: 'Instruction is required', error: 'MISSING_PARAMS' };
  }

  const manager = subAgentManagerInstance;
  if (!manager) {
    return { success: false, output: 'Sub-agent manager not available', error: 'NOT_CONFIGURED' };
  }

  const task = manager.spawn(instruction, tools, timeout);
  return {
    success: true,
    output: `Sub-agent spawned (ID: ${task.id}). It will process the task in the background: "${instruction.slice(0, 100)}"`,
    metadata: { agentId: task.id },
  };
}

/**
 * Check the status of a running sub-agent.
 */
export async function subAgentStatus(
  args: Record<string, unknown>,
  _context: ToolExecutionContext,
): Promise<ToolResult> {
  const manager = subAgentManagerInstance;
  if (!manager) {
    return { success: false, output: 'Sub-agent manager not available', error: 'NOT_CONFIGURED' };
  }

  const agentId = args['agent_id'] as string | undefined;

  if (agentId) {
    const running = manager.getRunning();
    const task = running.find((t) => t.id === agentId);
    if (task) {
      return {
        success: true,
        output: `Agent ${task.id}: status=${task.status}, runs since ${new Date(task.startTime ?? 0).toLocaleTimeString()}`,
      };
    }
    return { success: false, output: `No running agent with ID: ${agentId}`, error: 'NOT_FOUND' };
  }

  // List all running sub-agents
  const running = manager.getRunning();
  if (running.length === 0) {
    return { success: true, output: 'No sub-agents currently running.' };
  }

  const lines = running.map((t) => `• ${t.id} | "${t.instruction.slice(0, 60)}" | ${t.status}`);
  return { success: true, output: `Running sub-agents:\n${lines.join('\n')}` };
}

/**
 * Cancel a running sub-agent.
 */
export async function subAgentCancel(
  args: Record<string, unknown>,
  _context: ToolExecutionContext,
): Promise<ToolResult> {
  const agentId = args['agent_id'] as string;

  if (!agentId) {
    return { success: false, output: 'agent_id is required', error: 'MISSING_PARAMS' };
  }

  const manager = subAgentManagerInstance;
  if (!manager) {
    return { success: false, output: 'Sub-agent manager not available', error: 'NOT_CONFIGURED' };
  }

  manager.cancel(agentId);
  return { success: true, output: `Sub-agent ${agentId} cancelled.` };
}
