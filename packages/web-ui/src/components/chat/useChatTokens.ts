// useChatTokens.ts — extracted from useChatSessionState.tsx
// Owns token usage state for the right sidebar.

import { useState, useRef, useEffect } from 'react';
import type { ModelInfo } from '../../api';

export interface UseChatTokensInputs {
  currentSessionId: string | null;
  currentModel: string;
  modelList: ModelInfo[];
}

export function useChatTokens({ currentSessionId: _currentSessionId, currentModel, modelList }: UseChatTokensInputs) {
  // ─── Token state ───
  const [tokenUsed, setTokenUsed] = useState(0);
  const [tokenInput, setTokenInput] = useState(0);
  const [tokenOutput, setTokenOutput] = useState(0);
  const [tokenReserved, setTokenReserved] = useState(0);
  const [tokenStreaming, setTokenStreaming] = useState(0);
  const [tokenTotal, setTokenTotal] = useState(128000);
  const [compactionCount, setCompactionCount] = useState(0);

  // ─── Token refs (read by telemetry/handleEvent for fast non-reactive access) ───
  const tokenInputRef = useRef(0);
  const tokenOutputRef = useRef(0);
  const tokenReservedRef = useRef(0);

  // ─── Update tokenTotal when model's context window is known ───
  useEffect(() => {
    if (!currentModel || modelList.length === 0) return;
    const match = modelList.find(m => m.id === currentModel);
    if (match?.contextWindow) {
      setTokenTotal(match.contextWindow);
      const reserve = Math.min(20000, Math.round(match.contextWindow * 0.15));
      setTokenReserved(reserve);
      tokenReservedRef.current = reserve;
    }
  }, [currentModel, modelList]);

  // ─── Token percentage (computed) ───
  const tokenPercent = tokenTotal > 0 ? Math.min((tokenUsed / tokenTotal) * 100, 100) : 0;

  return {
    // Token state
    tokenUsed, setTokenUsed,
    tokenInput, setTokenInput,
    tokenOutput, setTokenOutput,
    tokenReserved, setTokenReserved,
    tokenStreaming, setTokenStreaming,
    tokenTotal, setTokenTotal,
    compactionCount, setCompactionCount,
    tokenPercent,
    // Token refs
    tokenInputRef,
    tokenOutputRef,
    tokenReservedRef,
  };
}
