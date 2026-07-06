export type VoiceInputMode = 'push-to-talk' | 'duplex';

const VOICE_INPUT_MODE_KEY = 'agentx_voice_input_mode_v1';

export function loadVoiceInputMode(): VoiceInputMode {
  try {
    const raw = localStorage.getItem(VOICE_INPUT_MODE_KEY);
    return raw === 'duplex' ? 'duplex' : 'push-to-talk';
  } catch {
    return 'push-to-talk';
  }
}

export function saveVoiceInputMode(mode: VoiceInputMode): void {
  try {
    localStorage.setItem(VOICE_INPUT_MODE_KEY, mode);
  } catch {
    // ignore
  }
}
