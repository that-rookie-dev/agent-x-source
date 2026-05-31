import type { CommandInterface, CommandContext, CommandResult } from '../CommandInterface.js';

export const researchCommand: CommandInterface = {
  name: 'research',
  description: 'Launch deep research mode — decomposes question, runs parallel sub-agents, and synthesizes a report',
  usage: '/research <question>',
  async execute(args: string[], _context: CommandContext): Promise<CommandResult> {
    const question = args.join(' ').trim();
    if (!question) {
      return { success: false, output: 'Usage: /research <question>' };
    }
    return { success: true, output: question, action: 'research' };
  },
};
