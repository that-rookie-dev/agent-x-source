import type { CommandInterface, CommandContext, CommandResult } from '../CommandInterface.js';

export const clearCommand: CommandInterface = {
  name: 'clear',
  description: 'Clear message history',
  aliases: ['cls'],
  usage: '/clear',
  async execute(_args: string[], context: CommandContext): Promise<CommandResult> {
    context.emit('History cleared.');
    return { success: true, output: 'History cleared.', action: 'clear' };
  },
};
