import type { CommandInterface, CommandContext, CommandResult } from '../CommandInterface.js';

export const rememberCommand: CommandInterface = {
  name: 'remember',
  description: 'Save a fact to long-term memory',
  aliases: ['mem'],
  usage: '/remember <fact to remember>',
  async execute(args: string[], _context: CommandContext): Promise<CommandResult> {
    if (args.length === 0) {
      return { success: false, output: 'Usage: /remember <fact to remember>\nExample: /remember My name is Alex' };
    }
    const fact = args.join(' ');
    return { success: true, output: fact, action: 'save_memory' };
  },
};
