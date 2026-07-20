import { SlackBridge, getBuiltinPlugin } from '@agentx/engine';
import { getLogger } from '@agentx/shared';
import { getEngine } from '../engine.js';

export async function startSlackInbound(botToken: string, appToken: string, allowedUserIds?: string[]): Promise<void> {
  const eng = getEngine();
  const { resolveInboundAgentForChannel } = await import('../channel-session-bridge.js');
  const existing = eng.pluginRegistry.getPlugin('slack');
  if (existing) {
    eng.pluginRegistry.updateConfig('slack', { botToken, appToken });
  } else {
    const entry = getBuiltinPlugin('slack');
    if (entry) {
      eng.pluginRegistry.install(entry);
      eng.pluginRegistry.updateConfig('slack', { botToken, appToken });
    }
  }
  eng.pluginRegistry.enable('slack');

  if (eng.slackBridge) {
    try { eng.slackBridge.stop(); } catch { /* ignore */ }
    eng.slackBridge = null;
  }

  const bridge = new SlackBridge({ botToken, appToken });
  bridge.setAllowedUserIds(allowedUserIds ?? []);
  bridge.setAgentFactory(() => resolveInboundAgentForChannel('slack'));
  await bridge.start();
  eng.slackBridge = bridge;
  getLogger().info('CHANNELS', 'Slack inbound bridge started');
}

export async function stopSlackInbound(): Promise<void> {
  const eng = getEngine();
  if (eng.slackBridge) {
    try { eng.slackBridge.stop(); } catch { /* ignore */ }
    eng.slackBridge = null;
  }
  if (eng.pluginRegistry.isInstalled('slack')) {
    eng.pluginRegistry.disable('slack');
  }
}
