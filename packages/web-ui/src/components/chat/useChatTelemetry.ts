// useChatTelemetry.ts — extracted from useChatSessionState.tsx
// Contains SSE subscription, handleEvent, tool/token event appliers,
// RAF batching, streaming timeout, turn polling, and activity tracking.

import { useRef, useEffect, useCallback } from 'react';
import { subscribeOptimizedTelemetry } from '../../perf/optimized-telemetry';
import { ensureRenderInstrumentation } from '../../perf/render-instrumentation';
import { eventBelongsToViewSession } from '../../chat/session-stream-filter';
import { applyOperationEventToAssistant } from '../../chat/operation-tool-patch';
import { stripToolNoise, repairStreamTextGlitches, stripTrailingStreamPreamble, lastMessageIsQuestionnaireCard, mergeIncomingMessageParts, applyToolCompleteMetadata, reconcileStreamingMessageParts, coerceDisplayLabel } from '../../chat/utils';
import {
  parseDeepSearchProgressLine,
  parseDeepSearchProgressFromStream,
  deepSearchBundleFromMetadata,
  dedupeToolParts,
  type MessagePart,
} from '@agentx/shared/browser';
import { chat, type TelemetryEvent, type Crew, type ConnectionState, type CrewSuggestionEvaluation, type IntegrationActionPreview } from '../../api';
import type { UIMessage, PartEntry, ToolCall, SubAgent } from '../../chat/types';
import { upsertDeepSearchPartEntry } from '../../chat/types';
import { updateLastMessage, attachChildSessionToAssistant, isTimeoutWarning, replaceWarning, clearTimeoutWarnings } from './message-helpers';
import { shouldOfferCrewRosterPicker } from '../../chat/crew-suggestion-flow';
import type { CrewWorkerState } from '../CrewWorkerPanel';
import type { CrewInterMessage } from '../CrewMissionCard';

export interface UseChatTelemetryParams {
  // State values
  streaming: boolean;
  crewList: Crew[];
  turnActivity: { stage: string; step: number; elapsedMs: number } | null;

  // Shared refs
  isInitialLoadRef: React.MutableRefObject<boolean>;
  turnActiveRef: React.MutableRefObject<boolean>;
  activeTurnIdRef: React.MutableRefObject<string | null>;
  outgoingTurnRef: React.MutableRefObject<{ userId: string; userContent: string; placeholderId: string } | null>;
  resendInProgressRef: React.MutableRefObject<boolean>;
  lastTurnFeedbackCandidateRef: React.MutableRefObject<{ messageId: string; elapsedMs: number } | null>;
  viewSessionIdRef: React.MutableRefObject<string | null>;
  currentSessionIdRef: React.MutableRefObject<string | null>;
  isCrewPrivateRef: React.MutableRefObject<boolean>;
  crewPrivateHostRef: React.MutableRefObject<{ name: string; callsign: string; title?: string } | null>;
  crewMissionSessionIdRef: React.MutableRefObject<string | null>;
  crewSuggestionHandledRef: React.MutableRefObject<boolean>;
  crewGateInFlightRef: React.MutableRefObject<boolean>;
  attachCrewRosterPickerRef: React.MutableRefObject<(
    text: string,
    evaluation: CrewSuggestionEvaluation,
    opts?: { userMessageId?: string; evalAssistantMessageId?: string },
  ) => Promise<boolean>>;
  rateLimitSeenRef: React.MutableRefObject<boolean>;
  tokenInputRef: React.MutableRefObject<number>;
  tokenOutputRef: React.MutableRefObject<number>;
  tokenReservedRef: React.MutableRefObject<number>;
  refreshContextRef: React.MutableRefObject<(() => void) | null>;

  // Setters
  setMessages: React.Dispatch<React.SetStateAction<UIMessage[]>>;
  setStreaming: React.Dispatch<React.SetStateAction<boolean>>;
  setTurnActivity: React.Dispatch<React.SetStateAction<{ stage: string; step: number; elapsedMs: number } | null>>;
  setCurrentStep: React.Dispatch<React.SetStateAction<string | null>>;
  setTokenStreaming: React.Dispatch<React.SetStateAction<number>>;
  setTokenUsed: React.Dispatch<React.SetStateAction<number>>;
  setLoadingSteps: React.Dispatch<React.SetStateAction<Array<{ id: string; label: string; status: string }> | null>>;
  setWarnings: React.Dispatch<React.SetStateAction<string[]>>;
  setStepCapPrompt: React.Dispatch<React.SetStateAction<{ currentSteps: number; maxSteps: number } | null>>;
  setPermissionPrompt: React.Dispatch<React.SetStateAction<{ requestId: string; tool: string; path: string; riskLevel: string; integrationPreview?: IntegrationActionPreview; forAutomation?: boolean } | null>>;
  setPendingPermissionCount: React.Dispatch<React.SetStateAction<number>>;
  setCrewWorkers: React.Dispatch<React.SetStateAction<CrewWorkerState[]>>;
  setCrewMissionActive: React.Dispatch<React.SetStateAction<boolean>>;
  setCrewMissionId: React.Dispatch<React.SetStateAction<string | null>>;
  setCrewInterMessages: React.Dispatch<React.SetStateAction<CrewInterMessage[]>>;
  setTokenInput: React.Dispatch<React.SetStateAction<number>>;
  setTokenOutput: React.Dispatch<React.SetStateAction<number>>;
  setTokenReserved: React.Dispatch<React.SetStateAction<number>>;
  setTokenTotal: React.Dispatch<React.SetStateAction<number>>;
  setCompactionCount: React.Dispatch<React.SetStateAction<number>>;
  setToolEnablePrompt: React.Dispatch<React.SetStateAction<{ toolId: string; toolName: string } | null>>;
  setConnState: React.Dispatch<React.SetStateAction<ConnectionState>>;
  setLastEventAt: React.Dispatch<React.SetStateAction<number | null>>;
  setBypassPermissionsState: React.Dispatch<React.SetStateAction<boolean>>;

  // Shared callbacks
  endTurnUi: () => void;
  isCrewEventForCurrentSession: () => boolean;
}

// ─── Event Handler Context ───
// Bundles every ref/setter/helper the dispatch handlers need so they can live
// at module level (testable, created once) instead of inside the useEffect closure.
interface EventHandlerContext {
  // State values (stale — captured in useEffect closure with [] deps, same as before)
  crewList: Crew[];
  turnActivity: { stage: string; step: number; elapsedMs: number } | null;

  // Shared refs
  isInitialLoadRef: React.MutableRefObject<boolean>;
  turnActiveRef: React.MutableRefObject<boolean>;
  outgoingTurnRef: React.MutableRefObject<{ userId: string; userContent: string; placeholderId: string } | null>;
  resendInProgressRef: React.MutableRefObject<boolean>;
  lastTurnFeedbackCandidateRef: React.MutableRefObject<{ messageId: string; elapsedMs: number } | null>;
  currentSessionIdRef: React.MutableRefObject<string | null>;
  isCrewPrivateRef: React.MutableRefObject<boolean>;
  crewPrivateHostRef: React.MutableRefObject<{ name: string; callsign: string; title?: string } | null>;
  crewMissionSessionIdRef: React.MutableRefObject<string | null>;
  crewSuggestionHandledRef: React.MutableRefObject<boolean>;
  crewGateInFlightRef: React.MutableRefObject<boolean>;
  attachCrewRosterPickerRef: React.MutableRefObject<(
    text: string,
    evaluation: CrewSuggestionEvaluation,
    opts?: { userMessageId?: string; evalAssistantMessageId?: string },
  ) => Promise<boolean>>;
  rateLimitSeenRef: React.MutableRefObject<boolean>;
  tokenInputRef: React.MutableRefObject<number>;
  tokenOutputRef: React.MutableRefObject<number>;
  tokenReservedRef: React.MutableRefObject<number>;
  refreshContextRef: React.MutableRefObject<(() => void) | null>;

  // Telemetry-only refs
  streamChunkRAFRef: React.MutableRefObject<number | null>;
  streamChunkPendingRef: React.MutableRefObject<string | null>;
  thinkingPendingRef: React.MutableRefObject<string>;
  thinkingFlushRef: React.MutableRefObject<number | null>;
  providerErrorTimerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>;
  toolBatchRef: React.MutableRefObject<TelemetryEvent[]>;
  toolFlushRef: React.MutableRefObject<number | null>;

