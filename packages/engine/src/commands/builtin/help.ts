import type { CommandInterface, CommandContext, CommandResult } from '../CommandInterface.js';
import { VERSION, APP_NAME } from '@agentx/shared';

export const helpCommand: CommandInterface = {
  name: 'help',
  description: 'Show available commands',
  aliases: ['h', '?'],
  usage: '/help [command]',
  async execute(_args: string[], context: CommandContext): Promise<CommandResult> {
    const output = [
      `${APP_NAME} v${VERSION} - Commands:`,
      '',
      '  /help          Show this help',
      '  /exit          Exit the application',
      '  /clear         Clear message history',
      '  /version       Show version info',
      '  /model         Switch AI model',
      '  /provider      Switch AI provider',
      '  /profile       List/switch profiles',
      '  /session       Session management',
      '  /tools         List available tools',
      '  /permissions   View/revoke permissions',
      '  /config        View/edit configuration',
      '  /bg            Move current task to background',
      '  /tasks         List active/completed tasks',
      '',
      'Type / to see suggestions. Tab to autocomplete.',
    ].join('\n');

    context.emit(output);
    return { success: true, output, action: 'none' };
  },
};
