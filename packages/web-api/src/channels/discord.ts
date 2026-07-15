import { DiscordBridge, getBuiltinPlugin } from '@agentx/engine';
import { getLogger } from '@agentx/shared';
import { getEngine } from '../engine.js';

export async function startDiscordInbound(botToken: string, channelId?: string, allowedUserIds?: string[]): Promise<void> {
  const eng = getEngine();
  const { resolveInboundAgentForChannel } = await import('../channel-session-bridge.js');
  const existing = eng.pluginRegistry.getPlugin('discord');
  if (existing) {
    eng.pluginRegistry.updateConfig('discord', { botToken, channelId });
  } else {
    const entry = getBuiltinPlugin('discord');
    if (entry) {
      eng.pluginRegistry.install(entry);
      eng.pluginRegistry.updateConfig('discord', { botToken, channelId });
    }
  }
  eng.pluginRegistry.enable('discord');

  if (eng.discordBridge) {
    try { eng.discordBridge.stop(); } catch { /* ignore */ }
    eng.discordBridge = null;
  }

  const bridge = new DiscordBridge();
  bridge.setAllowedUserIds(allowedUserIds ?? []);
  bridge.setAgentFactory(async () => resolveInboundAgentForChannel('discord'));
  await bridge.start(botToken, channelId);
  eng.discordBridge = bridge;
  getLogger().info('CHANNELS', 'Discord inbound bridge started');
}

export async function stopDiscordInbound(): Promise<void> {
  const eng = getEngine();
  if (eng.discordBridge) {
    try { eng.discordBridge.stop(); } catch { /* ignore */ }
    eng.discordBridge = null;
  }
  if (eng.pluginRegistry.isInstalled('discord')) {
    eng.pluginRegistry.disable('discord');
  }
}
