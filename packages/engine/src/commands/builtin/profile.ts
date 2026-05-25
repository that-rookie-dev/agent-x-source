import type { CommandInterface, CommandContext, CommandResult } from '../CommandInterface.js';
import { ProfileManager } from '../../secret-sauce/ProfileManager.js';

export const profileCommand: CommandInterface = {
  name: 'profile',
  description: 'Switch or create profiles',
  usage: '/profile',
  async execute(args: string[], context: CommandContext): Promise<CommandResult> {
    const subcommand = args[0];
    const pm = new ProfileManager();

    if (subcommand === 'show') {
      const id = args[1] ?? pm.getActiveId();
      const profile = pm.get(id);
      if (!profile) {
        context.emit(`Profile "${id}" not found.`);
        return { success: false, action: 'none' };
      }
      const lines = [
        `Profile: ${profile.name} (${profile.id})`,
        `Prompt: ${profile.systemPrompt.slice(0, 120)}${profile.systemPrompt.length > 120 ? '...' : ''}`,
      ];
      context.emit(lines.join('\n'));
      return { success: true, action: 'none' };
    }

    // Default: open profile picker UI (handles list, switch, create)
    return { success: true, action: 'switch_profile' };
  },
};
