import type { CommandInterface, CommandContext, CommandResult } from '../CommandInterface.js';

export const providerCommand: CommandInterface = {
  name: 'provider',
  description: 'Switch or reset AI provider',
  aliases: ['p'],
  usage: '/provider [provider-id | reset]',
  async execute(args: string[], _context: CommandContext): Promise<CommandResult> {
    if (args.length === 0) {
      return { success: true, action: 'list_providers' };
    }
    if (args[0] === 'reset') {
      return { success: true, action: 'reset_provider' };
    }
    return { success: true, output: args[0], action: 'switch_provider' };
  },
};
