import type { CommandInterface, CommandContext, CommandResult } from '../CommandInterface.js';
import { ProfileManager } from '../../secret-sauce/ProfileManager.js';

export const profileCommand: CommandInterface = {
  name: 'profile',
  description: 'List or switch profiles',
  usage: '/profile [list|switch <name>]',
  async execute(args: string[], context: CommandContext): Promise<CommandResult> {
    const subcommand = args[0] ?? 'list';
    const pm = new ProfileManager();

    if (subcommand === 'list') {
      const profiles = pm.list();
      const activeId = pm.getActiveId();
      const lines = profiles.map(
        (p) => `  ${p.id === activeId ? '●' : '○'} ${p.name} (${p.id}) — ${p.description}`,
      );
      context.emit(`Profiles:\n${lines.join('\n')}`);
      return { success: true, action: 'none' };
    }

    if (subcommand === 'switch') {
      const id = args[1];
      if (!id) {
        context.emit('Usage: /profile switch <id>');
        return { success: false, action: 'none' };
      }
      const result = pm.switch(id);
      if (!result) {
        context.emit(`Profile "${id}" not found. Use /profile list to see available profiles.`);
        return { success: false, action: 'none' };
      }
      context.emit(`Switched to profile: ${result.name}`);
      return { success: true, output: `Active profile: ${result.name}`, action: 'switch_profile' };
    }

    context.emit('Usage: /profile [list|switch <id>]');
    return { success: false, action: 'none' };
  },
};