  // Setters
  setMessages: React.Dispatch<React.SetStateAction<UIMessage[]>>;
  setStreaming: React.Dispatch<React.SetStateAction<boolean>>;
  setTurnActivity: React.Dispatch<React.SetStateAction<{ stage: string; step: number; elapsedMs: number } | null>>;
  setCurrentStep: React.Dispatch<React.SetStateAction<string | null>>;
  setTokenStreaming: React.Dispatch<React.SetStateAction<number>>;
  setTokenUsed: React.Dispatch<React.SetStateAction<number>>;
  setLoadingSteps: React.Dispatch<React.SetStateAction<Array<{ id: string; label: string; status: string }> | null>>;
  setWarnings: React.Dispatch<React.SetStateAction<string[]>>;
  setStepCapPrompt: React.Dispatch<React.SetStateAction<{ currentSteps: number; maxSteps: number } | null>>;
  setPermissionPrompt: React.Dispatch<React.SetStateAction<{ requestId: string; tool: string; path: string; riskLevel: string; integrationPreview?: IntegrationActionPreview; forAutomation?: boolean } | null>>;
  setPendingPermissionCount: React.Dispatch<React.SetStateAction<number>>;
  setCrewWorkers: React.Dispatch<React.SetStateAction<CrewWorkerState[]>>;
  setCrewMissionActive: React.Dispatch<React.SetStateAction<boolean>>;
  setCrewMissionId: React.Dispatch<React.SetStateAction<string | null>>;
  setCrewInterMessages: React.Dispatch<React.SetStateAction<CrewInterMessage[]>>;
  setTokenTotal: React.Dispatch<React.SetStateAction<number>>;
  setCompactionCount: React.Dispatch<React.SetStateAction<number>>;
  setBypassPermissionsState: React.Dispatch<React.SetStateAction<boolean>>;

  // Callbacks & helpers
  isCrewEventForCurrentSession: () => boolean;
  stopTurnIndicator: () => void;
  ensureOutgoingTurnMessages: (prev: UIMessage[]) => UIMessage[];
  isAgentRecentlyActive: (withinMs?: number) => boolean;
  applyToolEvent: (prev: UIMessage[], ev: TelemetryEvent) => UIMessage[];
  applySubagentToolEvent: (prev: UIMessage[], ev: TelemetryEvent) => UIMessage[];
  applyTokenUsageEvent: (ev: TelemetryEvent) => void;
}

// ─── Early-return handlers (special control flow: RAF batching, standalone setMessages) ───

/** Sync voice-only user turns that text chat didn't add locally. */
const handleMessageSent = (ev: TelemetryEvent, ctx: EventHandlerContext): void => {
  if (ctx.isInitialLoadRef.current) return;
  const msg = ev.message as { id?: string; content?: string; role?: string } | undefined;
  const text = typeof msg?.content === 'string' ? msg.content.trim() : '';
  if (!text || msg?.role !== 'user') return;
  // Text chat already added the user bubble locally — only sync voice-only turns.
  ctx.setMessages((prev) => {
    if (prev.some((m) => m.role === 'user' && m.content === text)) return prev;
    return [
      ...prev,
      {
        id: msg?.id ?? crypto.randomUUID(),
        role: 'user',
        content: text,
        streaming: false,
        voiceInput: true,
      },
    ];
  });
};

/** RAF-batch high-frequency tool + subagent tool events to prevent render storms. */
const handleToolBatchEvent = (ev: TelemetryEvent, ctx: EventHandlerContext): void => {
  // Ignore stale tool events replayed from telemetry buffer on page load
  if (ctx.isInitialLoadRef.current) return;
  ctx.toolBatchRef.current.push(ev);
  if (ctx.toolFlushRef.current === null) {
    ctx.toolFlushRef.current = requestAnimationFrame(() => {
      ctx.toolFlushRef.current = null;
      const batch = ctx.toolBatchRef.current;
      ctx.toolBatchRef.current = [];
      if (batch.length === 0) return;
      // Replace the current step line with the latest activity in this batch.
      for (let i = batch.length - 1; i >= 0; i--) {
        const e = batch[i]!;
        const src = e.type === 'subagent_event'
          ? (e as { parentEvent?: { type?: string; tool?: string } }).parentEvent
          : e;
        const toolName = (src?.tool as string) ?? '';
        if (!toolName) continue;
        if (src?.type === 'tool_executing') { ctx.setCurrentStep(`Running ${toolName}…`); break; }
        if (src?.type === 'tool_complete') { ctx.setCurrentStep(`${toolName} · done`); break; }
        if (src?.type === 'tool_output') { ctx.setCurrentStep(`Running ${toolName}…`); break; }
      }
      ctx.setMessages(prev => {
        let current = prev;
        for (const e of batch) {
          current = e.type === 'subagent_event'
            ? ctx.applySubagentToolEvent(current, e)
            : ctx.applyToolEvent(current, e);
        }
        const last = current[current.length - 1];
        if (last?.parts?.length) {
          const dedupedParts = dedupeToolParts(last.parts as MessagePart[]);
          if (dedupedParts !== last.parts) {
            current = updateLastMessage(current, { parts: dedupedParts as PartEntry[] });
          }
        }
        return current;
      });
    });
  }
};

/** Route subagent events: tool subevents go through RAF batch, others are no-ops. */
const handleSubagentEvent = (ev: TelemetryEvent, ctx: EventHandlerContext): void => {
  const isSubagentTool = ['tool_executing', 'tool_output', 'tool_complete'].includes(
    String((ev as { parentEvent?: { type?: string } }).parentEvent?.type ?? ''),
  );
  if (isSubagentTool) {
    handleToolBatchEvent(ev, ctx);
  }
  // Non-tool subagent events are no-ops (previously: case 'subagent_event': return prev;)
};

/** Apply token usage metrics and sync turn token count on the assistant message. */
const handleTokenUsage = (ev: TelemetryEvent, ctx: EventHandlerContext): void => {
  ctx.applyTokenUsageEvent(ev);
  ctx.setMessages((prev) => {
    const last = prev[prev.length - 1];
    if (last?.role !== 'assistant') return prev;
    const turn = ev.turnTokens as number | undefined;
    if (turn != null) return updateLastMessage(prev, { turnTokens: turn });
    return prev;
  });
};

/** Update the loading steps indicator (multi-step progress display). */
const handleLoadingStepUpdate = (ev: TelemetryEvent, ctx: EventHandlerContext): void => {
  ctx.setLoadingSteps((prevSteps) => {
    const step = {
      id: String(ev.stepId ?? ''),
      label: coerceDisplayLabel(ev.label, 'Working...'),
      status: String(ev.status ?? 'pending'),
    };
    if (!prevSteps) return [step];
    const exists = prevSteps.some((s) => s.id === step.id);
    if (!exists) return [...prevSteps, step];
    return prevSteps.map((s) =>
      s.id === step.id ? { ...s, status: step.status, label: step.label } : s,
    );
  });
};

// ─── Loading & streaming handlers ───

/** Create or reuse the streaming assistant placeholder when a turn starts. */
const handleLoadingStart = (ev: TelemetryEvent, ctx: EventHandlerContext): void => {
  ctx.setMessages((prev) => {
    const last = prev[prev.length - 1];
    // Ignore stale loading_start events replayed from telemetry buffer on page load
    if (ctx.isInitialLoadRef.current) { return prev; }
    if (!ctx.turnActiveRef.current) return prev;
    ctx.streamChunkPendingRef.current = null;
    if (ctx.streamChunkRAFRef.current !== null) {
      clearTimeout(ctx.streamChunkRAFRef.current);
      ctx.streamChunkRAFRef.current = null;
    }
    ctx.thinkingPendingRef.current = '';
    if (ctx.thinkingFlushRef.current !== null) {
      clearTimeout(ctx.thinkingFlushRef.current);
      ctx.thinkingFlushRef.current = null;
    }
    ctx.setLoadingSteps(null);
    const loadingStage = (ev as { stage?: string }).stage;
    // Crew missions / private chats stream crew-attributed messages — no Agent-X placeholder
    if (loadingStage === 'crew_mission' || loadingStage === 'crew_private') {
      ctx.setStreaming(true);
      if (loadingStage === 'crew_mission') return prev;
      if (last?.role === 'user' && ctx.isCrewPrivateRef.current && ctx.crewPrivateHostRef.current) {
        const host = ctx.crewPrivateHostRef.current;
        return [...prev, {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: '',
          streaming: true,
          crew: { crewId: '', name: host.name, callsign: host.callsign },
        }];
      }
      if (lastMessageIsQuestionnaireCard(prev) && ctx.isCrewPrivateRef.current && last?.crew) {
        return [...prev, {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: '',
          streaming: true,
          crew: last.crew,
        }];
      }
      return prev;
    }
    if (lastMessageIsQuestionnaireCard(prev)) {
      ctx.setStreaming(true);
      return [...prev, {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: '',
        streaming: true,
        ...(last?.crew ? { crew: last.crew } : {}),
      }];
    }
    // Prefer the optimistic turn bubble (sync ref) so we never stream into a prior completed reply
    // when React hasn't committed executeSend's setMessages yet.
    const withOutgoing = ctx.ensureOutgoingTurnMessages(prev);
    if (withOutgoing !== prev) {
      ctx.setStreaming(true);
      return withOutgoing;
    }
    // Only create a placeholder when a user message just arrived (new turn).
    if (last?.role === 'user') {
      ctx.setStreaming(true);
      return [...prev, { id: crypto.randomUUID(), role: 'assistant', content: '', streaming: true }];
    }
    if (last?.role === 'assistant' && (last.streaming || ctx.resendInProgressRef.current)) {
      ctx.setStreaming(true);
      return prev;
    }
    // Completed assistant still last — start a fresh bubble (do not overwrite prior reply).
    if (last?.role === 'assistant' && !last.streaming) {
      ctx.setStreaming(true);
      return [...prev, { id: crypto.randomUUID(), role: 'assistant', content: '', streaming: true }];
    }
    if (!last) {
      ctx.setStreaming(true);
      return [...prev, { id: crypto.randomUUID(), role: 'assistant', content: '', streaming: true }];
    }
    ctx.setStreaming(true);
    return prev;
  });
};

