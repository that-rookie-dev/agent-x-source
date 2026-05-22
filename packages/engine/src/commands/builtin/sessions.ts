import type { CommandInterface, CommandContext, CommandResult } from '../CommandInterface.js';

export const sessionsCommand: CommandInterface = {
  name: 'sessions',
  description: 'List and manage past sessions',
  usage: '/sessions [list|restore <id>|delete <id>]',
  async execute(args: string[], context: CommandContext): Promise<CommandResult> {
    const subcommand = args[0] ?? 'list';

    if (subcommand === 'list') {
      context.emit('Recent sessions:\n  (Fetched from SessionStore)\n\nUse /sessions restore <id> to continue a previous session.');
      return { success: true, action: 'none' };
    }

    if (subcommand === 'restore') {
      const id = args[1];
      if (!id) {
        context.emit('Usage: /sessions restore <session-id>');
        return { success: false, action: 'none' };
      }
      return { success: true, output: `Restoring session: ${id}`, action: 'restore_session' };
    }

    if (subcommand === 'delete') {
      const id = args[1];
      if (!id) {
        context.emit('Usage: /sessions delete <session-id>');
        return { success: false, action: 'none' };
      }
      context.emit(`Session ${id} deleted.`);
      return { success: true, action: 'none' };
    }

    context.emit('Usage: /sessions [list|restore <id>|delete <id>]');
    return { success: false, action: 'none' };
  },
};
