// useChatTokens.ts — extracted from useChatSessionState.tsx
// Owns token usage state, context data, and context refresh logic.
// Self-contained: only needs currentSessionId, currentModel, and modelList.

import { useState, useRef, useEffect, useCallback } from 'react';
import type { ModelInfo } from '../../api';

export interface UseChatTokensInputs {
  currentSessionId: string | null;
  currentModel: string;
  modelList: ModelInfo[];
}

export function useChatTokens({ currentSessionId, currentModel, modelList }: UseChatTokensInputs) {
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

  // ─── Context data state ───
  const [contextData, setContextData] = useState('');
  const [rebuildingContext, setRebuildingContext] = useState(false);

  // ─── Stable refs for handler dependencies ───
  const currentSessionIdRef = useRef(currentSessionId);
  const rebuildingContextRef = useRef(rebuildingContext);

  useEffect(() => { currentSessionIdRef.current = currentSessionId; }, [currentSessionId]);
  useEffect(() => { rebuildingContextRef.current = rebuildingContext; }, [rebuildingContext]);

  // ─── applyContextPayload ───
  const applyContextPayload = useCallback((d: { context?: string; compaction?: string }) => {
    const parts: string[] = [];
    if (d.compaction?.trim()) parts.push(`[Compaction summaries]\n${d.compaction.trim()}`);
    if (d.context?.trim()) parts.push(`[Conversation]\n${d.context.trim()}`);
    setContextData(parts.length > 0 ? parts.join('\n\n') : '');
  }, []);

  // ─── refreshContext ───
  const refreshContext = useCallback(() => {
    if (!currentSessionIdRef.current) return;
    fetch(`/api/sessions/${currentSessionIdRef.current}/context`, { credentials: 'include' })
      .then(r => r.json())
      .then(applyContextPayload)
      .catch(() => {});
  }, [applyContextPayload]);

  // ─── refreshContextRef (kept in sync for telemetry/handleEvent) ───
  const refreshContextRef = useRef(refreshContext);
  useEffect(() => { refreshContextRef.current = refreshContext; }, [refreshContext]);

  // ─── handleRebuildContext ───
  const handleRebuildContext = useCallback(async () => {
    if (!currentSessionIdRef.current || rebuildingContextRef.current) return;
    setRebuildingContext(true);
    try {
      const r = await fetch(`/api/sessions/${currentSessionIdRef.current}/context/rebuild`, { method: 'POST', credentials: 'include' });
      const d = await r.json();
      if (d.ok) refreshContext();
    } catch { /* ignore */ }
    setRebuildingContext(false);
  }, [refreshContext, setRebuildingContext]);

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

  // ─── Refresh context data when session loads or changes ───
  useEffect(() => {
    if (!currentSessionId) return;
    refreshContext();
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') refreshContext();
    }, 30000);
    return () => clearInterval(interval);
  }, [currentSessionId, refreshContext]);

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
    // Context
    contextData, setContextData,
    rebuildingContext, setRebuildingContext,
    applyContextPayload,
    refreshContext,
    refreshContextRef,
    handleRebuildContext,
  };
}
