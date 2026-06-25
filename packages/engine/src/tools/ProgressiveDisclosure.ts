import type {
  ToolDefinition,
  ToolParameterSchema,
} from '@agentx/shared';

const CORE_TOOL_PATTERNS = [
  /^file_/, /^folder_/, /^shell_/, /^git_/, /^code_/, /^package_/,
  /^test_/, /^http_/, /^web_/, /^system_/, /^container_/, /^db_/,
  /^ask_clarification/, /^delegate_to/, /^todo/, /^search_crew_hub/,
];

const DISCLOSURE_THRESHOLD = 40;

export function getCoreTools(tools: ToolDefinition[]): ToolDefinition[] {
  return tools.filter((t) =>
    CORE_TOOL_PATTERNS.some((p) => p.test(t.id)),
  );
}

export function shouldDisclose(toolCount: number): boolean {
  return toolCount > DISCLOSURE_THRESHOLD;
}

export function createBridgeTools(): ToolDefinition[] {
  const stringParam = (desc: string) => ({
    type: 'string' as const,
    description: desc,
  });

  const objSchema = (props: Record<string, { type: string; description: string }>, req: string[]): ToolParameterSchema => ({
    type: 'object' as const,
    properties: Object.fromEntries(
      Object.entries(props).map(([k, v]) => [k, { type: v.type, description: v.description }]),
    ),
    required: req,
  });

  return [
    {
      id: 'tool_search',
      name: 'tool_search',
      description: 'Search for available tools by name or description keyword match',
      modelDescription:
        'Use this to discover what tools are available. Provide a search query and receive matching tool names and descriptions.',
      category: 'ai_meta' as const,
      riskLevel: 'low' as const,
      schema: objSchema(
        { query: stringParam('Search term to find tools (matches against name and description)') },
        ['query'],
      ),
      composable: false,
      source: 'builtin' as const,
    },
    {
      id: 'tool_describe',
      name: 'tool_describe',
      description: 'Get the full parameter schema for a specific tool',
      modelDescription:
        'Use this to see what parameters a tool accepts before calling it. Returns the complete JSON schema with all required and optional fields.',
      category: 'ai_meta' as const,
      riskLevel: 'low' as const,
      schema: objSchema(
        { tool: stringParam('Exact name of the tool to describe') },
        ['tool'],
      ),
      composable: false,
      source: 'builtin' as const,
    },
    {
      id: 'tool_call',
      name: 'tool_call',
      description: 'Execute a tool by name with the given arguments',
      modelDescription:
        'Use this to execute a previously discovered/disclosed tool. Provide the exact tool name and its arguments as a JSON object.',
      category: 'ai_meta' as const,
      riskLevel: 'medium' as const,
      schema: objSchema(
        {
          tool: stringParam('Exact name of the tool to execute'),
          arguments: { type: 'object', description: 'JSON object with the tool arguments (key-value pairs)' },
        },
        ['tool', 'arguments'],
      ),
      composable: false,
      source: 'builtin' as const,
    },
  ];
}

export function resolveBridgeToolCall(
  toolName: string,
  args: Record<string, unknown>,
  allTools: ToolDefinition[],
): { resolved: ToolDefinition | null; resolvedArgs: Record<string, unknown>; error?: string } {
  if (toolName === 'tool_search') {
    return {
      resolved: null,
      resolvedArgs: {},
    };
  }

  if (toolName === 'tool_describe') {
    const toolId = String(args['tool'] ?? '');
    const tool = allTools.find((t) => t.id === toolId || t.name === toolId);
    return {
      resolved: null,
      resolvedArgs: tool ? { schema: JSON.stringify(tool.schema) } : {},
      error: tool ? undefined : `Tool "${toolId}" not found`,
    };
  }

  if (toolName === 'tool_call') {
    const targetId = String(args['tool'] ?? '');
    const targetArgs = (args['arguments'] as Record<string, unknown>) ?? {};
    const tool = allTools.find((t) => t.id === targetId || t.name === targetId);
    return {
      resolved: tool ?? null,
      resolvedArgs: targetArgs,
      error: tool ? undefined : `Tool "${targetId}" not found. Use tool_search to find available tools.`,
    };
  }

  return { resolved: null, resolvedArgs: args, error: `Unknown bridge tool: ${toolName}` };
}
