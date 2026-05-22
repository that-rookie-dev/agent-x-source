import type { CommandInterface, CommandContext, CommandResult } from '../CommandInterface.js';

export const toolsCommand: CommandInterface = {
  name: 'tools',
  description: 'List available tools and their status',
  usage: '/tools [list|search <query>|info <name>]',
  async execute(args: string[], context: CommandContext): Promise<CommandResult> {
    const subcommand = args[0] ?? 'list';

    if (subcommand === 'list') {
      context.emit('Available tool categories:\n  ● filesystem — File read/write/delete/list\n  ● shell_process — Shell command execution\n  ● code_intelligence — Code analysis & manipulation\n  ● git_vcs — Git version control\n  ● web_network — HTTP requests & web scraping\n  ● data_processing — Data transformation\n\nUse /tools info <name> for details on a specific tool.');
      return { success: true, action: 'none' };
    }

    if (subcommand === 'search') {
      const query = args.slice(1).join(' ');
      if (!query) {
        context.emit('Usage: /tools search <query>');
        return { success: false, action: 'none' };
      }
      context.emit(`Searching tools for: "${query}" — use the tool registry for programmatic access.`);
      return { success: true, action: 'none' };
    }

    if (subcommand === 'info') {
      const name = args[1];
      if (!name) {
        context.emit('Usage: /tools info <name>');
        return { success: false, action: 'none' };
      }
      context.emit(`Tool: ${name}\nUse the tool registry to get detailed information.`);
      return { success: true, action: 'none' };
    }

    context.emit('Usage: /tools [list|search <query>|info <name>]');
    return { success: false, action: 'none' };
  },
};
