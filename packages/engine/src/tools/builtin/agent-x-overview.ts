import type { ToolResult, ToolExecutionContext } from '@agentx/shared';
import { isSuperSessionId } from '@agentx/shared';
import {
  getAgentXOverviewBridge,
  type AgentXOverviewView,
} from '../../agent/agent-x-overview-bridge.js';

const VIEWS = new Set<AgentXOverviewView>([
  'summary',
  'sessions',
  'automations',
  'notifications',
  'settings',
  'session_detail',
]);

export async function agentXOverview(
  args: Record<string, unknown>,
  context: ToolExecutionContext,
): Promise<ToolResult> {
  const bridge = getAgentXOverviewBridge();
  if (!bridge) {
    return { success: false, output: 'Agent-X overview is not available', error: 'NO_BRIDGE' };
  }

  const rawView = (args['view'] as string | undefined)?.trim().toLowerCase() ?? 'summary';
  const view = (VIEWS.has(rawView as AgentXOverviewView) ? rawView : 'summary') as AgentXOverviewView;
  const sessionId = (args['session_id'] as string | undefined)?.trim();

  if (view === 'session_detail' && !sessionId) {
    return {
      success: false,
      output: 'session_id is required when view is session_detail',
      error: 'INVALID_ARGS',
    };
  }

  if (!isSuperSessionId(context.sessionId) && view !== 'session_detail') {
    return {
      success: false,
      output: 'agent_x_overview is only available from messaging channel sessions',
      error: 'NOT_CHANNEL',
    };
  }

  try {
    const output = await bridge.getOverview(view, sessionId);
    return { success: true, output: output || '(no data)' };
  } catch (e) {
    return {
      success: false,
      output: e instanceof Error ? e.message : String(e),
      error: 'OVERVIEW_FAILED',
    };
  }
}