/** Stream text deltas into the assistant bubble with ~12 fps RAF coalescing. */
const handleStreamChunk = (ev: TelemetryEvent, ctx: EventHandlerContext): void => {
  ctx.setMessages((prev) => {
    const last = prev[prev.length - 1];
    // Ignore stale stream chunks replayed from telemetry buffer on page load
    if (ctx.isInitialLoadRef.current) return prev;
    if (!ctx.turnActiveRef.current) return prev;
    ctx.setStreaming(true);
    ctx.setCurrentStep(null);
    const rawDelta = (ev.content as string) ?? '';
    if (/Calling:|✅ Result:|\[STEP \d+\]/.test(rawDelta)) return prev;
    const rawFull = (ev.fullContent as string) ?? '';
    if (!rawFull && !rawDelta) return prev;
    if (last?.role === 'assistant' && lastMessageIsQuestionnaireCard(prev)) {
      const textPart: PartEntry = { type: 'text', id: crypto.randomUUID(), content: rawFull || rawDelta };
      return [...prev, {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: rawFull || rawDelta,
        streaming: true,
        parts: [textPart],
        ...(last.crew ? { crew: last.crew } : {}),
      }];
    }
    // Never stream into a completed prior reply (race: chunks arrive before optimistic user bubble commits).
    if (last?.role === 'assistant' && !last.streaming) {
      const base = ctx.ensureOutgoingTurnMessages(prev);
      const tip = base[base.length - 1];
      if (tip?.role === 'assistant' && tip.streaming) {
        ctx.streamChunkPendingRef.current = rawFull || null;
        if (ctx.streamChunkRAFRef.current === null) {
          ctx.streamChunkRAFRef.current = window.setTimeout(() => {
            ctx.streamChunkRAFRef.current = null;
            const fullContent = ctx.streamChunkPendingRef.current ?? '';
            ctx.streamChunkPendingRef.current = null;
            if (!fullContent) return;
            ctx.setMessages(p => {
              const ensured = ctx.ensureOutgoingTurnMessages(p);
              const l = ensured[ensured.length - 1];
              if (l?.role !== 'assistant' || !l.streaming) return ensured;
              const parts = l.parts || [];
              const lastPart = parts[parts.length - 1];
              const textPart: PartEntry = lastPart?.type === 'text'
                ? { ...lastPart, content: fullContent }
                : { type: 'text', id: crypto.randomUUID(), content: fullContent };
              const updatedParts = lastPart?.type === 'text'
                ? [...parts.slice(0, -1), textPart]
                : [...parts, textPart];
              return updateLastMessage(ensured, { content: fullContent, parts: updatedParts, streaming: true });
            });
          }, 80);
        }
        return base;
      }
      const textPart: PartEntry = { type: 'text', id: crypto.randomUUID(), content: rawFull || rawDelta };
      return [...base, {
        id: ctx.outgoingTurnRef.current?.placeholderId || crypto.randomUUID(),
        role: 'assistant',
        content: rawFull || rawDelta,
        streaming: true,
        parts: [textPart],
      }];
    }
    if (last?.role === 'assistant') {
      ctx.streamChunkPendingRef.current = rawFull || null;
      if (ctx.streamChunkRAFRef.current === null) {
        // ~12 fps flush: markdown re-parses the full message on every
        // update, so a modest interval slashes CPU vs per-frame flushes
        // with no perceptible loss of streaming smoothness.
        ctx.streamChunkRAFRef.current = window.setTimeout(() => {
          ctx.streamChunkRAFRef.current = null;
          const fullContent = ctx.streamChunkPendingRef.current ?? '';
          ctx.streamChunkPendingRef.current = null;
          if (!fullContent) return;
          ctx.setMessages(p => {
            const l = p[p.length - 1];
            if (l?.role !== 'assistant') return p;
            const parts = l.parts || [];
            const lastPart = parts[parts.length - 1];
            const prefixEnd = lastPart?.type === 'text' ? parts.length - 1 : parts.length;
            let prefixLen = 0;
            for (let i = 0; i < prefixEnd; i++) {
              const part = parts[i];
              if (part?.type === 'text' && part.content) prefixLen += part.content.length;
            }
            const segmentText = fullContent.slice(prefixLen);
            if (lastPart?.type === 'text') {
              const updatedParts = [...parts.slice(0, -1), { ...lastPart, content: segmentText }];
              return updateLastMessage(p, { content: fullContent, parts: updatedParts, streaming: true });
            }
            const textPart: PartEntry = { type: 'text', id: crypto.randomUUID(), content: segmentText };
            return updateLastMessage(p, { content: fullContent, parts: [...parts, textPart], streaming: true });
          });
          const streamingEst = Math.ceil(fullContent.length / 4);
          ctx.setTokenStreaming(streamingEst);
          ctx.setTokenUsed(ctx.tokenInputRef.current + ctx.tokenOutputRef.current + streamingEst + ctx.tokenReservedRef.current);
        }, 80);
      }
      return prev;
    }
    ctx.setStreaming(true);
    const textPart: PartEntry = { type: 'text', id: crypto.randomUUID(), content: rawFull || rawDelta };
    return [...prev, { id: crypto.randomUUID(), role: 'assistant', content: rawFull || rawDelta, streaming: true, parts: [textPart] }];
  });
};

/** Clear loading steps; finalize crew workers if all done. */
const handleLoadingEnd = (_ev: TelemetryEvent, ctx: EventHandlerContext): void => {
  ctx.setMessages((prev) => {
    ctx.setLoadingSteps(null);
    ctx.setCrewWorkers((cw) => {
      if (cw.length > 0 && cw.every((x) => x.status === 'done' || x.status === 'error')) {
        ctx.setCrewMissionActive(false);
      }
      return cw;
    });
    // Keep streaming true until message_received — background work may still be running
    return prev;
  });
};

// ─── Message handlers ───

