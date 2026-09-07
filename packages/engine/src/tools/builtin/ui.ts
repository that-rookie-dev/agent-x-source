import type { ToolDefinition, ToolResult, ToolExecutionContext } from '@agentx/shared';
import { getUiApiInvoker, getUiRouteLister } from '../UiApiHost.js';

const uiApi: ToolDefinition = {
  id: 'ui_api',
  name: 'UI API',
  description: 'Perform any Agent-X web-app action by calling the corresponding API endpoint.',
  modelDescription:
    'Use this tool to list, create, update, toggle, or delete anything in the Agent-X UI. ' +
    'It maps directly to the web API routes the UI uses. ' +
    'Examples: GET /api/sessions, GET /api/crews, POST /api/crews, POST /api/provider/switch, ' +
    'POST /api/sessions/:id/checkpoint, POST /api/sessions/:id/compact, POST /api/chat/queue, ' +
    'DELETE /api/sessions/:id, PATCH /api/sessions/:id, POST /api/settings/permissions, etc.',
  category: 'internal',
  riskLevel: 'low',
  schema: {
    type: 'object',
    properties: {
      method: {
        type: 'string',
        enum: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
        description: 'HTTP method',
      },
      path: {
        type: 'string',
        description: 'API path starting with /api/ (e.g. /api/sessions)',
      },
      body: {
        type: 'object',
        description: 'JSON request body for POST/PUT/PATCH',
      },
    },
    required: ['method', 'path'],
  },
  examples: [
    'GET /api/sessions',
    'GET /api/crews',
    'POST /api/crews {"name":"Research Crew","title":"Researcher","expertise":["web_search"]}',
    'POST /api/provider/switch {"provider":"openai"}',
    'POST /api/chat/queue {"text":"Summarize the active session"}',
    'DELETE /api/sessions/abc123',
  ],
  composable: true,
  source: 'builtin',
  isInteractive: false,
};

const uiListRoutes: ToolDefinition = {
  id: 'ui_list_routes',
  name: 'UI List Routes',
  description: 'List the available Agent-X UI API endpoints the agent can call.',
  modelDescription:
    'Returns the available UI API routes (method + path) that can be used with the ui_api tool. ' +
    'Use this first when you are unsure which endpoint to call.',
  category: 'internal',
  riskLevel: 'low',
  schema: {
    type: 'object',
    properties: {},
    required: [],
  },
  examples: ['List routes before calling ui_api'],
  composable: true,
  source: 'builtin',
  isInteractive: false,
};

const uiState: ToolDefinition = {
  id: 'ui_state',
  name: 'UI State',
  description: 'Get a concise snapshot of the current Agent-X application state.',
  modelDescription:
    'Returns a summary of active session, configured provider/model, crews, running processes, ' +
    'pending subagents, automations, and storage readiness. Use this to understand the current ' +
    'state before taking an action.',
  category: 'internal',
  riskLevel: 'low',
  schema: {
    type: 'object',
    properties: {},
    required: [],
  },
  examples: ['Get current UI state'],
  composable: true,
  source: 'builtin',
  isInteractive: false,
};

export const INTERNAL_UI_TOOLS: ToolDefinition[] = [uiApi, uiListRoutes, uiState];

async function callUiApi(
  method: string,
  path: string,
  body: Record<string, unknown> | undefined,
): Promise<ToolResult> {
  const invoker = getUiApiInvoker();
  if (!invoker) {
    return { success: false, output: 'UI API invoker is not initialized', error: 'NOT_INITIALIZED' };
  }
  const normalizedMethod = method.toUpperCase() as 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  try {
    const resp = await invoker({ method: normalizedMethod, path, body });
    const output = JSON.stringify(resp.body);
    return {
      success: resp.status < 400,
      output,
      metadata: { status: resp.status },
      error: resp.status >= 400 ? `HTTP ${resp.status}` : undefined,
    };
  } catch (e: unknown) {
    return { success: false, output: e instanceof Error ? e.message : String(e), error: 'UI_API_ERROR' };
  }
}

export async function uiApiHandler(
  args: Record<string, unknown>,
  _context: ToolExecutionContext,
): Promise<ToolResult> {
  const method = typeof args.method === 'string' ? args.method : 'GET';
  const path = typeof args.path === 'string' ? args.path : '';
  const body =
    typeof args.body === 'object' && args.body !== null
      ? (args.body as Record<string, unknown>)
      : undefined;
  return callUiApi(method, path, body);
}

export async function uiListRoutesHandler(
  _args: Record<string, unknown>,
  _context: ToolExecutionContext,
): Promise<ToolResult> {
  const lister = getUiRouteLister();
  if (!lister) {
    return { success: false, output: 'UI route lister is not initialized', error: 'NOT_INITIALIZED' };
  }
  try {
    const routes = lister();
    return { success: true, output: JSON.stringify({ routes }) };
  } catch (e: unknown) {
    return { success: false, output: e instanceof Error ? e.message : String(e), error: 'UI_ROUTES_ERROR' };
  }
}

export async function uiStateHandler(
  _args: Record<string, unknown>,
  _context: ToolExecutionContext,
): Promise<ToolResult> {
  const invoker = getUiApiInvoker();
  if (!invoker) {
    return { success: false, output: 'UI API invoker is not initialized', error: 'NOT_INITIALIZED' };
  }
  try {
    const [setup, config, sessions, crews, providers] = await Promise.all([
      invoker({ method: 'GET', path: '/api/setup/status' }).catch(() => ({ status: 500, body: {} as Record<string, unknown> })),
      invoker({ method: 'GET', path: '/api/config' }).catch(() => ({ status: 500, body: {} as Record<string, unknown> })),
      invoker({ method: 'GET', path: '/api/sessions' }).catch(() => ({ status: 500, body: [] as unknown as Record<string, unknown> })),
      invoker({ method: 'GET', path: '/api/crews' }).catch(() => ({ status: 500, body: [] as unknown as Record<string, unknown> })),
      invoker({ method: 'GET', path: '/api/providers' }).catch(() => ({ status: 500, body: [] as unknown as Record<string, unknown> })),
    ]);
    const configBody = config.body as Record<string, unknown>;
    return {
      success: true,
      output: JSON.stringify({
        setup: setup.body,
        activeProvider: configBody?.['provider'] ?? null,
        sessions: sessions.body,
        crews: crews.body,
        providers: providers.body,
      }),
    };
  } catch (e: unknown) {
    return { success: false, output: e instanceof Error ? e.message : String(e), error: 'UI_STATE_ERROR' };
  }
}
