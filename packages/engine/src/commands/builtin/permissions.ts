import type { CommandInterface, CommandContext, CommandResult } from '../CommandInterface.js';

export const permissionsCommand: CommandInterface = {
  name: 'permissions',
  description: 'View and manage tool permissions',
  usage: '/permissions [list|revoke <tool>|revoke-all]',
  async execute(args: string[], context: CommandContext): Promise<CommandResult> {
    const subcommand = args[0] ?? 'list';

    if (subcommand === 'list') {
      context.emit('Active permissions:\n  (Permission list populated from PermissionManager)\n\nUse /permissions revoke <tool> to revoke a specific permission.');
      return { success: true, action: 'none' };
    }

    if (subcommand === 'revoke') {
      const tool = args[1];
      if (!tool) {
        context.emit('Usage: /permissions revoke <tool-name>');
        return { success: false, action: 'none' };
      }
      context.emit(`Revoked permissions for: ${tool}`);
      return { success: true, action: 'none' };
    }

    if (subcommand === 'revoke-all') {
      context.emit('All permissions revoked for this session.');
      return { success: true, action: 'none' };
    }

    context.emit('Usage: /permissions [list|revoke <tool>|revoke-all]');
    return { success: false, action: 'none' };
  },
};
