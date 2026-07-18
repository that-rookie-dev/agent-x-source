// useChatSend.ts — extracted from useChatSessionState.tsx
// Owns all send/resend/steer/queue handlers, crew suggestion gate, crew roster picker
// handlers, questionnaire response, and file attachment handlers.
// High coupling: needs many state values, setters, and refs from the orchestrator.

import React, { useCallback, useEffect, useRef } from 'react';
import { chat, agent, crews, crewSuggestions, type Crew, type CrewSuggestionEvaluation, type CrewMatchCandidate } from '../../api';
import { collectClientSituation } from '../../client-situation.js';
import { sanitizeForJson } from '../../chat/utils';
import { replaceWarning } from './message-helpers';
import {
  createCrewSuggestionEvalMessage,
  mergeCrewRosterPickerIntoMessages,
  shouldOfferCrewRosterPicker,
} from '../../chat/crew-suggestion-flow';
import type { UIMessage, FileAttachment } from '../../chat/types';
import type { ChatInputBarHandle } from '../ChatInputBar';

export interface UseChatSendInputs {
  // State values
  messages: UIMessage[];
  streaming: boolean;
  attachments: FileAttachment[];
  currentProvider: string;
  currentModel: string;
  isCrewPrivateSession: boolean;
  webSearchAvailable: boolean;
  webSearchForce: boolean;
  crewSuggestionRequested: boolean;
  currentSessionId: string | null;
  coreSession: unknown;
  // Setters
  setMessages: React.Dispatch<React.SetStateAction<UIMessage[]>>;
  setAttachments: React.Dispatch<React.SetStateAction<FileAttachment[]>>;
  setWarnings: React.Dispatch<React.SetStateAction<string[]>>;
  setCrewList: React.Dispatch<React.SetStateAction<Crew[]>>;
  setTurnActivity: React.Dispatch<React.SetStateAction<{ stage: string; step: number; elapsedMs: number } | null>>;
  setLoadingSteps: React.Dispatch<React.SetStateAction<Array<{ id: string; label: string; status: string }> | null>>;
  setStreaming: React.Dispatch<React.SetStateAction<boolean>>;
  setCrewSuggestionRequested: React.Dispatch<React.SetStateAction<boolean>>;
  // Shared functions
  beginTurnUi: () => void;
  endTurnUi: () => void;
  ensureSession: () => Promise<string | null>;
  scrollMessagesToBottom: (behavior?: 'smooth' | 'instant') => void;
  // Refs
  rateLimitSeenRef: React.MutableRefObject<boolean>;
  outgoingTurnRef: React.MutableRefObject<{ userId: string; userContent: string; placeholderId: string } | null>;
  activeTurnIdRef: React.MutableRefObject<string | null>;
  resendInProgressRef: React.MutableRefObject<boolean>;
  crewSuggestionHandledRef: React.MutableRefObject<boolean>;
  crewGateInFlightRef: React.MutableRefObject<boolean>;
  attachCrewRosterPickerRef: React.MutableRefObject<(text: string, evaluation: CrewSuggestionEvaluation, opts?: { userMessageId?: string; evalAssistantMessageId?: string }) => Promise<boolean>>;
  pendingSendTextRef: React.MutableRefObject<string | null>;
  inputBarRef: React.MutableRefObject<ChatInputBarHandle | null>;
}

