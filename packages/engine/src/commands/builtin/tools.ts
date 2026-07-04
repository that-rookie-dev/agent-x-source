import type { CommandInterface, CommandContext, CommandResult } from '../CommandInterface.js';
import { ToolRegistry } from '../../tools/ToolRegistry.js';
import type { ToolDefinition } from '@agentx/shared';

// Injected by the Agent on startup
let toolRegistry: ToolRegistry | null = null;
let historyProvider: (() => Array<{ toolId: string; result: { success: boolean }; timestamp: number; elapsed: number }>) | null = null;

export function setToolRegistryInstance(registry: ToolRegistry | null): void {
  toolRegistry = registry;
}

export function getToolRegistryInstance(): ToolRegistry | null {
  return toolRegistry;
}

export function setToolHistoryProvider(provider: typeof historyProvider): void {
  historyProvider = provider;
}

const CATEGORY_LABELS: Record<string, string> = {
  filesystem: 'Filesystem',
  shell_process: 'Shell & Process',
  code_intelligence: 'Code Intelligence',
  git_vcs: 'Git & VCS',
  documents: 'Documents',
  scheduler: 'Scheduler',
  agent_orchestration: 'Agent Orchestration',
  browser_automation: 'Browser Automation',
  containers_infra: 'Containers & Infrastructure',
  data_processing: 'Data Processing',
  database: 'Database',
  communication: 'Communication',
  packages: 'Packages',
  system: 'System',
  testing: 'Testing',
  web_network: 'Web & Network',
  image_generation: 'Image Generation',
  project: 'Project',
  ai_specialized: 'AI Specialized',
  notifications: 'Notifications',
  security: 'Security',
  media: 'Media',
  integrations: 'Integrations',
  other: 'Other',
};

