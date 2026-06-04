import type { CommandInterface, CommandContext, CommandResult } from '../CommandInterface.js';
import { CrewManager } from '../../secret-sauce/CrewManager.js';

export const crewCommand: CommandInterface = {
  name: 'crew',
  description: 'Manage crews: list, enable, disable, show, switch, create',
  usage: '/crew [list|enable <id>|disable <id>|show <id>|switch <id>]',
  async execute(args: string[], context: CommandContext): Promise<CommandResult> {
    const subcommand = args[0];
    const pm = new CrewManager();

    if (subcommand === 'list') {
      const crews = pm.list();
      if (crews.length === 0) {
        context.emit('No crews configured. Use /crew create to add one.');
        return { success: true, action: 'none' };
      }
      const activeId = pm.getActiveId();
      const lines = crews.map((c) => {
        const status = c.enabled ? '✓' : '✗';
        const active = activeId !== null && c.id === activeId ? ' (active)' : '';
        const expertise = c.expertise?.join(', ') || 'general';
        return `${status} **${c.name}** (@${c.callsign})${active}\n   Expertise: ${expertise}`;
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
      if (success) {
        context.emit(`✓ Crew "${id}" enabled.`);
      } else {
        context.emit(`✗ Failed to enable crew "${id}".`);
      }
      return { success, action: 'none' };
    }

    if (subcommand === 'disable') {
      const id = args[1];
      if (!id) {
        context.emit('Usage: /crew disable <crew_id>');
        return { success: false, action: 'none' };
      }
      const success = pm.disable(id);
      if (success) {
        context.emit(`✓ Crew "${id}" disabled.`);
      } else {
        context.emit(`✗ Failed to disable crew "${id}".`);
      }
      return { success, action: 'none' };
    }

    if (subcommand === 'show') {
      const id = args[1] ?? pm.getActiveId() ?? undefined;
      if (!id) {
        context.emit('No active crew and no crew ID provided.');
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
      pm.switch(id);
      context.emit(`✓ Crew "${name}" (@${callsign || id}) created and activated.`);
      return { success: true, action: 'none' };
    }

    if (subcommand === 'switch') {
      const id = args[1];
      if (!id) {
        context.emit('Usage: /crew switch <crew_id>');
        return { success: false, action: 'none' };
      }
      const crew = pm.switch(id);
      if (crew) {
        context.emit(`✓ Switched to crew "${crew.name}".`);
        return { success: true, action: 'switch_crew' };
      }
      context.emit(`✗ Crew "${id}" not found.`);
      return { success: false, action: 'none' };
    }

    // Default: open crew picker UI (handles switch, create)
    return { success: true, action: 'switch_crew' };
  },
};
