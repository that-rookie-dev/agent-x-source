import { useEffect } from 'react';
import { shouldBeginPushToTalkOnSpace, shouldEndPushToTalkOnSpace } from '../voice/wake-phrase';

export function useVoiceKeyboard(options: {
  enabled: boolean;
  /** When true, Space push-to-talk works without chat composer focus (voice modal). */
  globalSpace?: boolean;
  composerFocused: boolean;
  composerEmpty: boolean;
  pushToTalk: boolean;
  onBeginPushToTalk: () => void;
  onEndPushToTalk: () => void;
  onToggleSession: () => void;
  onInterruptPlayback: () => void;
}) {
  useEffect(() => {
    if (!options.enabled) return;

    const onKeyDown = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey;
      if (mod && event.shiftKey && event.key.toLowerCase() === 'm') {
        event.preventDefault();
        options.onToggleSession();
        return;
      }
      if (event.key === 'Escape') {
        options.onInterruptPlayback();
        if (options.pushToTalk) options.onEndPushToTalk();
        return;
      }
      if (
        options.pushToTalk &&
        event.key === ' ' &&
        shouldBeginPushToTalkOnSpace({
          globalSpace: options.globalSpace,
          composerFocused: options.composerFocused,
          composerEmpty: options.composerEmpty,
          repeat: event.repeat,
        })
      ) {
        event.preventDefault();
        options.onBeginPushToTalk();
      }
    };

    const onKeyUp = (event: KeyboardEvent) => {
      if (
        options.pushToTalk &&
        event.key === ' ' &&
        shouldEndPushToTalkOnSpace({
          globalSpace: options.globalSpace,
          composerFocused: options.composerFocused,
        })
      ) {
        event.preventDefault();
        options.onEndPushToTalk();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [options]);
}
