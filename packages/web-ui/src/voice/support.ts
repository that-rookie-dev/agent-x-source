import type { VoiceConfig } from '../api';

export function isSecureVoiceContext(): boolean {
  if (typeof window === 'undefined') return false;
  if (window.isSecureContext) return true;
  return window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
}

export function isVoiceCaptureSupported(): boolean {
  return Boolean(typeof navigator !== 'undefined' && navigator.mediaDevices?.getUserMedia);
}

export function isAudioWorkletSupported(): boolean {
  return typeof window !== 'undefined' && 'AudioWorkletNode' in window;
}

export function voiceDisabledReason(): string | null {
  if (!isSecureVoiceContext()) return 'Voice requires HTTPS or localhost.';
  if (!isVoiceCaptureSupported()) return 'This browser does not support microphone capture.';
  if (!isAudioWorkletSupported()) return 'Voice requires AudioWorklet support in this browser.';
  return null;
}

export function markVoiceOutputUnlocked(): void {
  try {
    sessionStorage.setItem('agentx_voice_output_unlocked_v1', '1');
  } catch {
    // ignore
  }
}

export function isVoiceOutputUnlocked(): boolean {
  try {
    return sessionStorage.getItem('agentx_voice_output_unlocked_v1') === '1';
  } catch {
    return false;
  }
}

export function notifyVoiceConfigUpdated(detail?: VoiceConfig): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('agentx:voice-updated', { detail }));
}
