import { useCallback, useEffect, useState } from 'react';
import {
  getMicrophoneSetupInstructions,
  microphoneBlockedHelpText,
  queryMicrophonePermission,
  requestMicrophoneAccess,
  type MicrophonePermissionState,
} from '../utils/microphone-permission';

export function useMicrophonePermission() {
  const [state, setState] = useState<MicrophonePermissionState>('unknown');

  const refresh = useCallback(async () => {
    if (window.agentx?.checkMicrophoneAccess) {
      const result = await window.agentx.checkMicrophoneAccess();
      setState(result.granted ? 'granted' : result.state === 'denied' ? 'denied' : 'prompt');
      return;
    }
    setState(await queryMicrophonePermission());
  }, []);

  useEffect(() => {
    void refresh();
    const onFocus = () => { void refresh(); };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refresh]);

  const requestAccess = useCallback(async () => {
    const result = await requestMicrophoneAccess();
    await refresh();
    return result === 'granted';
  }, [refresh]);

  const openSettings = useCallback(async () => {
    if (window.agentx?.openMicrophoneSettings) {
      await window.agentx.openMicrophoneSettings();
    }
  }, []);

  return {
    state,
    helpText: microphoneBlockedHelpText(state),
    setupInstructions: getMicrophoneSetupInstructions(state),
    canRequest: state !== 'denied',
    blocked: state === 'denied',
    refresh,
    requestAccess,
    openSettings,
    openRecoveryHelp: openSettings,
  };
}
