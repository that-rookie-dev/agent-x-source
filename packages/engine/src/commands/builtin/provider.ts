import type { CommandInterface, CommandContext, CommandResult } from '../CommandInterface.js';
import { ConfigManager } from '../../config/ConfigManager.js';
import type { ProviderCredentials } from '@agentx/shared';

export const providerCommand: CommandInterface = {
  name: 'provider',
  description: 'Switch provider, list profiles, or manage profiles',
  aliases: ['p'],
  usage: '/provider [provider-id | reset | list | profile add <name> | profile switch <name> | profile delete <name>]',
  async execute(args: string[], context: CommandContext): Promise<CommandResult> {
    if (args.length === 0) {
      return { success: true, action: 'list_providers' };
    }

    if (args[0] === 'reset') {
      return { success: true, action: 'reset_provider' };
    }

    if (args[0] === 'list') {
      const cm = new ConfigManager();
      try {
        const cfg = cm.load();
        const lines: string[] = ['Linked providers:'];
        for (const [id, credsRaw] of Object.entries(cfg.provider.providers)) {
          const creds = credsRaw as ProviderCredentials;
          if (creds.configured) {
            const active = id === cfg.provider.activeProvider ? ' (active)' : '';
            const profiles = creds.profiles ? Object.keys(creds.profiles).join(', ') : '(no profiles)';
            const ap = creds.activeProfile ? ` → profile: ${creds.activeProfile}` : '';
            lines.push(`  ${id}${active} — ${profiles}${ap}`);
          }
        }
        const model = cfg.provider.activeModel ? `\nModel: ${cfg.provider.activeModel}` : '';
        context.emit(lines.join('\n') + model);
      } catch (e) {
        context.emit('No providers configured.');
      }
      return { success: true, action: 'none' };
    }

    if (args[0] === 'profile') {
      const sub = args[1];
      const name = args.slice(2).join(' ');

      if (!sub || (sub !== 'add' && sub !== 'switch' && sub !== 'delete')) {
        context.emit('Usage: /provider profile add <name> | switch <name> | delete <name>');
        return { success: true, action: 'none' };
      }

      if (!name.trim()) {
        context.emit(`Profile name required. Usage: /provider profile ${sub} <name>`);
        return { success: true, action: 'none' };
      }

      const cm = new ConfigManager();
      try {
        const cfg = cm.load();
        const providerId = cfg.provider.activeProvider;
        const creds = cfg.provider.providers[providerId] as ProviderCredentials | undefined;
        if (!creds?.configured) {
          context.emit(`No provider configured. Link one first.`);
          return { success: true, action: 'none' };
        }
        const profileId = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-');

        if (sub === 'add') {
          cm.addProviderProfile(providerId, profileId, {
            label: name.trim(),
            createdAt: new Date().toISOString(),
          }, true);
          context.emit(`Profile "${name.trim()}" created for ${providerId}.`);
          if (context.emit) context.emit('You can set API key/URL via /provider profile switch or the setup wizard.');
        } else if (sub === 'switch') {
          cm.setActiveProviderProfile(providerId, profileId);
          context.emit(`Switched to profile "${name.trim()}" for ${providerId}.`);
        } else if (sub === 'delete') {
          cm.removeProviderProfile(providerId, profileId);
          context.emit(`Deleted profile "${name.trim()}" for ${providerId}.`);
        }
      } catch (e) {
        context.emit(`Profile operation failed: ${e instanceof Error ? e.message : 'unknown error'}`);
      }

      return { success: true, action: 'none' };
    }

    // Default: switch to the specified provider
    return { success: true, output: args[0], action: 'switch_provider' };
  },
};
