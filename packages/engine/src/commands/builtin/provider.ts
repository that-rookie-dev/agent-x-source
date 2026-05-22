import type { CommandInterface, CommandContext, CommandResult } from '../CommandInterface.js';

export const providerCommand: CommandInterface = {
  name: 'provider',
  description: 'Switch AI provider',
  aliases: ['p'],
  usage: '/provider [provider-id]',
  async execute(args: string[], context: CommandContext): Promise<CommandResult> {
    if (args.length === 0) {
      context.emit(`Current provider: ${context.providerId}\nUsage: /provider <provider-id>`);
      return { success: true, action: 'none' };
    }
    return { success: true, output: `Switching to provider: ${args[0]}`, action: 'switch_provider' };
  },
};
