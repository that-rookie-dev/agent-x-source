import { colors } from '../../theme';

export const COMMS_MONO = "'JetBrains Mono', monospace";

export const commsTheme = {
  bg: '#000000',
  panel: '#080808',
  panelActive: '#0e0e0e',
  border: 'rgba(255,255,255,0.1)',
  borderActive: 'rgba(255,255,255,0.55)',
  text: colors.text.primary,
  textSecondary: colors.text.secondary,
  textDim: colors.text.dim,
  operator: colors.accent.cyan,
  agent: colors.accent.green,
  relay: colors.text.primary,
  relayReady: colors.accent.green,
  relayReadyBg: 'rgba(34, 197, 94, 0.08)',
  relayReadyBorder: 'rgba(34, 197, 94, 0.45)',
  error: colors.accent.red,
  warn: colors.accent.orange,
};

export function friendlyVoiceError(message: string): string {
  const lower = message.toLowerCase();
  if (lower.includes('fetch failed') || lower.includes('econnrefused') || lower.includes('enotfound')) {
    return 'Voice engine offline — verify setup in Settings → Voice, then restart Agent-X.';
  }
  if (lower.includes('voice is disabled')) {
    return 'Voice comms disabled — enable in Settings → Voice or complete setup wizard.';
  }
  if (lower.includes('websocket') || lower.includes('session may have expired')) {
    return 'Comms link lost — refresh the page or sign in again.';
  }
  if (lower.includes('no chat session')) {
    return 'No active mission channel — open a chat first.';
  }
  if (lower.includes('agent is not ready')) {
    return 'Agent core not ready — finish setup or wait for the model to load.';
  }
  return message;
}