/** Finalize or merge the completed assistant message into the chat. */
const handleMessageReceived = (ev: TelemetryEvent, ctx: EventHandlerContext): void => {
  ctx.setMessages((prev) => {
    // Ignore stale message_received events replayed from telemetry buffer on page load
    if (ctx.isInitialLoadRef.current) return prev;
    const isUpdate = (ev as { isUpdate?: boolean }).isUpdate === true;
    const msg = ev.message as {
      id?: string;
      content?: string;
      role?: string;
      parts?: PartEntry[];
      toolCalls?: ToolCall[];
      crew?: { crewId: string; name: string; callsign: string; color?: string; icon?: string; confidence?: string; reasons?: string[] };
      tokenCount?: number;
    } | undefined;
    const crew = msg?.crew;
    const msgId = msg?.id || crypto.randomUUID();
    const hasQuestionnaire = msg?.parts?.some((p) => p.type === 'questionnaire');
    const hasCrewPicker = msg?.parts?.some((p) => p.type === 'crew_roster_picker');
    const questionnairePending = hasQuestionnaire
      && msg?.parts?.some((p) => p.type === 'questionnaire' && p.questionnaire?.status === 'pending');
    const crewPickerPending = hasCrewPicker
      && msg?.parts?.some((p) => p.type === 'crew_roster_picker' && p.crewRosterPicker?.status === 'pending');
    const interactionPending = questionnairePending || crewPickerPending;
    const turnContinues = isUpdate || interactionPending;

    if (!turnContinues) {
      ctx.stopTurnIndicator();
      if (msg?.role === 'assistant') {
        ctx.lastTurnFeedbackCandidateRef.current = {
          messageId: msgId,
          elapsedMs: (ev as { elapsed?: number }).elapsed ?? ctx.turnActivity?.elapsedMs ?? 0,
        };
      }
    } else {
      ctx.setTokenStreaming(0);
    }

    if (msgId && prev.some((m) => m.id === msgId)) {
      const idx = prev.findIndex((m) => m.id === msgId);
      if (idx >= 0 && msg) {
        if (isUpdate && !interactionPending) {
          ctx.setStreaming(true);
        } else if (interactionPending) {
          ctx.setStreaming(false);
        } else {
          ctx.setStreaming(false);
        }
        const text = repairStreamTextGlitches(stripToolNoise(msg.content ?? ''));
        const mergedParts = reconcileStreamingMessageParts(
          mergeIncomingMessageParts(prev[idx]!.parts, msg.parts) ?? prev[idx]!.parts,
          prev[idx]!.toolCalls ?? msg.toolCalls,
          msg.parts,
        );
        const updated: UIMessage = {
          ...prev[idx]!,
          content: text || prev[idx]!.content,
          parts: mergedParts,
          streaming: false,
          ...(crew ? { crew } : {}),
        };
        return [...prev.slice(0, idx), updated, ...prev.slice(idx + 1)];
      }
    }

    if (msg?.role === 'user' && msg.content?.trim()) {
      // User turns are added locally on send; engine emits message_sent, not message_received.
      ctx.setStreaming(false);
      return prev;
    }

    if (!msg || msg.role === 'system') return prev;
    const text = repairStreamTextGlitches(stripToolNoise(msg.content ?? ''));
    if (msg.role === 'assistant' && (hasQuestionnaire || hasCrewPicker)) {
      ctx.setStreaming(interactionPending ? false : true);
      const base = stripTrailingStreamPreamble(prev);
      return [...base, {
        id: msgId,
        role: 'assistant' as const,
        content: '',
        streaming: false,
        parts: msg.parts,
        timestamp: new Date().toISOString(),
        ...(crew ? { crew } : {}),
      } as UIMessage];
    }

    ctx.setStreaming(false);
    const withOutgoing = ctx.ensureOutgoingTurnMessages(prev);
    const tip = withOutgoing[withOutgoing.length - 1];
    if (tip?.role === 'assistant') {
      const incomingCrewId = crew?.crewId;
      const lastCrewId = tip.crew?.crewId;
      const crewPrivateMerge = ctx.isCrewPrivateRef.current && tip.streaming;
      const sameSpeaker = crewPrivateMerge
        || (incomingCrewId
          ? incomingCrewId === lastCrewId
          : !lastCrewId);
      const shouldMerge = sameSpeaker && tip.streaming;
      if (shouldMerge) {
        ctx.outgoingTurnRef.current = null;
        const mergedParts = reconcileStreamingMessageParts(
          (tip.parts && tip.parts.length > 0) ? tip.parts : msg.parts,
          tip.toolCalls?.length ? tip.toolCalls : msg.toolCalls,
          msg.parts,
        );
        return updateLastMessage(withOutgoing, {
          id: msg.id || tip.id,
          content: text || stripToolNoise(tip.content || ''),
          parts: mergedParts,
          toolCalls: tip.toolCalls?.length ? tip.toolCalls : msg.toolCalls,
          streaming: false,
          ...(crew ? { crew } : {}),
        });
      }
    }
    if (msg.role === 'assistant' && (text || msg.parts?.length)) {
      ctx.outgoingTurnRef.current = null;
      const msgId = msg.id || crypto.randomUUID();
      if (withOutgoing.some((m) => m.id === msgId)) return withOutgoing;
      const parts = msg.parts || [{ type: 'text' as const, id: crypto.randomUUID(), content: text }];
      return [...withOutgoing, { id: msgId, role: 'assistant' as const, content: text, streaming: false, parts, ...(crew ? { crew } : {}) } as UIMessage];
    }
    return withOutgoing;
  });
};

// ─── Permission & mode handlers ───

/** Show the permission prompt modal for risky tool operations. */
const handlePermissionRequired = (ev: TelemetryEvent, ctx: EventHandlerContext): void => {
  ctx.setMessages((prev) => {
    // Ignore stale permission prompts replayed from telemetry buffer on page load
    if (ctx.isInitialLoadRef.current) { return prev; }
    ctx.setPendingPermissionCount((prev) => prev + 1);
    ctx.setPermissionPrompt({
      requestId: (ev.requestId as string) ?? `${ev.tool}-${Date.now()}`,
      tool: (ev.tool as string) ?? 'unknown',
      path: (ev.path as string) ?? '',
      riskLevel: (ev.riskLevel as string) ?? 'medium',
      integrationPreview: ev.integrationPreview as IntegrationActionPreview | undefined,
      forAutomation: ev.forAutomation === true,
    });
    return prev;
  });
};

/** Update the bypass permissions toggle state when the engine broadcasts a change. */
const handleBypassPermissionsChanged = (ev: TelemetryEvent, ctx: EventHandlerContext): void => {
  ctx.setBypassPermissionsState(ev.enabled === true);
};

/** Show the crew suggestion / roster picker when the engine recommends a crew. */
const handleCrewSuggestion = (ev: TelemetryEvent, ctx: EventHandlerContext): void => {
  ctx.setMessages((prev) => {
    if (ctx.isInitialLoadRef.current) return prev;
    if (ctx.isCrewPrivateRef.current || ctx.crewSuggestionHandledRef.current || ctx.crewGateInFlightRef.current) {
      return prev;
    }
    const evaluation = (ev as { evaluation?: CrewSuggestionEvaluation }).evaluation;
    const message = (ev as { message?: string }).message;
    if (!evaluation || !message || !shouldOfferCrewRosterPicker(evaluation)) return prev;
    if (ev.type === 'crew_suggestion_required') ctx.setStreaming(false);
    ctx.crewSuggestionHandledRef.current = true;
    void ctx.attachCrewRosterPickerRef.current?.(message, evaluation);
    return prev;
  });
};

/** Show the step-cap prompt when the agent hits the maximum step count. */
const handleStepCapReached = (ev: TelemetryEvent, ctx: EventHandlerContext): void => {
  ctx.setMessages((prev) => {
    const currentSteps = (ev as { currentSteps?: number }).currentSteps ?? 25;
    const maxSteps = (ev as { maxSteps?: number }).maxSteps ?? 25;
    ctx.setStepCapPrompt({ currentSteps, maxSteps });
    return prev;
  });
};

// ─── Reasoning handlers ───

/** Coalesce reasoning/thinking tokens and flush at ~8 fps to avoid render storms. */
const handleReasoningDelta = (ev: TelemetryEvent, ctx: EventHandlerContext): void => {
  ctx.setMessages((prev) => {
    const last = prev[prev.length - 1];
    if (last?.role !== 'assistant') return prev;
    const delta = (ev.content as string) ?? (ev.text as string) ?? '';
    // Coalesce reasoning tokens — flushing per-delta causes a render
    // storm on reasoning-heavy models.
    ctx.thinkingPendingRef.current += delta;
    if (ctx.thinkingFlushRef.current === null) {
      ctx.thinkingFlushRef.current = window.setTimeout(() => {
        ctx.thinkingFlushRef.current = null;
        const pending = ctx.thinkingPendingRef.current;
        ctx.thinkingPendingRef.current = '';
        if (!pending) return;
        ctx.setMessages(p => {
          const l = p[p.length - 1];
          if (l?.role !== 'assistant') return p;
          const accumulated = (l.thinking ?? '') + pending;
          // Show only the latest thinking fragment as the step line (replaced each flush).
          const tail = accumulated.replace(/\s+/g, ' ').trim().slice(-110);
          if (tail) ctx.setCurrentStep(`Thinking… ${tail}`);
          return updateLastMessage(p, {
            thinking: accumulated,
            thinkingStartedAt: l.thinkingStartedAt ?? Date.now(),
          });
        });
      }, 120);
    }
    return prev;
  });
};

/** Mark the end of the reasoning/thinking phase. */
const handleReasoningEnd = (_ev: TelemetryEvent, ctx: EventHandlerContext): void => {
  ctx.setMessages((prev) => {
    const last = prev[prev.length - 1];
    return last?.role === 'assistant' && last.thinking ? updateLastMessage(prev, { thinkingDoneAt: Date.now() }) : prev;
  });
};