export function useChatSend({
  messages, streaming, attachments, currentProvider, currentModel,
  isCrewPrivateSession, webSearchAvailable, webSearchForce, crewSuggestionRequested, currentSessionId,
  coreSession,
  setMessages, setAttachments, setWarnings, setCrewList,
  setTurnActivity, setLoadingSteps, setStreaming, setCrewSuggestionRequested,
  beginTurnUi, endTurnUi, ensureSession, scrollMessagesToBottom,
  rateLimitSeenRef,
  outgoingTurnRef, activeTurnIdRef, resendInProgressRef,
  crewSuggestionHandledRef, crewGateInFlightRef, attachCrewRosterPickerRef,
  pendingSendTextRef, inputBarRef,
}: UseChatSendInputs) {
  // ─── Stable refs for handler dependencies ───
  const messagesRef = useRef(messages);
  const streamingRef = useRef(streaming);
  const attachmentsRef = useRef(attachments);
  const currentProviderRef = useRef(currentProvider);
  const currentModelRef = useRef(currentModel);
  const isCrewPrivateSessionRef = useRef(isCrewPrivateSession);
  const webSearchAvailableRef = useRef(webSearchAvailable);
  const webSearchForceRef = useRef(webSearchForce);
  const crewSuggestionRequestedRef = useRef(crewSuggestionRequested);
  const coreSessionRef = useRef(coreSession);
  const currentSessionIdRef = useRef(currentSessionId);

  useEffect(() => { messagesRef.current = messages; }, [messages]);
  useEffect(() => { streamingRef.current = streaming; }, [streaming]);
  useEffect(() => { attachmentsRef.current = attachments; }, [attachments]);
  useEffect(() => { currentProviderRef.current = currentProvider; }, [currentProvider]);
  useEffect(() => { currentModelRef.current = currentModel; }, [currentModel]);
  useEffect(() => { isCrewPrivateSessionRef.current = isCrewPrivateSession; }, [isCrewPrivateSession]);
  useEffect(() => { webSearchAvailableRef.current = webSearchAvailable; }, [webSearchAvailable]);
  useEffect(() => { webSearchForceRef.current = webSearchForce; }, [webSearchForce]);
  useEffect(() => { crewSuggestionRequestedRef.current = crewSuggestionRequested; }, [crewSuggestionRequested]);
  useEffect(() => { coreSessionRef.current = coreSession; }, [coreSession]);
  useEffect(() => { currentSessionIdRef.current = currentSessionId; }, [currentSessionId]);

  // ─── attachCrewRosterPicker ───
  const attachCrewRosterPicker = useCallback(async (
    text: string,
    evaluation: CrewSuggestionEvaluation,
    opts?: { userMessageId?: string; evalAssistantMessageId?: string },
  ): Promise<boolean> => {
    if (isCrewPrivateSessionRef.current) return false;
    if (!shouldOfferCrewRosterPicker(evaluation)) return false;

    const trimmed = sanitizeForJson(text.trim());
    if (!trimmed) return false;
    const sessionId = await ensureSession();
    if (!sessionId) return false;

    const alreadyPending = messagesRef.current.some((m) =>
      m.parts?.some((p) =>
        p.type === 'crew_roster_picker'
        && p.crewRosterPicker?.status === 'pending'
        && p.crewRosterPicker.pendingUserText === trimmed,
      ),
    );
    if (alreadyPending) return true;

    try {
      const persisted = await crewSuggestions.offerRosterPicker(sessionId, {
        userText: trimmed,
        evaluation,
        attachments: attachmentsRef.current.map((a) => ({ name: a.name })),
        userMessageId: opts?.userMessageId,
      });

      const pickerRecord = {
        id: persisted.pickerPartId,
        status: 'pending' as const,
        evaluation,
        pendingUserText: trimmed,
      };
      const pickerMsg: UIMessage = {
        id: persisted.pickerMessageId,
        role: 'assistant',
        content: '',
        streaming: false,
        parts: [{
          type: 'crew_roster_picker',
          id: persisted.pickerPartId,
          crewRosterPicker: pickerRecord,
        }],
      };

      setMessages((prev) => {
        if (prev.some((message) => message.id === persisted.pickerMessageId)) return prev;
        return mergeCrewRosterPickerIntoMessages(
          prev,
          trimmed,
          pickerMsg,
          persisted,
          opts,
          attachmentsRef.current.map((attachment) => ({ name: attachment.name })),
        );
      });
      inputBarRef.current?.clear();
      setAttachments([]);
      return true;
    } catch (err) {
      setWarnings((prev) => replaceWarning(prev, err instanceof Error ? err.message : 'Failed to offer crew roster'));
      return false;
    }
  }, [ensureSession, setWarnings, setMessages, setAttachments, inputBarRef, messagesRef, attachmentsRef, isCrewPrivateSessionRef]);

  useEffect(() => {
    attachCrewRosterPickerRef.current = attachCrewRosterPicker;
  }, [attachCrewRosterPicker, attachCrewRosterPickerRef]);

  // ─── executeSend ───
  const executeSend = useCallback(async (
    text: string,
    delegateCrewIds?: string[],
    options?: {
      crewSuggestionResolved?: boolean;
      crewIntakeFromPicker?: boolean;
      primaryCrewId?: string;
      skipUserMessage?: boolean;
      userMessagePersisted?: boolean;
    },
  ) => {
    const trimmed = sanitizeForJson(text.trim());
    if ((!trimmed && attachmentsRef.current.length === 0) && !options?.skipUserMessage) return;
    if (!currentProviderRef.current || !currentModelRef.current) return;
    rateLimitSeenRef.current = false;
    if (!(await ensureSession())) return;

    const priorUserMessages = messagesRef.current
      .filter((m) => m.role === 'user')
      .map((m) => m.content)
      .slice(-3);

    beginTurnUi();
    if (!options?.skipUserMessage) {
      const userId = crypto.randomUUID();
      const placeholderId = crypto.randomUUID();
      outgoingTurnRef.current = { userId, userContent: trimmed, placeholderId };
      const userMsg: UIMessage = {
        id: userId,
        role: 'user',
        content: trimmed,
        streaming: false,
        attachments: attachmentsRef.current.map((a) => ({ name: a.name })),
      };
      setMessages((prev) => [
        ...prev,
        userMsg,
        { id: placeholderId, role: 'assistant', content: '', streaming: true },
      ]);
      inputBarRef.current?.clear();
      // Force scroll to bottom after sending a message so the new message
      // and the assistant placeholder are fully visible.
      requestAnimationFrame(() => scrollMessagesToBottom('smooth'));
    }

    const fileRefs = attachmentsRef.current.length > 0 ? attachmentsRef.current.map((a) => ({ name: a.name, content: a.content })) : undefined;
    setAttachments([]);

    const crewResolved = options?.crewSuggestionResolved ?? Boolean(delegateCrewIds?.length);

    try {
      const clientSituation = await collectClientSituation();
      const result = await chat.send(
        trimmed,
        fileRefs,
        undefined,
        delegateCrewIds,
        crewResolved,
        priorUserMessages,
        options?.crewIntakeFromPicker,
        options?.primaryCrewId,
        webSearchAvailableRef.current && webSearchForceRef.current,
        options?.userMessagePersisted === true,
        clientSituation,
        crewSuggestionRequestedRef.current,
      );
      // One-shot: reset the crew suggestion toggle after the request is dispatched.
      if (crewSuggestionRequestedRef.current) {
        crewSuggestionRequestedRef.current = false;
        setCrewSuggestionRequested(false);
      }
      if (result?.crewSuggestionRequired && result.evaluation) {
        endTurnUi();
        let existingUserId: string | undefined;
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          const next = last?.role === 'assistant' && last.streaming ? prev.slice(0, -1) : prev;
          existingUserId = next.find((m) => m.role === 'user' && m.content === trimmed)?.id;
          return next;
        });
        crewSuggestionHandledRef.current = true;
        await attachCrewRosterPickerRef.current(trimmed, result.evaluation, existingUserId
          ? { userMessageId: existingUserId }
          : undefined);
        return;
      }
      if (result?.turnId) activeTurnIdRef.current = result.turnId;
      if (result?.async) return;
      if (result?.message) {
        const msg = result.message;
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last?.role === 'assistant' && last.streaming) {
            const fullContent = msg.content || '';
            if (fullContent) return [...prev.slice(0, -1), { ...last, ...msg, streaming: false } as UIMessage];
            return prev.slice(0, -1);
          }
          return prev;
        });
      }
      endTurnUi();
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error';
      setWarnings(prev => replaceWarning(prev, errorMsg));
      chat.cancel().catch(() => {});
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last?.role === 'assistant' && last.streaming) return prev.slice(0, -1);
        return prev;
      });
      endTurnUi();
    }
  }, [ensureSession, beginTurnUi, endTurnUi, setMessages, setAttachments, setWarnings, setCrewSuggestionRequested, rateLimitSeenRef, outgoingTurnRef, activeTurnIdRef, crewSuggestionHandledRef, inputBarRef, messagesRef, attachmentsRef, currentProviderRef, currentModelRef, webSearchAvailableRef, webSearchForceRef, crewSuggestionRequestedRef, attachCrewRosterPickerRef, scrollMessagesToBottom]);

  // ─── runCrewSuggestionGate ───
  const runCrewSuggestionGate = useCallback(async (trimmed: string): Promise<boolean> => {
    // Only run the crew suggestion gate when the user explicitly requests it via the toggle.
    if (!crewSuggestionRequestedRef.current) return false;
    if (isCrewPrivateSessionRef.current || coreSessionRef.current) return false;
    if (/(?<!\w)@([\w][\w.-]*)/.test(trimmed)) return false;
    if (crewGateInFlightRef.current) return false;

    const sessionId = await ensureSession();
    if (!sessionId) return false;

    crewGateInFlightRef.current = true;
    crewSuggestionHandledRef.current = true;
    try {
    const userMessageId = crypto.randomUUID();
    const evalAssistant = createCrewSuggestionEvalMessage();
    const userMsg: UIMessage = {
      id: userMessageId,
      role: 'user',
      content: sanitizeForJson(trimmed),
      streaming: false,
      attachments: attachmentsRef.current.map((a) => ({ name: a.name })),
    };

    setMessages((prev) => [...prev, userMsg, evalAssistant]);
    inputBarRef.current?.clear();
    setAttachments([]);
    requestAnimationFrame(() => scrollMessagesToBottom('smooth'));

    const priorUserMessages = [
      ...messagesRef.current.filter((m) => m.role === 'user').map((m) => m.content),
      trimmed,
    ].slice(-3);

    try {
      const evaluation = await crewSuggestions.evaluate(trimmed, sessionId, priorUserMessages);
      if (evaluation?.reasons.includes('catalog-unavailable')) {
        setWarnings((prev) => replaceWarning(prev, 'Crew catalog unavailable — continuing with Agent-X only.'));
      }

      if (evaluation && shouldOfferCrewRosterPicker(evaluation)) {
        const attached = await attachCrewRosterPickerRef.current(trimmed, evaluation, {
          userMessageId,
          evalAssistantMessageId: evalAssistant.id,
        });
        if (attached) return true;
      }
    } catch (err) {
      if (import.meta.env.DEV) {
        const msg = err instanceof Error ? err.message : 'Crew suggestion check failed';
        setWarnings((prev) => replaceWarning(prev, `Crew suggestion: ${msg}`));
      }
    }

    setMessages((prev) => prev.filter((m) => m.id !== evalAssistant.id));
    await executeSend(trimmed, undefined, { crewSuggestionResolved: true, skipUserMessage: true });
    return true;
    } finally {
      crewGateInFlightRef.current = false;
    }
  }, [
    ensureSession, executeSend, setAttachments, setMessages, setWarnings, inputBarRef,
    crewGateInFlightRef, crewSuggestionHandledRef, isCrewPrivateSessionRef, coreSessionRef,
    messagesRef, attachmentsRef, attachCrewRosterPickerRef, crewSuggestionRequestedRef,
  ]);

  // ─── handleSend ───
  const handleSend = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if ((!trimmed && attachmentsRef.current.length === 0)) return;
    crewSuggestionHandledRef.current = false;

    if (await runCrewSuggestionGate(trimmed)) return;
    await executeSend(trimmed);
  }, [executeSend, runCrewSuggestionGate, crewSuggestionHandledRef, pendingSendTextRef, attachmentsRef]);

  // ─── handleResend ───
  const handleResend = useCallback(async (text: string) => {
    if (!text || streamingRef.current || !currentProviderRef.current || !currentModelRef.current) return;
    if (!(await ensureSession())) return;

    try { await chat.cancel(); } catch { /* ignore */ }
    resendInProgressRef.current = true;
    setTurnActivity(null);
    setLoadingSteps(null);
    beginTurnUi();

    const placeholderId = crypto.randomUUID();
    setMessages(prev => {
      const withoutAssistant = prev[prev.length - 1]?.role === 'assistant' ? prev.slice(0, -1) : prev;
      const tip = withoutAssistant[withoutAssistant.length - 1];
      if (tip?.role === 'user') {
        return [...withoutAssistant, { id: placeholderId, role: 'assistant' as const, content: '', streaming: true }];
      }
      return withoutAssistant;
    });
    requestAnimationFrame(() => scrollMessagesToBottom('smooth'));

    try {
      const clientSituation = await collectClientSituation();
      const result = await chat.send(sanitizeForJson(text), undefined, true, undefined, undefined, undefined, undefined, undefined, undefined, undefined, clientSituation);
      if (result?.turnId) activeTurnIdRef.current = result.turnId;
      if (result?.async) return;
      setMessages(prev => {
        const last = prev[prev.length - 1];
        if (last?.role === 'assistant' && last.streaming) {
          if (!last.content && result?.message?.content) {
            return [...prev.slice(0, -1), { ...result.message, streaming: false }];
          }
          return [...prev.slice(0, -1), { ...last, streaming: false }];
        }
        return prev;
      });
      endTurnUi();
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error';
      setWarnings(prev => replaceWarning(prev, errorMsg));
      chat.cancel().catch(() => {});
      setMessages(prev => {
        const last = prev[prev.length - 1];
        if (last?.role === 'assistant' && last.streaming) {
          return prev.slice(0, -1);
        }
        return prev;
      });
      endTurnUi();
    }
  }, [ensureSession, beginTurnUi, endTurnUi, scrollMessagesToBottom, setTurnActivity, setLoadingSteps, setMessages, setWarnings, resendInProgressRef, activeTurnIdRef, streamingRef, currentProviderRef, currentModelRef]);

  // ─── markCrewRosterPickerResolved ───
  const markCrewRosterPickerResolved = useCallback((
    messageId: string,
    status: 'answered' | 'skipped',
    selectedCandidateIds?: string[],
  ) => {
    setMessages((prev) => prev.map((m) => {
      if (m.id !== messageId || !m.parts) return m;
      return {
        ...m,
        parts: m.parts.map((p) => {
          if (p.type !== 'crew_roster_picker' || !p.crewRosterPicker) return p;
          return {
            ...p,
            crewRosterPicker: {
              ...p.crewRosterPicker,
              status,
              selectedCandidateIds,
            },
          };
        }),
      };
    }));
  }, [setMessages]);

  // ─── revertCrewRosterPickerPending ───
  const revertCrewRosterPickerPending = useCallback((messageId: string) => {
    setMessages((prev) => prev.map((m) => {
      if (m.id !== messageId || !m.parts) return m;
      return {
        ...m,
        parts: m.parts.map((p) => {
          if (p.type !== 'crew_roster_picker' || !p.crewRosterPicker) return p;
          return {
            ...p,
            crewRosterPicker: {
              ...p.crewRosterPicker,
              status: 'pending' as const,
              selectedCandidateIds: undefined,
            },
          };
        }),
      };
    }));
  }, [setMessages]);

  // ─── handleCrewRosterPickerSubmit ───
  const handleCrewRosterPickerSubmit = useCallback(async (messageId: string, selected: CrewMatchCandidate[]) => {
    const pickerMsg = messagesRef.current.find((m) => m.id === messageId);
    const pickerPart = pickerMsg?.parts?.find((p) => p.type === 'crew_roster_picker');
    const record = pickerPart?.crewRosterPicker;
    if (!record || record.status !== 'pending') return;

    const text = record.pendingUserText;
    const pickerPartId = pickerPart?.id;
    const selectedIds = selected.map((c) => c.id);
    markCrewRosterPickerResolved(messageId, 'answered', selectedIds);

    try {
      const sessionId = await ensureSession();
      if (!sessionId) {
        revertCrewRosterPickerPending(messageId);
        return;
      }
      const result = await crewSuggestions.resolve({
        sessionId,
        action: 'deploy',
        selectedCandidateIds: selectedIds,
        candidates: record.evaluation.candidates,
      });
      if (!result.deployedCrewIds?.length) {
        setWarnings((prev) => replaceWarning(prev, 'Selected specialists could not be recruited or enabled.'));
        await crewSuggestions.updateRosterPicker(sessionId, {
          pickerMessageId: messageId,
          status: 'skipped',
          evaluation: record.evaluation,
          pendingUserText: text,
          pickerPartId,
        });
        markCrewRosterPickerResolved(messageId, 'skipped');
        await executeSend(text, undefined, { crewSuggestionResolved: true, skipUserMessage: true, userMessagePersisted: true });
        return;
      }
      const primaryCrewId = result.deployedPrimaryCrewId
        ?? result.deployedCrewIds[0];
      await crewSuggestions.updateRosterPicker(sessionId, {
        pickerMessageId: messageId,
        status: 'answered',
        selectedCandidateIds: selectedIds,
        evaluation: record.evaluation,
        pendingUserText: text,
        pickerPartId,
      });
      crews.list().then((list) => setCrewList(list)).catch(() => {});
      await executeSend(text, result.deployedCrewIds, {
        crewSuggestionResolved: true,
        primaryCrewId,
        skipUserMessage: true,
        userMessagePersisted: true,
        crewIntakeFromPicker: true,
      });
    } catch (err) {
      revertCrewRosterPickerPending(messageId);
      setWarnings((prev) => replaceWarning(prev, err instanceof Error ? err.message : 'Failed to deploy crew'));
    }
  }, [markCrewRosterPickerResolved, revertCrewRosterPickerPending, ensureSession, executeSend, setWarnings, setCrewList, messagesRef]);

  // ─── handleCrewRosterPickerSkip ───
  const handleCrewRosterPickerSkip = useCallback(async (messageId: string, dismissForSession = false) => {
    const pickerMsg = messagesRef.current.find((m) => m.id === messageId);
    const pickerPart = pickerMsg?.parts?.find((p) => p.type === 'crew_roster_picker');
    const record = pickerPart?.crewRosterPicker;
    if (!record || record.status !== 'pending') return;

    markCrewRosterPickerResolved(messageId, 'skipped');

    try {
      const sessionId = await ensureSession();
      if (sessionId) {
        await crewSuggestions.resolve({
          sessionId,
          action: dismissForSession ? 'dismiss' : 'skip',
          dismissForSession,
        });
        await crewSuggestions.updateRosterPicker(sessionId, {
          pickerMessageId: messageId,
          status: 'skipped',
          evaluation: record.evaluation,
          pendingUserText: record.pendingUserText,
          pickerPartId: pickerPart?.id,
        });
      }
      await executeSend(record.pendingUserText, undefined, {
        crewSuggestionResolved: true,
        skipUserMessage: true,
        userMessagePersisted: true,
      });
    } catch (err) {
      revertCrewRosterPickerPending(messageId);
      setWarnings((prev) => replaceWarning(prev, err instanceof Error ? err.message : 'Failed to skip crew picker'));
    }
  }, [markCrewRosterPickerResolved, revertCrewRosterPickerPending, ensureSession, executeSend, setWarnings, messagesRef]);

  // ─── handleQuestionnaireRespond ───
  const handleQuestionnaireRespond = useCallback(async (messageId: string, response: string) => {
    const markAnswered = () => {
      setMessages((prev) => prev.map((m) => {
        if (m.id !== messageId || !m.parts) return m;
        return {
          ...m,
          parts: m.parts.map((p) => {
            if (p.type !== 'questionnaire' || !p.questionnaire) return p;
            return {
              ...p,
              questionnaire: {
                ...p.questionnaire,
                status: 'answered' as const,
                answer: response,
                answeredAt: new Date().toISOString(),
              },
            };
          }),
        };
      }));
    };

    try {
      markAnswered();
      const result = await agent.respondToClarification(response, currentSessionIdRef.current ?? undefined);
      if (result.ok) {
        setStreaming(true);
      }
    } catch (err) {
      setWarnings((prev) => replaceWarning(prev, err instanceof Error ? err.message : 'Failed to send questionnaire response'));
    }
  }, [setMessages, setStreaming, setWarnings, currentSessionIdRef]);

  // ─── handleStopAndSend ───
  const handleStopAndSend = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed && attachmentsRef.current.length === 0) return;
    if (!(await ensureSession())) return;
    beginTurnUi();
    const userId = crypto.randomUUID();
    const placeholderId = crypto.randomUUID();
    outgoingTurnRef.current = { userId, userContent: trimmed, placeholderId };
    const userMsg: UIMessage = { id: userId, role: 'user', content: trimmed, streaming: false, attachments: attachmentsRef.current.map((a) => ({ name: a.name })) };
    setMessages((prev) => [...prev, userMsg, { id: placeholderId, role: 'assistant', content: '', streaming: true }]);
    requestAnimationFrame(() => scrollMessagesToBottom('smooth'));
    const fileRefs = attachmentsRef.current.length > 0 ? attachmentsRef.current.map((a) => ({ name: a.name, content: a.content })) : undefined;
    setAttachments([]);
    try {
      const result = await chat.stopAndSend(trimmed, fileRefs);
      if (result?.turnId) activeTurnIdRef.current = result.turnId;
      if (result?.async) return;
      if (result?.message) {
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last?.role === 'assistant' && last.streaming && !last.content) {
            return [...prev.slice(0, -1), { ...result.message!, streaming: false }];
          }
          return prev;
        });
      }
    } catch { /* handled by SSE */ }
    endTurnUi();
  }, [ensureSession, beginTurnUi, endTurnUi, setMessages, setAttachments, scrollMessagesToBottom, outgoingTurnRef, activeTurnIdRef, attachmentsRef]);

  // ─── handleAddToQueue ───
  const handleAddToQueue = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed && attachmentsRef.current.length === 0) return;
    const fileRefs = attachmentsRef.current.length > 0 ? attachmentsRef.current.map((a) => ({ name: a.name, content: a.content })) : undefined;
    try { await chat.queue(trimmed, fileRefs); } catch { /* ignore */ }
    setAttachments([]);
  }, [setAttachments, attachmentsRef]);

  // ─── handleSteer ───
  const handleSteer = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed && attachmentsRef.current.length === 0) return;
    if (!(await ensureSession())) return;
    beginTurnUi();
    const userId = crypto.randomUUID();
    const placeholderId = crypto.randomUUID();
    const userContent = `↑ ${trimmed}`;
    outgoingTurnRef.current = { userId, userContent, placeholderId };
    const userMsg: UIMessage = { id: userId, role: 'user', content: userContent, streaming: false };
    setMessages((prev) => [...prev, userMsg, { id: placeholderId, role: 'assistant', content: '', streaming: true }]);
    requestAnimationFrame(() => scrollMessagesToBottom('smooth'));
    const fileRefs = attachmentsRef.current.length > 0 ? attachmentsRef.current.map((a) => ({ name: a.name, content: a.content })) : undefined;
    setAttachments([]);
    try {
      const result = await chat.steer(trimmed, fileRefs);
      if (result?.turnId) activeTurnIdRef.current = result.turnId;
      if (result?.async) return;
      if (result?.message) {
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last?.role === 'assistant' && last.streaming && !last.content) {
            return [...prev.slice(0, -1), { ...result.message!, streaming: false }];
          }
          return prev;
        });
      }
    } catch { /* handled by SSE */ }
    endTurnUi();
  }, [ensureSession, beginTurnUi, endTurnUi, setMessages, setAttachments, scrollMessagesToBottom, outgoingTurnRef, activeTurnIdRef, attachmentsRef]);

  // ─── handleFileSelect ───
  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    Array.from(files).forEach((file) => {
      const reader = new FileReader();
      reader.onload = () => {
        setAttachments((prev) => [...prev, { name: file.name, content: reader.result as string }]);
      };
      reader.readAsText(file);
    });
    e.target.value = '';
  }, [setAttachments]);

  // ─── handleRemoveAttachment ───
  const handleRemoveAttachment = useCallback((idx: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== idx));
  }, [setAttachments]);

  return {
    attachCrewRosterPicker,
    executeSend,
    runCrewSuggestionGate,
    handleSend,
    handleResend,
    handleStopAndSend,
    handleAddToQueue,
    handleSteer,
    handleCrewRosterPickerSubmit,
    handleCrewRosterPickerSkip,
    handleQuestionnaireRespond,
    handleFileSelect,
    handleRemoveAttachment,
  };
}