export const toolsCommand: CommandInterface = {
  name: 'tools',
  description: 'Browse, search, and manage available tools',
  usage: '/tools [list|search <query>|info <name>|enable <name>|disable <name>|group <category>|fav <name>|unfav <name>|favorites|history|compare <name1> <name2>]',
  hidden: true,
  async execute(args: string[], context: CommandContext): Promise<CommandResult> {
    const subcommand = args[0] ?? 'list';

    if (!toolRegistry) {
      context.emit('Tool registry not available.');
      return { success: false, action: 'none' };
    }

    if (subcommand === 'list') {
      const all = toolRegistry.list();
      const favorites = toolRegistry.listFavorites();
      const favIds = new Set(favorites.map((t) => t.id));
      const grouped = new Map<string, ToolDefinition[]>();
      for (const tool of all) {
        const cat = tool.category ?? 'other';
        if (!grouped.has(cat)) grouped.set(cat, []);
        grouped.get(cat)!.push(tool);
      }

      const lines: string[] = ['Available tools by category:'];
      for (const [cat, tools] of grouped) {
        const label = CATEGORY_LABELS[cat] ?? cat;
        lines.push(`\n  ═══ ${label} (${tools.length}) ═══`);
        for (const t of tools) {
          const risk = t.riskLevel === 'critical' ? '⚠' : t.riskLevel === 'high' ? '↑' : '·';
          const fav = favIds.has(t.id) ? '★' : ' ';
          lines.push(`  ${risk} ${fav} ${t.id}`);
        }
      }
      lines.push('\nUse /tools info <name> for details, /tools search <query> to search, /tools fav <name> to favorite.');
      context.emit(lines.join('\n'));
      return { success: true, action: 'none' };
    }

    if (subcommand === 'search') {
      const query = args.slice(1).join(' ').toLowerCase();
      if (!query) {
        context.emit('Usage: /tools search <query>');
        return { success: false, action: 'none' };
      }

      const matches = toolRegistry.list().filter((t) =>
        t.id.toLowerCase().includes(query) ||
        t.name.toLowerCase().includes(query) ||
        t.description.toLowerCase().includes(query) ||
        t.modelDescription.toLowerCase().includes(query)
      );

      if (matches.length === 0) {
        context.emit(`No tools matching "${query}".`);
        return { success: true, action: 'none' };
      }

      const lines = [`Tools matching "${query}" (${matches.length}):`];
      for (const t of matches) {
        const risk = t.riskLevel === 'critical' ? '⚠' : t.riskLevel === 'high' ? '↑' : '·';
        const cat = CATEGORY_LABELS[t.category ?? 'other'] ?? t.category;
        lines.push(`  ${risk} ${t.id} — ${t.name} [${cat}]`);
        lines.push(`    ${t.description.slice(0, 120)}`);
      }
      context.emit(lines.join('\n'));
      return { success: true, action: 'none' };
    }

    if (subcommand === 'info') {
      const name = args[1];
      if (!name) {
        context.emit('Usage: /tools info <name>');
        return { success: false, action: 'none' };
      }

      const tool = toolRegistry.list().find((t) => t.id === name || t.name.toLowerCase() === name.toLowerCase());
      if (!tool) {
        context.emit(`Tool not found: "${name}". Use /tools list to see all tools.`);
        return { success: false, action: 'none' };
      }

      const cat = CATEGORY_LABELS[tool.category ?? 'other'] ?? tool.category;
      const req = tool.schema.required?.join(', ') ?? 'none';
      const props = tool.schema.properties
        ? Object.entries(tool.schema.properties as Record<string, { type: string; description?: string }>)
            .map(([k, v]) => `    ${k} (${v.type})${tool.schema.required?.includes(k) ? ' *required*' : ''}${v.description ? ` — ${v.description}` : ''}`)
            .join('\n')
        : '    none';

      const fav = toolRegistry.isFavorite(tool.id) ? '★ Favorited' : '☆ Not favorited';
      const lines = [
        `Tool: ${tool.id} (${tool.name})`,
        `  Category: ${cat}`,
        `  Risk level: ${tool.riskLevel}`,
        `  Source: ${tool.source ?? 'builtin'}`,
        `  Favorite: ${fav}`,
        `  Description: ${tool.description}`,
        `  Model description: ${tool.modelDescription}`,
        `  Required params: ${req}`,
        `  Parameters:`,
        props,
      ];
      context.emit(lines.join('\n'));
      return { success: true, action: 'none' };
    }

    if (subcommand === 'enable' || subcommand === 'disable') {
      const name = args[1];
      if (!name) {
        context.emit(`Usage: /tools ${subcommand} <name>`);
        return { success: false, action: 'none' };
      }
      const tool = toolRegistry.list().find((t) => t.id === name || t.name.toLowerCase() === name.toLowerCase());
      if (!tool) {
        context.emit(`Tool not found: "${name}".`);
        return { success: false, action: 'none' };
      }
      context.emit(`${subcommand === 'enable' ? '✓ Enabled' : '✗ Disabled'} tool: ${tool.id}`);
      return { success: true, action: 'none' };
    }

    if (subcommand === 'compare') {
      const name1 = args[1];
      const name2 = args[2];
      if (!name1 || !name2) {
        context.emit('Usage: /tools compare <name1> <name2>');
        return { success: false, action: 'none' };
      }
      const t1 = toolRegistry.list().find((t) => t.id === name1 || t.name.toLowerCase() === name1.toLowerCase());
      const t2 = toolRegistry.list().find((t) => t.id === name2 || t.name.toLowerCase() === name2.toLowerCase());
      if (!t1 || !t2) {
        context.emit(`Tool not found: "${!t1 ? name1 : name2}".`);
        return { success: false, action: 'none' };
      }

      const cat1 = CATEGORY_LABELS[t1.category ?? 'other'] ?? t1.category;
      const cat2 = CATEGORY_LABELS[t2.category ?? 'other'] ?? t2.category;
      const req1 = t1.schema.required?.join(', ') ?? 'none';
      const req2 = t2.schema.required?.join(', ') ?? 'none';

      const lines = [
        'Tool Comparison:',
        '',
        `  ${'─'.repeat(30)}┬${'─'.repeat(30)}`,
        `  ${padEnd(t1.id, 28)} │ ${padEnd(t2.id, 28)}`,
        `  ${'─'.repeat(30)}┼${'─'.repeat(30)}`,
        `  ${padEnd(cat1, 28)} │ ${padEnd(cat2, 28)}`,
        `  Risk: ${padEnd(t1.riskLevel, 23)} │ Risk: ${padEnd(t2.riskLevel, 23)}`,
        `  ${padEnd(t1.source ?? 'builtin', 28)} │ ${padEnd(t2.source ?? 'builtin', 28)}`,
        `  ${'─'.repeat(30)}┴${'─'.repeat(30)}`,
        '',
        `  ${t1.name}: ${t1.description}`,
        `  ${t2.name}: ${t2.description}`,
        '',
        `  ${t1.id} params: ${req1}`,
        `  ${t2.id} params: ${req2}`,
      ];
      context.emit(lines.join('\n'));
      return { success: true, action: 'none' };
    }

    function padEnd(s: string, n: number): string {
      return s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length);
    }

    if (subcommand === 'fav') {
      const name = args[1];
      if (!name) {
        context.emit('Usage: /tools fav <name>');
        return { success: false, action: 'none' };
      }
      const tool = toolRegistry.list().find((t) => t.id === name || t.name.toLowerCase() === name.toLowerCase());
      if (!tool) {
        context.emit(`Tool not found: "${name}".`);
        return { success: false, action: 'none' };
      }
      toolRegistry.addFavorite(tool.id);
      context.emit(`★ Favorited tool: ${tool.id}`);
      return { success: true, action: 'none' };
    }

    if (subcommand === 'unfav') {
      const name = args[1];
      if (!name) {
        context.emit('Usage: /tools unfav <name>');
        return { success: false, action: 'none' };
      }
      const tool = toolRegistry.list().find((t) => t.id === name || t.name.toLowerCase() === name.toLowerCase());
      if (!tool) {
        context.emit(`Tool not found: "${name}".`);
        return { success: false, action: 'none' };
      }
      toolRegistry.removeFavorite(tool.id);
      context.emit(`☆ Unfavorited tool: ${tool.id}`);
      return { success: true, action: 'none' };
    }

    if (subcommand === 'favorites') {
      const favs = toolRegistry.listFavorites();
      if (favs.length === 0) {
        context.emit('No favorited tools. Use /tools fav <name> to add one.');
        return { success: true, action: 'none' };
      }
      const lines = favs.map((t) => {
        const cat = CATEGORY_LABELS[t.category ?? 'other'] ?? t.category;
        return `  ★ ${t.id} — ${t.name} [${cat}]`;
      });
      context.emit(`Favorited tools (${favs.length}):\n${lines.join('\n')}`);
      return { success: true, action: 'none' };
    }

    if (subcommand === 'history') {
      if (!historyProvider) {
        context.emit('Tool history not available.');
        return { success: false, action: 'none' };
      }
      const history = historyProvider();
      if (history.length === 0) {
        context.emit('No tool executions recorded yet.');
        return { success: true, action: 'none' };
      }
      const limit = Math.min(parseInt(args[1] ?? '20', 10), history.length);
      const recent = history.slice(-limit);
      const lines = [`Recent tool executions (last ${limit} of ${history.length}):`];
      for (const entry of recent) {
        const date = new Date(entry.timestamp).toLocaleTimeString();
        const status = entry.result.success ? '✓' : '✗';
        lines.push(`  ${status} [${date}] ${entry.toolId} (${entry.elapsed}ms)`);
      }
      context.emit(lines.join('\n'));
      return { success: true, action: 'none' };
    }

    if (subcommand === 'group') {
      const category = args[1]?.toLowerCase();
      if (!category) {
        const cats = [...new Set(toolRegistry.list().map((t) => t.category ?? 'other'))];
        context.emit(`Categories:\n  ${cats.map((c) => CATEGORY_LABELS[c] ?? c).join('\n  ')}`);
        return { success: true, action: 'none' };
      }

      const tools = toolRegistry.list().filter((t) => (t.category ?? 'other') === category);
      if (tools.length === 0) {
        context.emit(`No tools in category "${category}".`);
        return { success: false, action: 'none' };
      }

      const cat = CATEGORY_LABELS[category] ?? category;
      const lines = [`Tools in "${cat}":`];
      for (const t of tools) {
        const risk = t.riskLevel === 'critical' ? '⚠' : t.riskLevel === 'high' ? '↑' : '·';
        lines.push(`  ${risk} ${t.id} — ${t.name}`);
      }
      context.emit(lines.join('\n'));
      return { success: true, action: 'none' };
    }

    context.emit('Usage: /tools [list|search <query>|info <name>|enable <name>|disable <name>|group <category>|fav <name>|unfav <name>|favorites|history|compare <name1> <name2>]');
    return { success: false, action: 'none' };
  },
};
