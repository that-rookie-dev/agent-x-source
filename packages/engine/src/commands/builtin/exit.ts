import type { CommandInterface, CommandContext, CommandResult } from '../CommandInterface.js';

export const exitCommand: CommandInterface = {
  name: 'exit',
  description: 'Exit Agent-X',
  aliases: ['quit', 'q'],
  usage: '/exit',
  async execute(_args: string[], _context: CommandContext): Promise<CommandResult> {
    return { success: true, output: 'Entering cryo-sleep. See you, commander.', action: 'exit' };
  },
};
