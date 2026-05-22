import type { CommandInterface, CommandContext, CommandResult } from '../CommandInterface.js';

export const modelCommand: CommandInterface = {
  name: 'model',
  description: 'Switch AI model',
  aliases: ['m'],
  usage: '/model [model-id]',
  async execute(args: string[], context: CommandContext): Promise<CommandResult> {
    if (args.length === 0) {
      context.emit(`Current model: ${context.modelId}\nUsage: /model <model-id>`);
      return { success: true, action: 'none' };
    }
    return { success: true, output: `Switching to model: ${args[0]}`, action: 'switch_model' };
  },
};
