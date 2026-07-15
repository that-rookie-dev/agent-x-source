// useChatHyperdrive.ts — extracted from useChatSessionState.tsx
// Owns hyperdrive mode state, shimmer effect, hyperdrive toggle/confirm handlers,
// mount check effect, and global keyboard shortcuts (Tab/Shift/Cmd+K/Cmd+F/Cmd+Z/Esc).
// Moderate coupling: needs many inputs for keyboard shortcuts.

import { useState, useRef, useEffect, useCallback } from 'react';
import { type AgentMode } from '../../api';
import type { UIMessage, ChatView } from '../../chat/types';

export interface UseChatHyperdriveInputs {
  isCrewPrivateRef: React.MutableRefObject<boolean>;
  isCrewPrivateSession: boolean;
  agentMode: AgentMode;
  setAgentMode: React.Dispatch<React.SetStateAction<AgentMode>>;
  currentSessionId: string | null;
  streaming: boolean;
  messages: UIMessage[];
  view: ChatView;
  handleToggleMode: () => void;
  handleResend: (text: string) => Promise<void>;
  handleCancel: () => Promise<void>;
  setPaletteOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setSearchOpen: React.Dispatch<React.SetStateAction<boolean>>;
}

export function useChatHyperdrive({
  isCrewPrivateRef,
  isCrewPrivateSession,
  agentMode,
  setAgentMode,
  currentSessionId,
  streaming,
  messages,
  view,
  handleToggleMode,
  handleResend,
  handleCancel,
  setPaletteOpen,
  setSearchOpen,
}: UseChatHyperdriveInputs) {
  const [hyperdriveMode, setHyperdriveMode] = useState(false);
  const [showDisclaimer, setShowDisclaimer] = useState(false);
  const hyperdrivePromptShownRef = useRef(false);
  const lastShiftRef = useRef(0);
  const prevModeBeforeHyperdrive = useRef<AgentMode>('plan');
  const agentModeRef = useRef(agentMode);
  const hyperdriveModeRef = useRef(hyperdriveMode);

  useEffect(() => { agentModeRef.current = agentMode; }, [agentMode]);
  useEffect(() => { hyperdriveModeRef.current = hyperdriveMode; }, [hyperdriveMode]);

  // ─── Hyperdrive shimmer — random interval flash sweep across the chip ───
  const [hyperdriveShimmer, setHyperdriveShimmer] = useState(false);
  useEffect(() => {
    if (hyperdriveMode) { setHyperdriveShimmer(false); return; }
    const trigger = () => {
      setHyperdriveShimmer(true);
      setTimeout(() => setHyperdriveShimmer(false), 800);
    };
    const nextInterval = () => 3000 + Math.random() * 7000;
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => { timer = setTimeout(() => { trigger(); schedule(); }, nextInterval()); };
    schedule();
    return () => clearTimeout(timer);
  }, [hyperdriveMode]);

  // ─── engageHyperdrive ───
  const engageHyperdrive = useCallback(async (skipDisclaimer = false) => {
    if (isCrewPrivateRef.current) {
      if (hyperdriveModeRef.current) {
        try {
          const res = await fetch('/api/mode/hyperdrive', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' } });
          const data = await res.json();
          setHyperdriveMode(false);
          if (data.mode) setAgentMode(data.mode);
          else setAgentMode(prevModeBeforeHyperdrive.current);
        } catch { /* best-effort */ }
      }
      return;
    }
    if (hyperdriveModeRef.current) {
      try {
        const res = await fetch('/api/mode/hyperdrive', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' } });
        const data = await res.json();
        setHyperdriveMode(false);
        if (data.mode) setAgentMode(data.mode);
        else setAgentMode(prevModeBeforeHyperdrive.current);
      } catch {}
      return;
    }
    if (!skipDisclaimer && !hyperdrivePromptShownRef.current) {
      setShowDisclaimer(true);
      return;
    }
    hyperdrivePromptShownRef.current = true;
    try {
      const res = await fetch('/api/mode/hyperdrive', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' } });
      const data = await res.json();
      prevModeBeforeHyperdrive.current = agentModeRef.current;
      setHyperdriveMode(true);
      if (data.mode) setAgentMode(data.mode);
    } catch {}
  }, [isCrewPrivateRef, setAgentMode, setHyperdriveMode, agentModeRef, hyperdriveModeRef]);

  const handleHyperdriveToggle = useCallback(() => {
    engageHyperdrive();
  }, [engageHyperdrive]);

  const confirmHyperdrive = useCallback(async () => {
    setShowDisclaimer(false);
    hyperdrivePromptShownRef.current = true;
    try {
      const res = await fetch('/api/mode/hyperdrive', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' } });
      const data = await res.json();
      prevModeBeforeHyperdrive.current = agentModeRef.current;
      setHyperdriveMode(true);
      if (data.mode) setAgentMode(data.mode);
    } catch {}
  }, [setAgentMode, setHyperdriveMode, agentModeRef]);

  // ─── Check hyperdrive mode on mount (disabled for crew private chats) ───
  useEffect(() => {
    hyperdrivePromptShownRef.current = false;
    if (isCrewPrivateSession) {
      setHyperdriveMode(false);
      fetch('/api/mode/hyperdrive', { credentials: 'include' })
        .then((r) => r.json())
        .then((d) => {
          if (d.hyperdriveMode) {
            return fetch('/api/mode/hyperdrive', {
              method: 'POST',
              credentials: 'include',
              headers: { 'Content-Type': 'application/json' },
            });
          }
          return undefined;
        })
        .catch(() => {});
      return;
    }
    fetch('/api/mode/hyperdrive', { credentials: 'include' })
      .then(r => r.json())
      .then(d => {
        if (d.hyperdriveMode) {
          setHyperdriveMode(true);
          if (d.mode) setAgentMode(d.mode);
        }
      })
      .catch(() => {});
  }, [currentSessionId, isCrewPrivateSession, setAgentMode]);

  // ─── Global keyboard shortcuts ───
  const lastEscRef = useRef(0);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (e.key === 'Tab') {
        if (hyperdriveMode) {
          e.preventDefault();
          engageHyperdrive();
          return;
        }
        e.preventDefault();
        handleToggleMode();
      } else if (e.key === 'Shift') {
        if (isCrewPrivateRef.current) return;
        const now = Date.now();
        if (now - lastShiftRef.current < 500) {
          lastShiftRef.current = 0;
          engageHyperdrive();
        } else {
          lastShiftRef.current = now;
        }
      } else if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen(o => !o);
      } else if (mod && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        setSearchOpen(true);
      } else if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault();
        handleResend(messages.filter(m => m.role === 'user').pop()?.content ?? '');
      } else if (e.key === 'Escape') {
        e.preventDefault();
        if (streaming) {
          handleCancel();
        } else {
          const now = Date.now();
          if (now - lastEscRef.current < 500) {
            handleCancel();
            lastEscRef.current = 0;
          } else {
            lastEscRef.current = now;
          }
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [streaming, messages, handleResend, view, handleToggleMode, engageHyperdrive, isCrewPrivateRef, setPaletteOpen, setSearchOpen, handleCancel]);

  return {
    hyperdriveMode, setHyperdriveMode,
    showDisclaimer, setShowDisclaimer,
    hyperdriveShimmer,
    handleHyperdriveToggle,
    confirmHyperdrive,
    engageHyperdrive,
  };
}