/** Show the agent's decision as a thinking-phase line on the streaming message. */
const handleDecisionMade = (ev: TelemetryEvent, ctx: EventHandlerContext): void => {
  ctx.setMessages((prev) => {
    const last = prev[prev.length - 1];
    // Show decision as thinking phase on the streaming assistant message
    if (last?.role !== 'assistant' || !last.streaming) return prev;
    const path = (ev.executionPath as string) ?? '';
    const cls = (ev.messageClass as string) ?? '';
    return updateLastMessage(prev, { thinking: `${cls} → ${path}` });
  });
};

// ─── Error handlers ───

/** Handle provider errors (rate limits, API failures) — suppress empty bubbles. */
const handleProviderError = (ev: TelemetryEvent, ctx: EventHandlerContext): void => {
  ctx.setMessages((prev) => {
    const last = prev[prev.length - 1];
    const providerMsg = (ev.message as string) ?? 'Provider error';
    const msg = providerMsg;
    // Rate-limit errors suppress all subsequent warnings for this turn
    if (/rate.?limit|429|too many requests|quota/i.test(providerMsg)) {
      ctx.rateLimitSeenRef.current = true;
    }
    ctx.setWarnings(prev => replaceWarning(prev, msg));
    if (ctx.providerErrorTimerRef.current) clearTimeout(ctx.providerErrorTimerRef.current);
    ctx.setStreaming(false);
    if (last?.role === 'assistant' && last.streaming && !last.content && !last.toolCalls?.length) {
      return prev.slice(0, -1);
    }
    if (last?.role !== 'assistant') return prev;
    return updateLastMessage(prev, { streaming: false });
  });
};

/** Stop streaming — the engine needs clarification from the user. */
const handleClarificationRequired = (_ev: TelemetryEvent, ctx: EventHandlerContext): void => {
  ctx.setMessages((prev) => {
    ctx.setStreaming(false);
    return prev;
  });
};

/** Strip the trailing stream preamble from the message list. */
const handleStreamClear = (_ev: TelemetryEvent, ctx: EventHandlerContext): void => {
  ctx.setMessages((prev) => stripTrailingStreamPreamble(prev));
};

/** Route errors to the warning band — suppress cascaded errors after rate-limit. */
const handleError = (ev: TelemetryEvent, ctx: EventHandlerContext): void => {
  ctx.setMessages((prev) => {
    const last = prev[prev.length - 1];
    // Suppress cascaded errors after a rate-limit — only show the first warning
    if (ctx.rateLimitSeenRef.current) {
      ctx.setStreaming(false);
      return prev;
    }
    const errorText = (ev.message as string) ?? (ev.error as string) ?? 'Unknown error';
    // Ignore stale timeout errors while the agent is still actively working
    if (isTimeoutWarning(errorText) && ctx.isAgentRecentlyActive()) {
      return prev;
    }
    // Route to warning band — errors should not pollute the chat bubble
    ctx.setWarnings(prev => replaceWarning(prev, errorText));
    ctx.setStreaming(false);
    if (last?.role === 'assistant' && last.streaming && !last.content && !last.toolCalls?.length) {
      return prev.slice(0, -1);
    }
    if (last?.role !== 'assistant') return prev;
    return updateLastMessage(prev, { streaming: false });
  });
};

// ─── Turn & activity handlers ───

/** Update the turn activity indicator (stage/step/elapsed) on heartbeat. */
const handleTurnHeartbeat = (ev: TelemetryEvent, ctx: EventHandlerContext): void => {
  ctx.setMessages((prev) => {
    if (!ctx.turnActiveRef.current) return prev;
    ctx.setTurnActivity({
      stage: (ev as { stage?: string }).stage ?? 'working',
      step: (ev as { step?: number }).step ?? 0,
      elapsedMs: (ev as { elapsedMs?: number }).elapsedMs ?? 0,
    });
    ctx.setStreaming(true);
    ctx.setWarnings(clearTimeoutWarnings);
    return prev;
  });
};

/** React to turn phase changes (running, awaiting permission, done, etc.). */
const handleTurnState = (ev: TelemetryEvent, ctx: EventHandlerContext): void => {
  ctx.setMessages((prev) => {
    const phase = (ev as { phase?: string }).phase;
    if (phase === 'running') {
      if (ctx.turnActiveRef.current) ctx.setStreaming(true);
    } else if (phase === 'awaiting_permission' || phase === 'awaiting_plan'
      || phase === 'awaiting_mode' || phase === 'awaiting_step_cap') {
      ctx.setStreaming(false);
    } else if (phase === 'done' || phase === 'cancelled' || phase === 'idle') {
      ctx.stopTurnIndicator();
      ctx.setPermissionPrompt(null);
      ctx.setPendingPermissionCount(0);
    }
    return prev;
  });
};

/** Clear permission prompts and stop the turn indicator on task abort. */
const handleTaskAborted = (_ev: TelemetryEvent, ctx: EventHandlerContext): void => {
  ctx.setMessages((prev) => {
    ctx.setPermissionPrompt(null);
    ctx.setPendingPermissionCount(0);
    ctx.stopTurnIndicator();
    return prev;
  });
};

// ─── Operation handlers ───

/** Apply file/search/command operation events to the assistant message. */
const handleOperationEvent = (ev: TelemetryEvent, ctx: EventHandlerContext): void => {
  ctx.setMessages((prev) => applyOperationEventToAssistant(prev, ev as Record<string, unknown> & { type: string }));
};

// ─── Crew handlers ───

/** Start a crew mission — reset worker/inter-message state. */
const handleCrewMissionStart = (ev: TelemetryEvent, ctx: EventHandlerContext): void => {
  ctx.setMessages((prev) => {
    const sid = ctx.currentSessionIdRef.current;
    if (!sid) return prev;
    ctx.crewMissionSessionIdRef.current = sid;
    ctx.setCrewMissionActive(true);
    ctx.setCrewWorkers([]);
    ctx.setCrewInterMessages([]);
    ctx.setCrewMissionId((ev.missionId as string | undefined) ?? null);
    return prev;
  });
};

/** Complete a crew mission — mark all running workers as done. */
const handleCrewMissionComplete = (_ev: TelemetryEvent, ctx: EventHandlerContext): void => {
  ctx.setMessages((prev) => {
    if (!ctx.isCrewEventForCurrentSession()) return prev;
    ctx.setCrewMissionActive(false);
    ctx.setCrewWorkers((cw) => cw.map((x) =>
      (x.status === 'running' || x.status === 'verifying' || x.status === 'retrying')
        ? { ...x, status: 'done' as const, message: 'Complete' }
        : x,
    ));
    return prev;
  });
};

/** Add an inter-crew message to the mission panel. */
const handleCrewInterMessage = (ev: TelemetryEvent, ctx: EventHandlerContext): void => {
  ctx.setMessages((prev) => {
    if (!ctx.isCrewEventForCurrentSession()) return prev;
    const from = ev.from as string;
    const to = ev.to as string;
    const content = ev.content as string;
    ctx.setCrewInterMessages((msgs) => [...msgs, {
      id: crypto.randomUUID(),
      from,
      to,
      content,
      timestamp: new Date().toISOString(),
    }]);
    return prev;
  });
};

/** Mark all crew workers as retrying. */
const handleCrewMissionRetry = (_ev: TelemetryEvent, ctx: EventHandlerContext): void => {
  ctx.setMessages((prev) => {
    if (!ctx.isCrewEventForCurrentSession()) return prev;
    ctx.setCrewWorkers((cw) => cw.map((x) => ({ ...x, status: 'retrying' as const, message: 'Retrying…' })));
    return prev;
  });
};

/** Register a newly spawned crew worker. */
const handleCrewWorkerSpawned = (ev: TelemetryEvent, ctx: EventHandlerContext): void => {
  ctx.setMessages((prev) => {
    if (!ctx.isCrewEventForCurrentSession()) return prev;
    const workerId = ev.workerId as string;
    const crewId = ev.crewId as string;
    const crewName = ev.crewName as string;
    const callsign = ev.callsign as string;
    const color = ctx.crewList.find((c) => c.id === crewId)?.color;
    ctx.setCrewWorkers((cw) => [...cw.filter((x) => x.workerId !== workerId), {
      workerId,
      crewId,
      crewName,
      callsign,
      color,
      status: 'running',
      message: 'Starting…',
    }]);
    return prev;
  });
};

