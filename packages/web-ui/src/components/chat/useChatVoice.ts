// useChatVoice.ts — extracted from useChatSessionState.tsx
// Owns voice composer state, voice handlers, and voice context registration.
// Moderate coupling: needs setMessages, beginTurnUi, currentSessionId.

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { sanitizeForJson } from '../../chat/utils';
import { useVoiceOptional } from '../voice/VoiceProvider';
import type { VoiceTurnTimings } from '../../voice/VoiceSessionClient';
import type { UIMessage } from '../../chat/types';

export interface UseChatVoiceInputs {
  setMessages: React.Dispatch<React.SetStateAction<UIMessage[]>>;
  beginTurnUi: () => void;
  currentSessionId: string | null;
}

export function useChatVoice({ setMessages, beginTurnUi, currentSessionId }: UseChatVoiceInputs) {
  const voiceCtx = useVoiceOptional();
  const [composerMode, setComposerMode] = useState<'text' | 'voice'>('text');
  const [voiceAutoStart, setVoiceAutoStart] = useState(false);

  const voicePendingUserIdRef = useRef<string | null>(null);
  const scrollAfterVoiceUserRef = useRef<() => void>(() => {});

  const appendVoiceUserTurn = useCallback((text: string, messageId?: string) => {
    const trimmed = sanitizeForJson(text.trim());
    if (!trimmed) return;
    setMessages((prev) => {
      for (let i = Math.max(0, prev.length - 8); i < prev.length; i += 1) {
        const m = prev[i];
        if (m?.role === 'user' && m.content === trimmed) {
          if (m.voiceInput) return prev;
          return prev.map((msg, idx) => (
            idx === i
              ? { ...msg, voiceInput: true, id: messageId ?? msg.id }
              : msg
          ));
        }
      }
      return [
        ...prev,
        { id: messageId ?? crypto.randomUUID(), role: 'user', content: trimmed, streaming: false, voiceInput: true },
      ];
    });
  }, [setMessages]);

  const handleVoiceUserPending = useCallback(() => {
    if (voicePendingUserIdRef.current) return;
    const id = crypto.randomUUID();
    voicePendingUserIdRef.current = id;
    appendVoiceUserTurn('…', id);
    requestAnimationFrame(() => scrollAfterVoiceUserRef.current());
  }, [appendVoiceUserTurn]);

  const handleVoiceUserDiscarded = useCallback(() => {
    const pendingId = voicePendingUserIdRef.current;
    voicePendingUserIdRef.current = null;
    if (!pendingId) return;
    setMessages((prev) => prev.filter((m) => m.id !== pendingId));
  }, [setMessages]);

  const beginVoiceAgentTurn = useCallback(() => {
    beginTurnUi();
    setMessages((prev) => {
      const last = prev[prev.length - 1];
      if (last?.role === 'assistant' && last.streaming) return prev;
      if (last?.role === 'user') {
        return [...prev, { id: crypto.randomUUID(), role: 'assistant', content: '', streaming: true }];
      }
      return prev;
    });
  }, [beginTurnUi, setMessages]);

  const handleVoiceTranscript = useCallback((text: string, empty: boolean) => {
    if (empty) {
      handleVoiceUserDiscarded();
      return;
    }
    const trimmed = sanitizeForJson(text.trim());
    if (!trimmed) {
      handleVoiceUserDiscarded();
      return;
    }
    const pendingId = voicePendingUserIdRef.current;
    voicePendingUserIdRef.current = null;
    if (pendingId) {
      setMessages((prev) => prev.map((m) => (
        m.id === pendingId ? { ...m, content: trimmed, voiceInput: true } : m
      )));
    } else {
      appendVoiceUserTurn(trimmed);
    }
    beginVoiceAgentTurn();
    requestAnimationFrame(() => scrollAfterVoiceUserRef.current());
  }, [appendVoiceUserTurn, beginVoiceAgentTurn, handleVoiceUserDiscarded, setMessages]);

  const handleVoiceTiming = useCallback((timings: VoiceTurnTimings) => {
    setMessages((prev) => {
      for (let i = prev.length - 1; i >= 0; i -= 1) {
        const msg = prev[i];
        if (msg?.role !== 'assistant') continue;
        return [...prev.slice(0, i), { ...msg, voiceTimings: timings }, ...prev.slice(i + 1)];
      }
      return prev;
    });
  }, [setMessages]);

  useEffect(() => {
    voiceCtx?.registerChatSession(currentSessionId);
    return () => voiceCtx?.registerChatSession(null);
  }, [currentSessionId, voiceCtx]);

  useEffect(() => {
    if (!voiceCtx) return;
    voiceCtx.registerInlineVoiceHandler((autoStart) => {
      setComposerMode('voice');
      requestAnimationFrame(() => {
        (document.activeElement as HTMLElement | null)?.blur?.();
      });
      if (autoStart) setVoiceAutoStart(true);
    });
    voiceCtx.registerVoiceChatBridge({
      onVoiceUserPending: handleVoiceUserPending,
      onVoiceUserDiscarded: handleVoiceUserDiscarded,
      onTranscriptFinal: handleVoiceTranscript,
      onAgentRunning: () => {},
    });
    return () => {
      voiceCtx.registerInlineVoiceHandler(null);
      voiceCtx.registerVoiceChatBridge(null);
    };
  }, [voiceCtx, handleVoiceUserPending, handleVoiceUserDiscarded, handleVoiceTranscript]);

  return {
    voiceCtx,
    composerMode, setComposerMode,
    voiceAutoStart, setVoiceAutoStart,
    scrollAfterVoiceUserRef,
    handleVoiceUserPending,
    handleVoiceUserDiscarded,
    handleVoiceTranscript,
    handleVoiceTiming,
  };
}
