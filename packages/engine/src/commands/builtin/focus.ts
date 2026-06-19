import type { CommandInterface, CommandContext, CommandResult } from '../CommandInterface.js';

export const focusCommand: CommandInterface = {
  name: 'focus',
  description: 'Show or set the active channel focus (web, telegram)',
  aliases: ['channel'],
  usage: '/focus [web|telegram]',
  async execute(args: string[], _context: CommandContext): Promise<CommandResult> {
    const target = args[0]?.toLowerCase();

    if (!target) {
      return { success: true, action: 'focus', output: '' };
    }

    const validChannels = ['web', 'telegram'];
    if (!validChannels.includes(target)) {
      return {
        success: false,
        output: `Invalid channel "${target}". Valid options: ${validChannels.join(', ')}`,
      };
    }

    return { success: true, output: target, action: 'focus' };
  },
};