/** Update a crew worker's progress/status. */
const handleCrewWorkerProgress = (ev: TelemetryEvent, ctx: EventHandlerContext): void => {
  ctx.setMessages((prev) => {
    if (!ctx.isCrewEventForCurrentSession()) return prev;
    const workerId = ev.workerId as string;
    const status = ev.status as CrewWorkerState['status'];
    const message = ev.message as string | undefined;
    ctx.setCrewWorkers((cw) => cw.map((x) =>
      x.workerId === workerId ? { ...x, status, message: message ?? x.message } : x,
    ));
    return prev;
  });
};

/** Complete a crew worker — mark done/error and finalize mission if all done. */
const handleCrewWorkerComplete = (ev: TelemetryEvent, ctx: EventHandlerContext): void => {
  ctx.setMessages((prev) => {
    if (!ctx.isCrewEventForCurrentSession()) return prev;
    const workerId = ev.workerId as string;
    const success = ev.success as boolean;
    const elapsed = ev.elapsed as number;
    ctx.setCrewWorkers((cw) => {
      const updated = cw.map((x) =>
        x.workerId === workerId
          ? {
            ...x,
            status: success ? 'done' as const : 'error' as const,
            elapsed,
            message: success ? 'Complete' : 'Failed',
          }
          : x,
      );
      if (updated.length > 0 && updated.every((x) => x.status === 'done' || x.status === 'error')) {
        ctx.setCrewMissionActive(false);
      }
      return updated;
    });
    return prev;
  });
};

// ─── Agent & session handlers ───

/** Attach a child session card to the assistant message (sub-agent or crew worker). */
const handleChildSessionStarted = (ev: TelemetryEvent, ctx: EventHandlerContext): void => {
  ctx.setMessages((prev) => {
    const childSessionId = ev.childSessionId as string;
    const label = ev.label as string;
    const kind = ev.kind as 'sub_agent' | 'crew_worker';
    if (!childSessionId) return prev;
    // Crew mission panel above the input already tracks workers — skip duplicate inline cards.
    if (kind === 'crew_worker') return prev;
    return attachChildSessionToAssistant(prev, childSessionId, label || 'Background work', kind ?? 'sub_agent');
  });
};

/** Attach a sub-agent card to the assistant message. */
const handleAgentSpawned = (ev: TelemetryEvent, ctx: EventHandlerContext): void => {
  ctx.setMessages((prev) => {
    const agentId = ev.agentId as string;
    const task = (ev.task as string) ?? '';
    if (!agentId) return prev;
    return attachChildSessionToAssistant(prev, agentId, 'Sub-Agent', 'sub_agent', task.slice(0, 200));
  });
};

/** Handle command actions (e.g. model switched — update context window). */
const handleCommandAction = (ev: TelemetryEvent, ctx: EventHandlerContext): void => {
  ctx.setMessages((prev) => {
    const action = ev.action as string | undefined;
    if (action === 'model_switched') {
      const cw = ev.contextWindow as number | undefined;
      if (cw != null && cw > 0) ctx.setTokenTotal(cw);
    }
    return prev;
  });
};

/** Increment compaction count and refresh context. */
const handleCompactionComplete = (_ev: TelemetryEvent, ctx: EventHandlerContext): void => {
  ctx.setMessages((prev) => {
    ctx.setCompactionCount(c => c + 1);
    ctx.refreshContextRef.current?.();
    return prev;
  });
};

/** No-op handler for events that don't require any state update. */
const noopHandler = (_ev: TelemetryEvent, _ctx: EventHandlerContext): void => {};

// ─── Telemetry event dispatch table ───
// Maps each event type to its handler function. Handlers receive the event and a
// context object bundling every ref/setter/helper they need (see EventHandlerContext).
const telemetryDispatch: Record<string, (ev: TelemetryEvent, ctx: EventHandlerContext) => void> = {
  // Early-return / special control flow
  message_sent: handleMessageSent,
  tool_executing: handleToolBatchEvent,
  tool_output: handleToolBatchEvent,
  tool_complete: handleToolBatchEvent,
  subagent_event: handleSubagentEvent,
  token_usage: handleTokenUsage,
  loading_step_update: handleLoadingStepUpdate,

  // Loading & streaming
  loading_start: handleLoadingStart,
  stream_chunk: handleStreamChunk,
  loading_end: handleLoadingEnd,

  // Messages
  message_received: handleMessageReceived,

  // Permission & mode
  permission_required: handlePermissionRequired,
  bypass_permissions_changed: handleBypassPermissionsChanged,
  crew_suggestion: handleCrewSuggestion,
  crew_suggestion_required: handleCrewSuggestion,
  step_cap_reached: handleStepCapReached,

  // Reasoning
  reasoning_delta: handleReasoningDelta,
  thinking_delta: handleReasoningDelta,
  reasoning_end: handleReasoningEnd,
  thinking_end: handleReasoningEnd,
  decision_made: handleDecisionMade,

  // Errors
  provider_error: handleProviderError,
  clarification_required: handleClarificationRequired,
  stream_clear: handleStreamClear,
  error: handleError,

  // Turn & activity
  turn_heartbeat: handleTurnHeartbeat,
  turn_state: handleTurnState,
  task_aborted: handleTaskAborted,

  // Operations
  operation_file_edited: handleOperationEvent,
  operation_file_created: handleOperationEvent,
  operation_file_read: handleOperationEvent,
  operation_search_glob: handleOperationEvent,
  operation_search_grep: handleOperationEvent,
  operation_list_files: handleOperationEvent,
  operation_command_executed: handleOperationEvent,

  // Crew
  crew_mission_start: handleCrewMissionStart,
  crew_mission_complete: handleCrewMissionComplete,
  crew_inter_message: handleCrewInterMessage,
  crew_mission_retry: handleCrewMissionRetry,
  crew_worker_spawned: handleCrewWorkerSpawned,
  crew_worker_progress: handleCrewWorkerProgress,
  crew_worker_complete: handleCrewWorkerComplete,

  // Agent & session
  child_session_started: handleChildSessionStarted,
  agent_spawned: handleAgentSpawned,

  // Misc
  command_action: handleCommandAction,
  compaction_complete: handleCompactionComplete,
  agent_thinking: noopHandler,
  step_indicator: noopHandler,
};


