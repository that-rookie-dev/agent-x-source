// useChatSend.ts — extracted from useChatSessionState.tsx
// Owns all send/resend/steer/queue handlers, crew suggestion gate, crew roster picker
// handlers, questionnaire response, and file attachment handlers.
// High coupling: needs many state values, setters, and refs from the orchestrator.

import React, { useCallback, useEffect, useRef } from 'react';
import { chat, agent, attachments as attachmentApi, crews, crewSuggestions, type Crew, type CrewSuggestionEvaluation, type CrewMatchCandidate } from '../../api';
import type { TurnAttachment } from '@agentx/shared';
import { collectClientSituation } from '../../client-situation.js';
import { sanitizeForJson } from '../../chat/utils';
import { replaceWarning } from './message-helpers';
import {
  createCrewSuggestionEvalMessage,
  mergeCrewRosterPickerIntoMessages,
  shouldOfferCrewRosterPicker,
} from '../../chat/crew-suggestion-flow';
import type { UIMessage, FileAttachment } from '../../chat/types';
import { supportsVision, isImageMimeType } from '../../chat/vision-support';
import type { ChatInputBarHandle } from '../ChatInputBar';

function toUiMessageAttachments(
  refs: Array<{ id: string; name: string; mimeType?: string; storageId?: string; originalPath?: string }>,
  locals: FileAttachment[],
): NonNullable<UIMessage['attachments']> {
  return refs.map((a) => {
    const local = locals.find((l) => l.id === a.id || (a.storageId != null && l.storageId === a.storageId));
    return {
      id: a.storageId ?? a.id,
      name: a.name,
      mimeType: a.mimeType,
      placement: local?.placement ?? 'chip',
      originalPath: a.originalPath ?? local?.originalPath,
    };
  });
}
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
  const currentSessionIdRef = useRef(currentSessionId);
  const isCrewPrivateSessionRef = useRef(isCrewPrivateSession);
  const webSearchAvailableRef = useRef(webSearchAvailable);
  const webSearchForceRef = useRef(webSearchForce);
  const crewSuggestionRequestedRef = useRef(crewSuggestionRequested);
  const coreSessionRef = useRef(coreSession);

  useEffect(() => { messagesRef.current = messages; }, [messages]);
  useEffect(() => { streamingRef.current = streaming; }, [streaming]);
  useEffect(() => { attachmentsRef.current = attachments; }, [attachments]);
  useEffect(() => { currentProviderRef.current = currentProvider; }, [currentProvider]);
  useEffect(() => { currentModelRef.current = currentModel; }, [currentModel]);
  useEffect(() => { currentSessionIdRef.current = currentSessionId; }, [currentSessionId]);
  useEffect(() => { isCrewPrivateSessionRef.current = isCrewPrivateSession; }, [isCrewPrivateSession]);
  useEffect(() => { webSearchAvailableRef.current = webSearchAvailable; }, [webSearchAvailable]);
  useEffect(() => { webSearchForceRef.current = webSearchForce; }, [webSearchForce]);
  useEffect(() => { crewSuggestionRequestedRef.current = crewSuggestionRequested; }, [crewSuggestionRequested]);
  useEffect(() => { coreSessionRef.current = coreSession; }, [coreSession]);
  useEffect(() => { currentSessionIdRef.current = currentSessionId; }, [currentSessionId]);

  const assertCanSendAttachments = useCallback((): boolean => {
    const hasImage = attachmentsRef.current.some((a) => isImageMimeType(a.mimeType));
    if (!hasImage) return true;
    if (supportsVision(currentProviderRef.current, currentModelRef.current)) return true;
    setWarnings((prev) => replaceWarning(
      prev,
      'Current model does not support images. Switch to a vision model to send this message.',
    ));
    return false;
  }, [setWarnings]);

  // ─── attachCrewRosterPicker ───
  const attachCrewRosterPicker = useCallback(async (
    text: string,
    evaluation: CrewSuggestionEvaluation,
    opts?: { userMessageId?: string; evalAssistantMessageId?: string },
  ): Promise<boolean> => {
    if (isCrewPrivateSessionRef.current) return false;
    if (!shouldOfferCrewRosterPicker(evaluation)) return false;

    const cleaned = sanitizeForJson(text);
    if (!cleaned.trim()) return false;
    const sessionId = await ensureSession();
    if (!sessionId) return false;

    const alreadyPending = messagesRef.current.some((m) =>
      m.parts?.some((p) =>
        p.type === 'crew_roster_picker'
        && p.crewRosterPicker?.status === 'pending'
        && p.crewRosterPicker.pendingUserText === cleaned,
      ),
    );
    if (alreadyPending) return true;

    try {
      const persisted = await crewSuggestions.offerRosterPicker(sessionId, {
        userText: cleaned,
        evaluation,
        attachments: attachmentsRef.current.map((a) => ({ id: a.storageId ?? a.id, name: a.name, mimeType: a.mimeType })),
        userMessageId: opts?.userMessageId,
      });

      const pickerRecord = {
        id: persisted.pickerPartId,
        status: 'pending' as const,
        evaluation,
        pendingUserText: cleaned,
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
          cleaned,
          pickerMsg,
          persisted,
          opts,
          attachmentsRef.current.map((attachment) => ({ id: attachment.storageId ?? attachment.id, name: attachment.name, mimeType: attachment.mimeType })),
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

  const uploadAttachments = useCallback(async (sessionId: string) => {
    const refs: TurnAttachment[] = [];
    const updated: FileAttachment[] = [];
    for (const a of attachmentsRef.current) {
      // Workspace path refs — no upload; engine reads originalPath.
      if (a.originalPath) {
        refs.push({
          id: a.id,
          name: a.name,
          mimeType: a.mimeType,
          type: a.kind === 'folder'
            ? 'folder'
            : (a.mimeType.startsWith('image/') ? 'image' : 'file'),
          source: 'workspace',
          originalPath: a.originalPath,
        });
        continue;
      }
      if (a.storageId && a.uploaded) {
        refs.push({
          id: a.id,
          name: a.name,
          mimeType: a.mimeType,
          storageId: a.storageId,
          type: a.mimeType.startsWith('image/') ? 'image' : 'file',
          source: 'upload',
        });
        continue;
      }
      if (!a.dataUrl) {
        updated.push(a);
        continue;
      }
      try {
        const res = await attachmentApi.upload(sessionId, a.name, a.dataUrl);
        if (res.ok) {
          refs.push({
            id: a.id,
            name: a.name,
            mimeType: a.mimeType,
            storageId: res.attachment.id,
            type: a.mimeType.startsWith('image/') ? 'image' : 'file',
            source: 'upload',
          });
          updated.push({ ...a, storageId: res.attachment.id, uploaded: true });
          continue;
        }
      } catch {
        // fallthrough to keep local attachment
      }
      updated.push(a);
    }
    if (updated.length > 0) {
      setAttachments((prev) => prev.map((p) => updated.find((u) => u.id === p.id) ?? p));
    }
    return refs;
  }, [attachmentsRef, setAttachments]);

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
      todoDisposition?: 'continue' | 'skip' | 'defer';
    },
  ) => {
    // Preserve authoring whitespace/newlines for the model; only use trim for emptiness.
    const cleaned = sanitizeForJson(text);
    if ((!cleaned.trim() && attachmentsRef.current.length === 0) && !options?.skipUserMessage) return;
    if (!currentProviderRef.current || !currentModelRef.current) return;
    if (!assertCanSendAttachments()) return;
    rateLimitSeenRef.current = false;
    const sessionId = await ensureSession();
    if (!sessionId) return;
    const attachmentRefs = await uploadAttachments(sessionId);

    const priorUserMessages = messagesRef.current
      .filter((m) => m.role === 'user')
      .map((m) => m.content)
      .slice(-3);

    beginTurnUi();
    if (!options?.skipUserMessage) {
      const userId = crypto.randomUUID();
      const placeholderId = crypto.randomUUID();
      outgoingTurnRef.current = { userId, userContent: cleaned, placeholderId };
      const userMsg: UIMessage = {
        id: userId,
        role: 'user',
        content: cleaned,
        streaming: false,
        attachments: toUiMessageAttachments(attachmentRefs, attachmentsRef.current),
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

    const fileRefs = attachmentRefs.length > 0 ? attachmentRefs : undefined;
    setAttachments([]);

    const crewResolved = options?.crewSuggestionResolved ?? Boolean(delegateCrewIds?.length);

    try {
      const clientSituation = await collectClientSituation();
      const result = await chat.send(
        cleaned,
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
        options?.todoDisposition,
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
          existingUserId = next.find((m) => m.role === 'user' && m.content === cleaned)?.id;
          return next;
        });
        crewSuggestionHandledRef.current = true;
        await attachCrewRosterPickerRef.current(cleaned, result.evaluation, existingUserId
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
  }, [ensureSession, beginTurnUi, endTurnUi, setMessages, setAttachments, setWarnings, setCrewSuggestionRequested, rateLimitSeenRef, outgoingTurnRef, activeTurnIdRef, crewSuggestionHandledRef, inputBarRef, messagesRef, attachmentsRef, currentProviderRef, currentModelRef, webSearchAvailableRef, webSearchForceRef, crewSuggestionRequestedRef, attachCrewRosterPickerRef, scrollMessagesToBottom, assertCanSendAttachments]);

  // ─── runCrewSuggestionGate ───
  const runCrewSuggestionGate = useCallback(async (trimmed: string): Promise<boolean> => {
    // Only run the crew suggestion gate when the user explicitly requests it via the toggle.
    if (!crewSuggestionRequestedRef.current) return false;
    if (isCrewPrivateSessionRef.current || coreSessionRef.current) return false;
    if (/(?<!\w)@(?:crew:[^\s]+|file:[^\s]+|[\w][\w.-]*)/.test(trimmed)) return false;
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
      attachments: toUiMessageAttachments(
        attachmentsRef.current.map((a) => ({ id: a.id, name: a.name, mimeType: a.mimeType, storageId: a.storageId })),
        attachmentsRef.current,
      ),
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
  const handleSend = useCallback(async (
    text: string,
    options?: { todoDisposition?: 'continue' | 'skip' | 'defer' },
  ) => {
    if ((!text.trim() && attachmentsRef.current.length === 0)) return;
    crewSuggestionHandledRef.current = false;

    // Disposition already chosen — don't re-run crew gate for this handoff.
    if (options?.todoDisposition) {
      await executeSend(text, undefined, { todoDisposition: options.todoDisposition });
      return;
    }

    if (await runCrewSuggestionGate(text)) return;
    await executeSend(text);
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
    const cleaned = sanitizeForJson(text);
    if (!cleaned.trim() && attachmentsRef.current.length === 0) return;
    if (!assertCanSendAttachments()) return;
    const sessionId = await ensureSession();
    if (!sessionId) return;
    const attachmentRefs = await uploadAttachments(sessionId);
    beginTurnUi();
    const userId = crypto.randomUUID();
    const placeholderId = crypto.randomUUID();
    outgoingTurnRef.current = { userId, userContent: cleaned, placeholderId };
    const userMsg: UIMessage = { id: userId, role: 'user', content: cleaned, streaming: false, attachments: toUiMessageAttachments(attachmentRefs, attachmentsRef.current) };
    setMessages((prev) => [...prev, userMsg, { id: placeholderId, role: 'assistant', content: '', streaming: true }]);
    requestAnimationFrame(() => scrollMessagesToBottom('smooth'));
    const fileRefs = attachmentRefs.length > 0 ? attachmentRefs : undefined;
    setAttachments([]);
    try {
      const result = await chat.stopAndSend(cleaned, fileRefs);
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
  }, [ensureSession, beginTurnUi, endTurnUi, setMessages, setAttachments, scrollMessagesToBottom, outgoingTurnRef, activeTurnIdRef, attachmentsRef, assertCanSendAttachments]);

  // ─── handleAddToQueue ───
  const handleAddToQueue = useCallback(async (text: string) => {
    const cleaned = sanitizeForJson(text);
    if (!cleaned.trim() && attachmentsRef.current.length === 0) return;
    if (!assertCanSendAttachments()) return;
    const sessionId = currentSessionIdRef.current;
    if (!sessionId) return;
    const attachmentRefs = await uploadAttachments(sessionId);
    const fileRefs = attachmentRefs.length > 0 ? attachmentRefs : undefined;
    try { await chat.queue(cleaned, fileRefs); } catch { /* ignore */ }
    setAttachments([]);
  }, [setAttachments, attachmentsRef, currentSessionIdRef, uploadAttachments, assertCanSendAttachments]);

  // ─── handleSteer ───
  const handleSteer = useCallback(async (text: string) => {
    const cleaned = sanitizeForJson(text);
    if (!cleaned.trim() && attachmentsRef.current.length === 0) return;
    if (!assertCanSendAttachments()) return;
    const sessionId = await ensureSession();
    if (!sessionId) return;
    const attachmentRefs = await uploadAttachments(sessionId);
    beginTurnUi();
    const userId = crypto.randomUUID();
    const placeholderId = crypto.randomUUID();
    const userContent = `↑ ${cleaned}`;
    outgoingTurnRef.current = { userId, userContent, placeholderId };
    const userMsg: UIMessage = { id: userId, role: 'user', content: userContent, streaming: false, attachments: toUiMessageAttachments(attachmentRefs, attachmentsRef.current) };
    setMessages((prev) => [...prev, userMsg, { id: placeholderId, role: 'assistant', content: '', streaming: true }]);
    requestAnimationFrame(() => scrollMessagesToBottom('smooth'));
    const fileRefs = attachmentRefs.length > 0 ? attachmentRefs : undefined;
    setAttachments([]);
    try {
      const result = await chat.steer(cleaned, fileRefs);
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
  }, [ensureSession, beginTurnUi, endTurnUi, setMessages, setAttachments, scrollMessagesToBottom, outgoingTurnRef, activeTurnIdRef, attachmentsRef, assertCanSendAttachments]);

  const guessMimeType = (filename: string): string => {
    const ext = filename.split('.').pop()?.toLowerCase() ?? '';
    const map: Record<string, string> = {
      png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
      webp: 'image/webp', svg: 'image/svg+xml', pdf: 'application/pdf',
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      txt: 'text/plain', md: 'text/markdown', html: 'text/html', json: 'application/json',
      js: 'application/javascript', ts: 'application/typescript', py: 'text/x-python',
      csv: 'text/csv',
    };
    return map[ext] ?? 'application/octet-stream';
  };

  // ─── handleFileSelect ───
  const handleFileSelect = useCallback((files: FileList | null) => {
    if (!files) return;
    Array.from(files).forEach((file) => {
      const reader = new FileReader();
      reader.onload = () => {
        const id = crypto.randomUUID();
        // + / drag-drop → chip row only (not inlined into composer text).
        setAttachments((prev) => [...prev, {
          id,
          name: file.name,
          mimeType: file.type || guessMimeType(file.name),
          dataUrl: reader.result as string,
          uploaded: false,
          placement: 'chip',
        }]);
      };
      reader.readAsDataURL(file);
    });
  }, [setAttachments]);

  // ─── handleRemoveAttachment ───
  const handleRemoveAttachment = useCallback((idOrIdx: string | number) => {
    if (typeof idOrIdx === 'number') {
      setAttachments((prev) => prev.filter((_, i) => i !== idOrIdx));
      return;
    }
    setAttachments((prev) => prev.filter((a) => a.id !== idOrIdx));
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
