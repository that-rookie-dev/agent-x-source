import type { CommandInterface, CommandContext, CommandResult } from '../CommandInterface.js';
import { CrewManager } from '../../crew/CrewManager.js';

export const crewCommand: CommandInterface = {
  name: 'crew',
  description: 'Manage crews: list, enable, disable, show, create',
  usage: '/crew [list|enable <id>|disable <id>|show <id>]',
  async execute(args: string[], context: CommandContext): Promise<CommandResult> {
    const subcommand = args[0];
    const pm = new CrewManager();

    if (subcommand === 'list') {
      const crews = pm.list();
      if (crews.length === 0) {
        context.emit('No crews configured. Use /crew create to add one.');
        return { success: true, action: 'none' };
      }
      const lines = crews.map((c) => {
        const status = c.enabled ? '✓' : '✗';
        const expertise = c.expertise?.join(', ') || 'general';
        return `${status} **${c.name}** (@${c.callsign})\n   Expertise: ${expertise}`;
      });
      context.emit(`**Available Crews:**\n${lines.join('\n\n')}`);
      return { success: true, action: 'none' };
    }

    if (subcommand === 'enable') {
      const id = args[1];
      if (!id) {
        context.emit('Usage: /crew enable <crew_id>');
        return { success: false, action: 'none' };
      }
      const success = pm.enable(id);
      context.emit(success ? `✓ Crew "${id}" enabled.` : `✗ Failed to enable crew "${id}".`);
      return { success, action: 'none' };
    }

    if (subcommand === 'disable') {
      const id = args[1];
      if (!id) {
        context.emit('Usage: /crew disable <crew_id>');
        return { success: false, action: 'none' };
      }
      const success = pm.disable(id);
      context.emit(success ? `✓ Crew "${id}" disabled.` : `✗ Failed to disable crew "${id}".`);
      return { success, action: 'none' };
    }

    if (subcommand === 'show') {
      const id = args[1];
      if (!id) {
        context.emit('Usage: /crew show <crew_id>');
        return { success: false, action: 'none' };
      }
      const crew = pm.get(id);
      if (!crew) {
        context.emit(`Crew "${id}" not found.`);
        return { success: false, action: 'none' };
      }
      const lines = [
        `**Crew: ${crew.name}** (${crew.id})`,
        `Status: ${crew.enabled ? 'Enabled' : 'Disabled'}`,
        `Expertise: ${crew.expertise?.join(', ') || 'general'}`,
        `Traits: ${crew.traits?.join(', ') || 'none'}`,
        `Prompt: ${crew.systemPrompt.slice(0, 200)}${crew.systemPrompt.length > 200 ? '...' : ''}`,
      ];
      context.emit(lines.join('\n'));
      return { success: true, action: 'none' };
    }

    if (subcommand === 'create') {
      const id = args[1];
      const name = args[2];
      const callsign = args[3];
      if (!id || !name) {
        context.emit('Usage: /crew create <id> <name> [callsign]');
        return { success: false, action: 'none' };
      }
      const systemPrompt = args.slice(4).join(' ') || `You are ${name}, a capable AI assistant.`;
      pm.create({ id, name, callsign: callsign || id, systemPrompt });
      context.emit(`✓ Crew "${name}" (@${callsign || id}) created.`);
      return { success: true, action: 'none' };
    }

    // Default: list crews
    const crews = pm.list();
    if (crews.length === 0) {
      context.emit('No crews configured. Use /crew create to add one.');
    } else {
      const lines = crews.map((c) => {
        const status = c.enabled ? '✓' : '✗';
        return `${status} **${c.name}** (@${c.callsign})`;
      });
      context.emit(`**Available Crews:**\n${lines.join('\n')}\n\nUse /crew [list|enable|disable|show|create]`);
    }
    return { success: true, action: 'none' };
  },
};
