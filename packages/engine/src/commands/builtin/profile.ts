import type { CommandInterface, CommandContext, CommandResult } from '../CommandInterface.js';
import { ProfileManager } from '../../secret-sauce/ProfileManager.js';

export const profileCommand: CommandInterface = {
  name: 'profile',
  description: 'Manage agent profiles',
  usage: '/profile [list|switch <id>|show <id>|create <name>|delete <id>]',
  async execute(args: string[], context: CommandContext): Promise<CommandResult> {
    const subcommand = args[0] ?? 'list';
    const pm = new ProfileManager();

    if (subcommand === 'list') {
      const profiles = pm.list();
      const activeId = pm.getActiveId();
      const lines = profiles.map(
        (p) => `  ${p.id === activeId ? '●' : '○'} ${p.name} (${p.id})`,
      );
      context.emit(`Profiles:\n${lines.join('\n')}\n\nUse /profile switch <id> to change`);
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
      context.emit(`Switched to profile: ${result.name}\nRestarting session...`);
      return { success: true, output: result.id, action: 'switch_profile' };
    }

    if (subcommand === 'show') {
      const id = args[1] ?? pm.getActiveId();
      const profile = pm.get(id);
      if (!profile) {
        context.emit(`Profile "${id}" not found.`);
        return { success: false, action: 'none' };
      }
      const lines = [
        `Profile: ${profile.name} (${profile.id})`,
        `Description: ${profile.description}`,
        `Expertise: ${profile.expertise.join(', ') || 'none'}`,
        `Traits: ${profile.traits.join(', ') || 'none'}`,
        `Prompt: ${profile.systemPrompt.slice(0, 120)}${profile.systemPrompt.length > 120 ? '...' : ''}`,
      ];
      context.emit(lines.join('\n'));
      return { success: true, action: 'none' };
    }

    if (subcommand === 'create') {
      const name = args.slice(1).join(' ');
      if (!name) {
        context.emit('Usage: /profile create <name>\nExample: /profile create DevOps Engineer');
        return { success: false, action: 'none' };
      }
      const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      if (pm.get(id)) {
        context.emit(`Profile "${id}" already exists.`);
        return { success: false, action: 'none' };
      }
      pm.create({
        id,
        name,
        description: `Custom profile: ${name}`,
        systemPrompt: `You are a ${name}. Apply your expertise and professional judgment in all interactions.`,
        expertise: [],
        traits: [],
        toolPreferences: null,
        enabledTools: null,
        disabledTools: null,
        isDefault: false,
      });
      context.emit(`Created profile: ${name} (${id})\nUse /profile switch ${id} to activate.`);
      return { success: true, action: 'none' };
    }

    if (subcommand === 'delete') {
      const id = args[1];
      if (!id) {
        context.emit('Usage: /profile delete <id>');
        return { success: false, action: 'none' };
      }
      if (id === pm.getActiveId()) {
        context.emit('Cannot delete the active profile. Switch to another first.');
        return { success: false, action: 'none' };
      }
      const success = pm.delete(id);
      if (!success) {
        context.emit(`Profile "${id}" not found.`);
        return { success: false, action: 'none' };
      }
      context.emit(`Deleted profile: ${id}`);
      return { success: true, action: 'none' };
    }

    context.emit('Usage: /profile [list|switch <id>|show <id>|create <name>|delete <id>]');
    return { success: false, action: 'none' };
  },
};
