import type {
  ToolDefinition,
  ToolParameterSchema,
} from '@agentx/shared';

/** Always-visible tools when progressive disclosure is active (catalog > threshold). */
const CORE_TOOL_PATTERNS = [
  // Filesystem & search
  /^file_/, /^folder_/, /^glob$/, /^grep$/, /^read$/, /^cat$/, /^list_dir$/,
  /^search_files$/, /^create_dir$/, /^delete_file$/, /^write_file$/, /^read_file$/,
  // Shell & scripts
  /^shell_/, /^bash$/, /^execute$/, /^run_command$/, /^script_run$/,
  /^python_rpc$/, /^node_rpc$/,
  // VCS & GitHub
  /^git_/, /^gh_/, /^apply_patch$/,
  // Code intelligence
  /^code_/,
  // Build / test / packages
  /^build/, /^test_/, /^package_/, /^pkg_/, /^project_detect$/,
  // Network / browser / remote
  /^http_/, /^web_/, /^deep_web/, /^browser_/, /^ssh_/,
  // System / containers / data
  /^system_/, /^container_/, /^docker_/, /^db_/,
  // Memory / RAG
  /^memory_/, /^rag_/,
  // Scheduling & automation — first-class capability; the system prompt tells the
  // model to call automation_register directly, so it must never be hidden behind
  // progressive disclosure. Hiding it caused scheduling requests to be refused.
  /^automation_/, /^schedule_/,
  // Notifications (used by scheduled jobs and direct pings)
  /^notify_/, /^notification_/,
  // Fleet / cross-session awareness (messaging channel super-sessions)
  /^agent_x_overview$/,
  // Agent meta / charts / todos
  /^ask_clarification/, /^delegate_to/, /^sub_agent/, /^todo/,
  /^search_crew_hub/, /^render_chart$/, /^spawn_crew/, /^save_to_markdown$/, /^markdown_list$/,
  // Native channel send (Telegram/Slack/Discord/Email) — must be available on messaging sessions
  /^(telegram|slack|discord|email)_send_/,
  // Document creation tools — needed to build files (PDFs, spreadsheets, etc.) to send back to users
  /^(pdf|docx|xlsx|pptx|csv)_create$/, /^doc_(markdown|html|json|yaml|diagram|latex)$/,
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
    const query = String(args['query'] ?? '').trim().toLowerCase();
    if (!query) {
      return {
        resolved: null,
        resolvedArgs: {
          matches: [],
          count: 0,
          hint: 'query is required — pass a keyword (e.g. "web_search", "automation", "schedule", "fetch").',
        },
        error: 'query is required — provide a search keyword in the "query" field.',
      };
    }
    const matches = allTools
      .filter((t) => {
        const hay = `${t.id} ${t.name} ${t.description} ${t.modelDescription}`.toLowerCase();
        return hay.includes(query) || query.split(/\s+/).every((w) => hay.includes(w));
      })
      .slice(0, 25)
      .map((t) => ({
        id: t.id,
        description: t.modelDescription || t.description,
        category: t.category,
        riskLevel: t.riskLevel,
      }));
    return {
      resolved: null,
      resolvedArgs: {
        matches,
        count: matches.length,
        hint: matches.length === 0
          ? 'No tools matched. Try a broader keyword (e.g. git, docker, browser).'
          : 'Use tool_describe for full schema, then tool_call to execute.',
      },
    };
  }

  if (toolName === 'tool_describe') {
    const toolId = String(args['tool'] ?? '');
    const tool = allTools.find((t) => t.id === toolId || t.name === toolId);
    return {
      resolved: null,
      resolvedArgs: tool
        ? {
            id: tool.id,
            description: tool.modelDescription || tool.description,
            schema: tool.schema,
            riskLevel: tool.riskLevel,
            category: tool.category,
          }
        : {},
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
