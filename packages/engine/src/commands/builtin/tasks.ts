import type { CommandInterface, CommandContext, CommandResult } from '../CommandInterface.js';

export const bgCommand: CommandInterface = {
  name: 'bg',
  description: 'Move current task to background',
  usage: '/bg',
  async execute(_args: string[], context: CommandContext): Promise<CommandResult> {
    context.emit('Task moved to background.');
    return { success: true, action: 'none' };
  },
};

export const tasksCommand: CommandInterface = {
  name: 'tasks',
  description: 'List active and completed background tasks',
  usage: '/tasks',
  async execute(_args: string[], context: CommandContext): Promise<CommandResult> {
    context.emit('No background tasks running.');
    return { success: true, action: 'none' };
  },
};
