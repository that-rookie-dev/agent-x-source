function platformKey(): string {
  if (typeof window !== 'undefined' && window.agentx?.platform) {
    return window.agentx.platform;
  }
  return typeof navigator !== 'undefined' ? navigator.platform : 'unknown';
}

export function getMicrophoneSetupInstructions(state: MicrophonePermissionState = 'prompt'): string[] {
  const platform = platformKey();
  if (state === 'granted') {
    return ['Microphone access is allowed. You can use voice in chat.'];
  }

  if (platform === 'darwin') {
    return [
      'Open System Settings → Privacy & Security → Microphone.',
      'Enable Agent-X, then return here and click Try again.',
    ];
  }
  if (platform === 'win32') {
    return [
      'Open Settings → Privacy → Microphone.',
      'Allow desktop apps to access the microphone, then retry.',
    ];
  }

  return [
    'In Chrome/Edge: lock icon → Site settings → Microphone → Allow.',
    'In Firefox: address bar shield → Permissions → Use the Microphone.',
    'In Safari: website settings → Microphone → Allow.',
  ];
}

export type MicrophonePermissionState = 'unknown' | 'prompt' | 'granted' | 'denied';

export async function getMicrophonePermissionState(): Promise<MicrophonePermissionState> {
  return queryMicrophonePermission();
}

export async function queryMicrophonePermission(): Promise<MicrophonePermissionState> {
  if (!navigator.mediaDevices?.getUserMedia) return 'denied';
  try {
    const status = await navigator.permissions.query({ name: 'microphone' as PermissionName });
    if (status.state === 'granted') return 'granted';
    if (status.state === 'denied') return 'denied';
    return 'prompt';
  } catch {
    return 'unknown';
  }
}

export async function requestMicrophoneAccess(): Promise<'granted' | 'denied' | 'error'> {
  // In the desktop app, macOS needs an OS-level (TCC) prompt first — without
  // it getUserMedia fails silently even when Chromium-level permission is granted.
  if (window.agentx?.requestMicrophoneAccess) {
    try {
      const { granted } = await window.agentx.requestMicrophoneAccess();
      if (!granted) return 'denied';
    } catch {
      // continue with getUserMedia; it will surface the real error
    }
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    stream.getTracks().forEach((track) => track.stop());
    return 'granted';
  } catch (error) {
    const name = error instanceof DOMException ? error.name : '';
    if (name === 'NotAllowedError' || name === 'PermissionDeniedError') return 'denied';
    return 'error';
  }
}

export function microphoneBlockedHelpText(state: MicrophonePermissionState = 'denied'): string {
  return getMicrophoneSetupInstructions(state).join(' ');
}

import { VOICE_MIC_PREPROMPT_KEY } from '../voice/constants';

export function hasSeenMicPreprompt(): boolean {
  try {
    return localStorage.getItem(VOICE_MIC_PREPROMPT_KEY) === '1';
  } catch {
    return false;
  }
}

export function markMicPrepromptSeen(): void {
  try {
    localStorage.setItem(VOICE_MIC_PREPROMPT_KEY, '1');
  } catch {
    // ignore
  }
}
