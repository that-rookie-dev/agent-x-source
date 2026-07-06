import { useEffect, useRef } from 'react';
import { shouldBeginPushToTalkOnSpace, shouldEndPushToTalkOnSpace } from '../voice/wake-phrase';

const DOUBLE_TAP_SPACE_MS = 350;

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
  /** Two quick Space presses toggle push-to-talk ↔ hands-free. */
  onDoubleTapSpace?: () => void;
}) {
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const lastSpaceDownRef = useRef(0);

  useEffect(() => {
    if (!options.enabled) return;

    const onKeyDown = (event: KeyboardEvent) => {
      const opts = optionsRef.current;
      const mod = event.metaKey || event.ctrlKey;
      if (mod && event.shiftKey && event.key.toLowerCase() === 'm') {
        event.preventDefault();
        opts.onToggleSession();
        return;
      }
      if (event.key === 'Escape') {
        opts.onInterruptPlayback();
        if (opts.pushToTalk) opts.onEndPushToTalk();
        return;
      }
      if (event.key === ' ') {
        if (event.repeat) return;

        const now = Date.now();
        if (opts.onDoubleTapSpace && now - lastSpaceDownRef.current < DOUBLE_TAP_SPACE_MS) {
          event.preventDefault();
          lastSpaceDownRef.current = 0;
          opts.onDoubleTapSpace();
          return;
        }
        lastSpaceDownRef.current = now;

        if (
          opts.pushToTalk &&
          shouldBeginPushToTalkOnSpace({
            globalSpace: opts.globalSpace,
            composerFocused: opts.composerFocused,
            composerEmpty: opts.composerEmpty,
            repeat: false,
          })
        ) {
          event.preventDefault();
          event.stopPropagation();
          opts.onBeginPushToTalk();
          return;
        }

        if (opts.onDoubleTapSpace && opts.globalSpace) {
          event.preventDefault();
          event.stopPropagation();
        }
        return;
      }
    };

    const onKeyUp = (event: KeyboardEvent) => {
      const opts = optionsRef.current;
      if (
        opts.pushToTalk &&
        event.key === ' ' &&
        shouldEndPushToTalkOnSpace({
          globalSpace: opts.globalSpace,
          composerFocused: opts.composerFocused,
        })
      ) {
        event.preventDefault();
        event.stopPropagation();
        opts.onEndPushToTalk();
      }
    };

    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('keyup', onKeyUp, true);
    };
  }, [options.enabled]);
}
