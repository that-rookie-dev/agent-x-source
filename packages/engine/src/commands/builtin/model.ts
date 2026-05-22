import type { CommandInterface, CommandContext, CommandResult } from '../CommandInterface.js';

export const modelCommand: CommandInterface = {
  name: 'model',
  description: 'List and switch AI models',
  aliases: ['m'],
  usage: '/model [model-id]',
  async execute(args: string[], _context: CommandContext): Promise<CommandResult> {
    if (args.length === 0) {
      // No args: trigger interactive model picker
      return { success: true, action: 'list_models' };
    }
    // Direct model switch by ID
    return { success: true, output: args[0], action: 'switch_model' };
  },
};
