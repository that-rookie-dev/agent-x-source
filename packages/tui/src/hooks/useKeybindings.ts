import { useCallback, useEffect } from 'react';
import { useInput } from 'ink';

interface KeyBindings {
  onCtrlC?: () => void;
  onCtrlD?: () => void;
  onCtrlL?: () => void;
  onCtrlR?: () => void;
  onCtrlP?: () => void;
  onCtrlN?: () => void;
  onEscape?: () => void;
  onTab?: () => void;
  onPageUp?: () => void;
  onPageDown?: () => void;
}

export function useKeybindings(bindings: KeyBindings): void {
  const handler = useCallback(
    (input: string, key: { ctrl?: boolean; escape?: boolean; tab?: boolean; pageUp?: boolean; pageDown?: boolean }) => {
      if (key.ctrl) {
        switch (input) {
          case 'c': bindings.onCtrlC?.(); break;
          case 'd': bindings.onCtrlD?.(); break;
          case 'l': bindings.onCtrlL?.(); break;
          case 'r': bindings.onCtrlR?.(); break;
          case 'p': bindings.onCtrlP?.(); break;
          case 'n': bindings.onCtrlN?.(); break;
        }
      }
      if (key.escape) bindings.onEscape?.();
      if (key.tab) bindings.onTab?.();
      if (key.pageUp) bindings.onPageUp?.();
      if (key.pageDown) bindings.onPageDown?.();
    },
    [bindings],
  );

  useInput(handler);

  // Cleanup effect
  useEffect(() => {
    return () => {};
  }, []);
}