export function useChatTelemetry(params: UseChatTelemetryParams): void {
  const {
    streaming, crewList, turnActivity,
    isInitialLoadRef, turnActiveRef, activeTurnIdRef, outgoingTurnRef, resendInProgressRef,
    lastTurnFeedbackCandidateRef, viewSessionIdRef, currentSessionIdRef, isCrewPrivateRef,
    crewPrivateHostRef, crewMissionSessionIdRef, crewSuggestionHandledRef, crewGateInFlightRef,
    attachCrewRosterPickerRef, rateLimitSeenRef, tokenInputRef, tokenOutputRef, tokenReservedRef,
    refreshContextRef,
    setMessages, setStreaming, setTurnActivity, setCurrentStep, setTokenStreaming, setTokenUsed,
    setLoadingSteps, setWarnings, setStepCapPrompt, setPermissionPrompt,
    setPendingPermissionCount, setCrewWorkers, setCrewMissionActive, setCrewMissionId,
    setCrewInterMessages, setTokenInput, setTokenOutput, setTokenReserved, setTokenTotal,
    setCompactionCount, setToolEnablePrompt, setConnState,
    setLastEventAt, setBypassPermissionsState,
    endTurnUi, isCrewEventForCurrentSession,
  } = params;

  // ─── Telemetry-only refs ───
  const disconnectRef = useRef<(() => void) | null>(null);
  const streamChunkRAFRef = useRef<number | null>(null);
  const streamChunkPendingRef = useRef<string | null>(null);
  const thinkingPendingRef = useRef<string>('');
  const thinkingFlushRef = useRef<number | null>(null);
  const lastActivityRef = useRef<number>(Date.now());
  const lastEventAtWrittenRef = useRef(0);
  const providerErrorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // RAF-batched tool event accumulator (prevents render storm on long-running tasks)
  const toolBatchRef = useRef<TelemetryEvent[]>([]);
  const toolFlushRef = useRef<number | null>(null);

  const isAgentRecentlyActive = useCallback((withinMs = 45000) => Date.now() - lastActivityRef.current < withinMs, []);

  /** Ensure the optimistic user + streaming placeholder exist even if WS events beat React state. */
  const ensureOutgoingTurnMessages = useCallback((prev: UIMessage[]): UIMessage[] => {
    const pending = outgoingTurnRef.current;
    if (!pending) return prev;
    let next = prev;
    const hasUser = next.some((m) => m.id === pending.userId
      || (m.role === 'user' && m.content === pending.userContent));
    if (!hasUser) {
      next = [...next, {
        id: pending.userId,
        role: 'user' as const,
        content: pending.userContent,
        streaming: false,
      }];
    }
    const hasPlaceholder = next.some((m) => m.id === pending.placeholderId);
    const last = next[next.length - 1];
    if (!hasPlaceholder && !(last?.role === 'assistant' && last.streaming)) {
      next = [...next, {
        id: pending.placeholderId,
        role: 'assistant' as const,
        content: '',
        streaming: true,
      }];
    }
    return next;
  }, [outgoingTurnRef]);

  // Connect SSE for streaming events
  useEffect(() => {
    const stopTurnIndicator = () => {
      turnActiveRef.current = false;
      activeTurnIdRef.current = null;
      outgoingTurnRef.current = null;
      resendInProgressRef.current = false;
      setStreaming(false);
      setTurnActivity(null);
      setTokenStreaming(0);
    };

    // Pure function to apply a single tool event to messages state (used by RAF batch)
    const applyToolEvent = (prev: UIMessage[], ev: TelemetryEvent): UIMessage[] => {
      const last = prev[prev.length - 1];
      if (last?.role !== 'assistant') return prev;
      switch (ev.type) {
        case 'tool_executing': {
          const toolName = (ev.tool as string) ?? 'unknown';
          const desc = (ev.description as string) ?? '';
          const eventArgs = (ev.args as Record<string, unknown> | string | undefined) ?? desc;
          const existingParts = last.parts || [];
          let callId = (ev.callId as string) ?? '';
          if (!callId) {
            const running = existingParts.find(
              (p) => p.type === 'tool' && p.tool?.name === toolName && p.tool.status === 'running',
            );
            callId = running?.tool?.id
              ?? `tool-${toolName}-${existingParts.filter((p) => p.type === 'tool' && p.tool?.name === toolName).length}`;
          }
          if (toolName === 'delegate_to_subagent') {
            if ((last.subAgents ?? []).some((a) => a.id === callId)) return prev;
            const sa: SubAgent = { id: callId, name: 'Sub-Agent', task: desc, status: 'running' };
            const saPart: PartEntry = { type: 'subagent', id: callId, agent: sa };
            return updateLastMessage(prev, {
              subAgents: [...(last.subAgents ?? []), sa],
              parts: [...(last.parts || []), saPart],
            });
          }
          if (existingParts.some((p) => p.type === 'tool' && p.tool?.id === callId)) return prev;
          if (!last.streaming && existingParts.some((p) => p.type === 'tool' && p.tool?.name === toolName && p.tool.status === 'done')) {
            return prev;
          }
          const tc: ToolCall = { id: callId, name: toolName, args: eventArgs, status: 'running' };
          const toolPart: PartEntry = { type: 'tool', id: callId, tool: tc };
          const priorToolCalls = (last.toolCalls ?? []).filter((t) => t.id !== callId);
          return updateLastMessage(prev, { toolCalls: [...priorToolCalls, tc], parts: [...existingParts, toolPart] });
        }
        case 'tool_output': {
          const outputCallId = (ev.callId as string) ?? '';
          const outputText = (ev.output as string) ?? '';
          if (!outputCallId || !outputText) return prev;
          const newParts = (last.parts || []).map((p: PartEntry) =>
            p.type === 'tool' && p.tool?.id === outputCallId && p.tool?.status === 'running'
              ? { ...p, tool: { ...p.tool, streamOutput: (p.tool.streamOutput || '') + outputText } } : p);
          const newToolCalls = (last.toolCalls || []).map((t: ToolCall) =>
            t.id === outputCallId && t.status === 'running'
              ? { ...t, streamOutput: (t.streamOutput || '') + outputText } : t);
          const matched = newToolCalls.find((t) => t.id === outputCallId);
          let partsWithSearch = newParts;
          if (matched?.name === 'deep_web_search') {
            const progress = parseDeepSearchProgressLine(outputText.trim())
              ?? parseDeepSearchProgressFromStream(matched.streamOutput);
            if (progress) {
              partsWithSearch = upsertDeepSearchPartEntry(newParts, {
                toolCallId: outputCallId,
                progress,
                running: true,
              });
            }
          }
          return updateLastMessage(prev, { toolCalls: newToolCalls, parts: partsWithSearch });
        }
        case 'tool_complete': {
          const toolName = (ev.tool as string) ?? '';
          const elapsed = (ev.elapsed as number) ?? 0;
          const callId = (ev.callId as string) ?? '';
          const result = ev.result ?? (ev.output as string) ?? '';
          const resultStr: string = typeof result === 'string' ? result
            : (result && typeof result === 'object' ? String((result as Record<string, unknown>).output || (result as Record<string, unknown>).message || JSON.stringify(result)) : '');
          if (toolName === 'delegate_to_subagent' && last.subAgents) {
            const newSubAgents = last.subAgents.map((a: SubAgent) =>
              a.status !== 'running' ? a : { ...a, status: 'done' as const, result: resultStr });
            const newParts = (last.parts || []).map((p: PartEntry) =>
              p.type === 'subagent' && p.agent?.id === callId
                ? { ...p, agent: { ...p.agent!, status: 'done' as const, result: resultStr } } : p);
            return updateLastMessage(prev, { subAgents: newSubAgents, parts: newParts });
          }
          const newToolCalls = (last.toolCalls || []).map((t: ToolCall) => {
            if (callId && t.id !== callId) return t;
            if (!callId && (t.name !== toolName || t.status !== 'running')) return t;
            return { ...t, status: 'done' as const, result: resultStr, elapsed };
          });
          const newParts = (last.parts || []).map((p: PartEntry) => {
            if (p.type === 'tool' && p.tool) {
              if (callId && p.tool.id !== callId) return p;
              if (!callId && (p.tool.name !== toolName || p.tool.status !== 'running')) return p;
              return { ...p, tool: { ...p.tool, status: 'done' as const, result: resultStr, elapsed } };
            }
            return p;
          });
          const resultRaw = ev.result;
          const resObj = typeof resultRaw === 'object' && resultRaw !== null ? resultRaw as Record<string, unknown> : null;
          const meta = (ev.metadata ?? resObj?.metadata) as Record<string, unknown> | undefined;
          if (resObj?.error === 'TOOL_NOT_FOUND' || resObj?.error === 'NO_HANDLER') setToolEnablePrompt({ toolId: toolName, toolName });
          let finalParts = newParts.map((p) => (
            p.type === 'tool' && p.tool
              ? { ...p, tool: applyToolCompleteMetadata(p.tool, meta, callId, toolName) }
              : p
          ));
          const toolCallsWithMeta = newToolCalls.map((t) => applyToolCompleteMetadata(t, meta, callId, toolName));
          if (toolName === 'deep_web_search') {
            const resolvedId = callId || finalParts.find((p) => p.type === 'tool' && p.tool?.name === 'deep_web_search')?.tool?.id;
            if (resolvedId) {
              const bundle = deepSearchBundleFromMetadata(meta);
              const progress = (meta?.deepSearchProgress as import('@agentx/shared/browser').DeepSearchProgress | undefined);
              finalParts = upsertDeepSearchPartEntry(finalParts, {
                toolCallId: resolvedId,
                bundle,
                progress,
                running: !bundle,
              });
            }
          }
          if (toolName === 'render_chart') {
            const resolvedId = callId || finalParts.find((p) => p.type === 'tool' && p.tool?.name === 'render_chart')?.tool?.id;
            const spec = meta?.chartSpec;
            if (resolvedId && spec && typeof spec === 'object' && !finalParts.some((p) => p.type === 'chart' && p.id === resolvedId)) {
              finalParts = [...finalParts, { type: 'chart', id: resolvedId, chartJson: JSON.stringify(spec) }];
            }
          }
          return updateLastMessage(prev, {
            toolCalls: toolCallsWithMeta,
            parts: finalParts,
          });
        }
        default:
          return prev;
      }
    };

    const applySubagentToolEvent = (prev: UIMessage[], ev: TelemetryEvent): UIMessage[] => {
      const last = prev[prev.length - 1];
      const subagentId = (ev as { subagentId?: string }).subagentId as string;
      const parentEvent = (ev as { parentEvent?: Record<string, unknown> }).parentEvent;
      if (!subagentId || !parentEvent || !last?.subAgents) return prev;
      switch (parentEvent.type) {
        case 'tool_executing': {
          const toolName = (parentEvent.tool as string) ?? 'unknown';
          const desc = (parentEvent.description as string) ?? '';
          const eventArgs = parentEvent.args ?? desc;
          const callId = (parentEvent.callId as string) ?? crypto.randomUUID();
          const tc: ToolCall = { id: callId, name: toolName, args: eventArgs as ToolCall['args'], status: 'running' };
          const newSubAgents = last.subAgents.map((a: SubAgent) =>
            a.id !== subagentId ? a : { ...a, toolCalls: [...(a.toolCalls || []), tc] });
          return updateLastMessage(prev, { subAgents: newSubAgents });
        }
        case 'tool_output': {
          const outputCallId = (parentEvent.callId as string) ?? '';
          const outputText = (parentEvent.output as string) ?? '';
          if (!outputCallId || !outputText) return prev;
          const newSubAgents = last.subAgents.map((a: SubAgent) =>
            a.id !== subagentId ? a : {
              ...a,
              toolCalls: (a.toolCalls || []).map((t: ToolCall) =>
                t.id === outputCallId && t.status === 'running'
                  ? { ...t, streamOutput: (t.streamOutput || '') + outputText } : t),
            });
          return updateLastMessage(prev, { subAgents: newSubAgents });
        }
        case 'tool_complete': {
          const toolName = (parentEvent.tool as string) ?? '';
          const elapsed = (parentEvent.elapsed as number) ?? 0;
          const callId = (parentEvent.callId as string) ?? '';
          const result = (parentEvent as { result?: unknown; output?: unknown }).result
            ?? (parentEvent as { output?: unknown }).output ?? '';
          const resultStr = typeof result === 'string' ? result
            : (result && typeof result === 'object'
              ? ((result as { output?: string; message?: string }).output
                || (result as { message?: string }).message
                || JSON.stringify(result))
              : '');
          const newSubAgents = last.subAgents.map((a: SubAgent) =>
            a.id !== subagentId ? a : {
              ...a,
              toolCalls: (a.toolCalls || []).map((t: ToolCall) => {
                if (callId && t.id !== callId) return t;
                if (!callId && (t.name !== toolName || t.status !== 'running')) return t;
                return { ...t, status: 'done' as const, result: resultStr, elapsed };
              }),
            });
          return updateLastMessage(prev, { subAgents: newSubAgents });
        }
        default:
          return prev;
      }
    };

    const applyTokenUsageEvent = (ev: TelemetryEvent): void => {
      const cw = ev.contextWindow as number | undefined;
      if (cw != null && cw > 0) setTokenTotal(cw);
      const inp = ev.inputTokens as number | undefined;
      const out = ev.outputTokens as number | undefined;
      const reserved = ev.reservedTokens as number | undefined;
      const streamingTok = ev.streamingTokens as number | undefined;
      if (inp != null) {
        setTokenInput(inp);
        tokenInputRef.current = inp;
      }
      if (out != null) {
        setTokenOutput(out);
        tokenOutputRef.current = out;
      }
      if (reserved != null) {
        setTokenReserved(reserved);
        tokenReservedRef.current = reserved;
      }
      if (streamingTok != null) setTokenStreaming(streamingTok);
      const used = ev.totalTokens as number | undefined;
      if (used != null) setTokenUsed(used);
    };

    // Build event handler context (captures all refs/setters/helpers for dispatch table)
    const ctx: EventHandlerContext = {
      crewList, turnActivity,
      isInitialLoadRef, turnActiveRef, outgoingTurnRef, resendInProgressRef,
      lastTurnFeedbackCandidateRef, currentSessionIdRef, isCrewPrivateRef,
      crewPrivateHostRef, crewMissionSessionIdRef, crewSuggestionHandledRef,
      crewGateInFlightRef, attachCrewRosterPickerRef, rateLimitSeenRef,
      tokenInputRef, tokenOutputRef, tokenReservedRef, refreshContextRef,
      streamChunkRAFRef, streamChunkPendingRef, thinkingPendingRef, thinkingFlushRef,
      providerErrorTimerRef, toolBatchRef, toolFlushRef,
      setMessages, setStreaming, setTurnActivity, setCurrentStep, setTokenStreaming,
      setTokenUsed, setLoadingSteps, setWarnings, setStepCapPrompt, setPermissionPrompt,
      setPendingPermissionCount, setCrewWorkers, setCrewMissionActive,
      setCrewMissionId, setCrewInterMessages, setTokenTotal, setCompactionCount, setBypassPermissionsState,
      isCrewEventForCurrentSession, stopTurnIndicator, ensureOutgoingTurnMessages,
      isAgentRecentlyActive, applyToolEvent, applySubagentToolEvent, applyTokenUsageEvent,
    };

    const handleEvent = (ev: TelemetryEvent) => {
      if (!eventBelongsToViewSession(ev, viewSessionIdRef.current)) return;

      // Reset activity timer on every event from the agent
      const now = Date.now();
      lastActivityRef.current = now;
      // Throttle the state write — lastEventAt only feeds the connection-health
      // dot, so refreshing it at most every 2s avoids re-rendering the whole
      // panel on every telemetry event.
      if (now - lastEventAtWrittenRef.current > 2000) {
        lastEventAtWrittenRef.current = now;
        setLastEventAt(now);
      }

      // Dispatch to the appropriate handler via the lookup table
      const handler = telemetryDispatch[ev.type];
      if (handler) handler(ev, ctx);
    };

    ensureRenderInstrumentation();
    disconnectRef.current = subscribeOptimizedTelemetry(
      handleEvent,
      (state) => {
        setConnState(state);
        if (state === 'open') {
          setLastEventAt(Date.now());
        } else if (state === 'reconnecting') {
          // On reconnect, fetch current agent state to recover any missed updates
          fetch('/api/agent/state', { credentials: 'include' })
            .then(r => r.json())
            .then(data => {
              const viewSessionId = viewSessionIdRef.current;
              if (!viewSessionId || data.session?.id !== viewSessionId) {
                stopTurnIndicator();
                return;
              }
              if (data.processing) {
                turnActiveRef.current = true;
                setStreaming(true);
              } else {
                stopTurnIndicator();
              }
            })
            .catch(() => {});
        }
      },
    );
    return () => {
      disconnectRef.current?.();
    };
  }, []);

  // Streaming timeout — tracks activity via SSE events.
  // - All SSE events (tool, chunk, status) reset the activity timer.
  // - After 2 minutes of inactivity, tries to recover the response from the API.
  // - Retries recovery every tick until streaming ends or a complete response is found.
  // - Never force-closes streaming — the agent may be processing tools for minutes.
  useEffect(() => {
    if (!streaming) return;
    lastActivityRef.current = Date.now();
    const timer = setInterval(() => {
      const elapsed = Date.now() - lastActivityRef.current;
      if (elapsed > 120000) {
        // 2 min inactivity — SSE may be disconnected. Try to recover by fetching
        // /api/chat/history. If the agent already produced a response, display it.
        // Keep retrying on every tick until streaming ends.
        fetch(`/api/chat/history`, { credentials: 'include' })
          .then(r => r.json())
          .then(data => {
            const msgs = Array.isArray(data) ? data : [];
            // Iterate backwards to find the most recent complete assistant response
            for (let i = msgs.length - 1; i >= 0; i--) {
              const m = msgs[i];
              if (m.role === 'assistant' && m.content && !m.toolCalls) {
                setMessages(prev => {
                  const last = prev[prev.length - 1];
                  if (last?.role !== 'assistant') return prev;
                  // Only apply if our local content is shorter (stale/partial)
                  if (last.streaming || !last.content || last.content.length < m.content.length) {
                    return updateLastMessage(prev, { content: m.content, streaming: false });
                  }
                  return prev;
                });
                setStreaming(false);
                break;
              }
            }
          })
          .catch(() => {});
      }
    }, 30000);
    return () => clearInterval(timer);
  }, [streaming]);

  // Poll async turn status when SSE may miss completion/error
  useEffect(() => {
    const turnId = activeTurnIdRef.current;
    if (!turnId || !streaming) return;
    const poll = setInterval(() => {
      chat.getTurn(turnId).then((record) => {
        if (record.status === 'error') {
          const err = record.error ?? 'Turn failed';
          // Turn registry may mark timeout while SSE still shows live activity
          if (isTimeoutWarning(err) && isAgentRecentlyActive()) return;
          setWarnings(prev => replaceWarning(prev, err));
          if (record.partialContent) {
            setMessages(p => {
              const last = p[p.length - 1];
              if (last?.role === 'assistant') {
                return updateLastMessage(p, { content: record.partialContent!, streaming: false });
              }
              return p;
            });
          }
          endTurnUi();
        } else if (record.status === 'complete' || record.status === 'cancelled') {
          endTurnUi();
        }
      }).catch(() => {});
    }, 10000);
    return () => clearInterval(poll);
  }, [streaming, endTurnUi]);

}
