// useChatScroll.ts — extracted from useChatSessionState.tsx
// Owns all scroll-related state, refs, callbacks, and effects.
// Self-contained: only needs messages, streaming, sessionRestoring, view, and a couple of shared refs.

import React, { useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react';
import { sessions } from '../../api';
import { mapHistoryToUiMessages } from '../../chat/restoreMessages';
import type { UIMessage, ChatView } from '../../chat/types';

export interface UseChatScrollInputs {
  messages: UIMessage[];
  setMessages: React.Dispatch<React.SetStateAction<UIMessage[]>>;
  streaming: boolean;
  sessionRestoring: boolean;
  setSessionRestoring: React.Dispatch<React.SetStateAction<boolean>>;
  sessionRestoringRef: React.MutableRefObject<boolean>;
  currentSessionIdRef: React.MutableRefObject<string | null>;
  view: ChatView;
  scrollAfterVoiceUserRef: React.MutableRefObject<() => void>;
}

export function useChatScroll({
  messages,
  setMessages,
  streaming,
  sessionRestoring,
  setSessionRestoring,
  sessionRestoringRef,
  currentSessionIdRef,
  view,
  scrollAfterVoiceUserRef,
}: UseChatScrollInputs) {
  // ─── Scroll container + sentinel refs ───
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef<boolean>(true);
  const jumpSuppressScrollTopRef = useRef<number | null>(null);

  // ─── Scroll state ───
  const [showJumpPill, setShowJumpPill] = useState(false);
  const [hasOlderMessages, setHasOlderMessages] = useState(false);
  const [loadingOlderMessages, setLoadingOlderMessages] = useState(false);
  const [freezeMessageLayout, setFreezeMessageLayout] = useState(false);
  const [initialScrollDone, setInitialScrollDone] = useState(false);

  // ─── Pagination / scroll anchoring refs ───
  const loadingOlderRef = useRef(false);
  const scrollToBottomTimerRef = useRef<number | null>(null);
  const pendingScrollBehaviorRef = useRef<'smooth' | 'instant' | null>(null);
  const paginationAnchorRef = useRef<{ scrollTop: number; scrollHeight: number } | null>(null);
  const paginationAnchorMessageIdRef = useRef<string | null>(null);
  const paginationAnchorOffsetRef = useRef<number | null>(null);
  const paginationCooldownUntilRef = useRef(0);
  const initialScrollDoneRef = useRef(false);
  const paginationReadyRef = useRef(false);
  const needsInitialScrollRef = useRef(false);
  const lastScrollTopRef = useRef(0);

  // ─── Streaming scroll tracking refs ───
  const prevRealCountRef = useRef(0);
  const prevMessagesLengthRef = useRef(messages.length);
  const prevStreamingRef = useRef(false);

  // ─── scrollMessagesToBottom ───
  const scrollMessagesToBottom = useCallback((behavior: 'smooth' | 'instant' = 'instant') => {
    const el = messagesContainerRef.current;
    if (!el) return;
    if (behavior === 'smooth') {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    } else {
      el.scrollTop = el.scrollHeight;
    }
  }, []);

  // Wire voice scroll-after-user-turn to scroll to bottom smoothly (matches original inline assignment)
  scrollAfterVoiceUserRef.current = () => scrollMessagesToBottom('smooth');

  // ─── loadOlderMessages ───
  const loadOlderMessages = useCallback(async () => {
    const sessionId = currentSessionIdRef.current;
    if (!sessionId || loadingOlderRef.current || !hasOlderMessages) return;
    if (!paginationReadyRef.current) return;
    if (Date.now() < paginationCooldownUntilRef.current) return;
    const first = messages.find((m) => m.role === 'user' || m.role === 'assistant');
    if (!first?.id) return;
    loadingOlderRef.current = true;
    setLoadingOlderMessages(true);
    setFreezeMessageLayout(true);
    const el = messagesContainerRef.current;
    if (el) {
      const anchorEl = el.querySelector(`[data-message-id="${first.id}"]`);
      if (anchorEl) {
        paginationAnchorMessageIdRef.current = first.id;
        paginationAnchorOffsetRef.current = anchorEl.getBoundingClientRect().top - el.getBoundingClientRect().top;
      } else {
        paginationAnchorMessageIdRef.current = null;
        paginationAnchorOffsetRef.current = null;
        paginationAnchorRef.current = { scrollTop: el.scrollTop, scrollHeight: el.scrollHeight };
      }
    }
    paginationCooldownUntilRef.current = Date.now() + 1000;
    try {
      const page = await sessions.getMessagesPage(sessionId, { limit: 20, before: first.id });
      const older = mapHistoryToUiMessages(page.messages);
      if (older.length === 0) {
        setHasOlderMessages(false);
        paginationAnchorMessageIdRef.current = null;
        paginationAnchorOffsetRef.current = null;
        paginationAnchorRef.current = null;
        return;
      }
      setMessages((prev) => {
        const seen = new Set(prev.map((m) => m.id));
        const prepend = older.filter((m) => !seen.has(m.id));
        return prepend.length ? [...prepend, ...prev] : prev;
      });
      setHasOlderMessages(page.hasMore);
    } catch {
      paginationAnchorMessageIdRef.current = null;
      paginationAnchorOffsetRef.current = null;
      paginationAnchorRef.current = null;
      /* best-effort */
    } finally {
      loadingOlderRef.current = false;
      setLoadingOlderMessages(false);
      window.setTimeout(() => setFreezeMessageLayout(false), 120);
    }
  }, [hasOlderMessages, messages, setMessages, currentSessionIdRef]);

  // ─── resetScrollState: called by session lifecycle on session switch ───
  const resetScrollState = useCallback(() => {
    setShowJumpPill(false);
    prevRealCountRef.current = 0;
    isAtBottomRef.current = false;
    paginationReadyRef.current = false;
    needsInitialScrollRef.current = true;
    lastScrollTopRef.current = 0;
    setInitialScrollDone(false);
    initialScrollDoneRef.current = false;
    paginationAnchorRef.current = null;
    paginationAnchorMessageIdRef.current = null;
    paginationAnchorOffsetRef.current = null;
    jumpSuppressScrollTopRef.current = null;
    setHasOlderMessages(false);
  }, []);

  // ─── Smart auto-scroll: track user scroll position ───
  useEffect(() => {
    const el = messagesContainerRef.current;
    if (!el) return;
    const onScroll = () => {
      const prevTop = lastScrollTopRef.current;
      const scrolledUp = el.scrollTop < prevTop - 4;
      lastScrollTopRef.current = el.scrollTop;

      if (
        paginationReadyRef.current
        && scrolledUp
        && Date.now() >= paginationCooldownUntilRef.current
        && el.scrollTop < 64
        && hasOlderMessages
        && !loadingOlderRef.current
      ) {
        void loadOlderMessages();
      }
      const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      const atBottom = distanceFromBottom < 80;
      isAtBottomRef.current = atBottom;
      if (atBottom) {
        jumpSuppressScrollTopRef.current = null;
        setShowJumpPill(false);
        return;
      }
      if (jumpSuppressScrollTopRef.current !== null) {
        const scrolledUpEnough = el.scrollTop < jumpSuppressScrollTopRef.current - 100;
        if (!scrolledUpEnough) {
          setShowJumpPill(false);
          return;
        }
        jumpSuppressScrollTopRef.current = null;
      }
      if (distanceFromBottom > 120) {
        setShowJumpPill(true);
      }
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [view, hasOlderMessages, loadOlderMessages]);

  // ─── Sync initialScrollDone ref ───
  useEffect(() => {
    initialScrollDoneRef.current = initialScrollDone;
  }, [initialScrollDone]);

  // ─── Scroll anchoring layout effect (pagination + initial scroll) ───
  useLayoutEffect(() => {
    const el = messagesContainerRef.current;
    if (!el) return;

    const anchorId = paginationAnchorMessageIdRef.current;
    const anchorOffset = paginationAnchorOffsetRef.current;
    if (anchorId && anchorOffset != null) {
      const anchorEl = el.querySelector(`[data-message-id="${anchorId}"]`);
      if (anchorEl) {
        const nextOffset = anchorEl.getBoundingClientRect().top - el.getBoundingClientRect().top;
        el.scrollTop += nextOffset - anchorOffset;
      }
      paginationAnchorMessageIdRef.current = null;
      paginationAnchorOffsetRef.current = null;
      paginationCooldownUntilRef.current = Date.now() + 400;
      return;
    }

    const anchor = paginationAnchorRef.current;
    if (anchor) {
      paginationAnchorRef.current = null;
      const delta = el.scrollHeight - anchor.scrollHeight;
      el.scrollTop = anchor.scrollTop + delta;
      paginationCooldownUntilRef.current = Date.now() + 400;
      return;
    }

    if (needsInitialScrollRef.current && messages.length > 0) {
      el.scrollTop = el.scrollHeight;
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
      if (atBottom) {
        needsInitialScrollRef.current = false;
        initialScrollDoneRef.current = true;
        setInitialScrollDone(true);
        paginationReadyRef.current = true;
        isAtBottomRef.current = true;
        lastScrollTopRef.current = el.scrollTop;
        paginationCooldownUntilRef.current = Date.now() + 600;
        if (sessionRestoringRef.current) {
          setSessionRestoring(false);
          sessionRestoringRef.current = false;
        }
      }
    }
  }, [messages.length, setSessionRestoring, sessionRestoringRef]);

  // ─── Initial scroll timer (fallback for layout effect) ───
  useEffect(() => {
    if (!needsInitialScrollRef.current || messages.length === 0) return;
    const timer = window.setTimeout(() => {
      const el = messagesContainerRef.current;
      if (!el || !needsInitialScrollRef.current) return;
      scrollMessagesToBottom('instant');
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
      if (atBottom) {
        needsInitialScrollRef.current = false;
        initialScrollDoneRef.current = true;
        setInitialScrollDone(true);
        paginationReadyRef.current = true;
        isAtBottomRef.current = true;
        lastScrollTopRef.current = el.scrollTop;
        paginationCooldownUntilRef.current = Date.now() + 600;
        if (sessionRestoringRef.current) {
          setSessionRestoring(false);
          sessionRestoringRef.current = false;
        }
      }
    }, 50);
    return () => window.clearTimeout(timer);
  }, [messages.length, scrollMessagesToBottom, setSessionRestoring, sessionRestoringRef]);

  // ─── Safety net: never leave the restore overlay stuck if scroll anchoring fails ───
  useEffect(() => {
    if (!sessionRestoring) return;
    const timer = window.setTimeout(() => {
      if (!sessionRestoringRef.current) return;
      setSessionRestoring(false);
      sessionRestoringRef.current = false;
      needsInitialScrollRef.current = false;
      initialScrollDoneRef.current = true;
      setInitialScrollDone(true);
      paginationReadyRef.current = true;
      scrollMessagesToBottom('instant');
    }, 2500);
    return () => window.clearTimeout(timer);
  }, [sessionRestoring, scrollMessagesToBottom, setSessionRestoring, sessionRestoringRef]);

  // ─── Auto-scroll only when user is at bottom — also on streaming content updates ───
  useEffect(() => {
    const lengthChanged = messages.length !== prevMessagesLengthRef.current;
    if (lengthChanged) prevMessagesLengthRef.current = messages.length;
    if (!lengthChanged && !streaming) return;
    const realMsgsCount = lengthChanged
      ? messages.filter(m => m.role === 'user' || m.role === 'assistant').length
      : prevRealCountRef.current;
    const countChanged = lengthChanged && realMsgsCount > prevRealCountRef.current;
    if (countChanged) prevRealCountRef.current = realMsgsCount;
    if (!isAtBottomRef.current) {
      if (countChanged) setShowJumpPill(true);
      return;
    }
    const behavior = countChanged ? 'smooth' : 'instant';
    // New message: scroll immediately; streaming chunks: throttle to ~12 fps.
    if (behavior === 'smooth') {
      if (scrollToBottomTimerRef.current !== null) {
        window.clearTimeout(scrollToBottomTimerRef.current);
        scrollToBottomTimerRef.current = null;
        pendingScrollBehaviorRef.current = null;
      }
      scrollMessagesToBottom('smooth');
      return;
    }
    if (scrollToBottomTimerRef.current !== null) {
      pendingScrollBehaviorRef.current = behavior;
      return;
    }
    pendingScrollBehaviorRef.current = behavior;
    scrollToBottomTimerRef.current = window.setTimeout(() => {
      scrollToBottomTimerRef.current = null;
      const pending = pendingScrollBehaviorRef.current;
      pendingScrollBehaviorRef.current = null;
      if (pending) scrollMessagesToBottom(pending);
    }, 80);
  }, [messages, streaming, scrollMessagesToBottom]);

  // ─── Pin scroll to bottom when a turn finishes — content-visibility/layout reflow can jump upward ───
  useLayoutEffect(() => {
    const wasStreaming = prevStreamingRef.current;
    prevStreamingRef.current = streaming;
    if (!wasStreaming || streaming || !isAtBottomRef.current) return;
    scrollMessagesToBottom('instant');
    requestAnimationFrame(() => scrollMessagesToBottom('instant'));
  }, [streaming, scrollMessagesToBottom]);

  return {
    // State
    showJumpPill,
    setShowJumpPill,
    hasOlderMessages,
    setHasOlderMessages,
    loadingOlderMessages,
    setLoadingOlderMessages,
    freezeMessageLayout,
    setFreezeMessageLayout,
    initialScrollDone,
    setInitialScrollDone,
    // Refs
    messagesContainerRef,
    bottomRef,
    isAtBottomRef,
    jumpSuppressScrollTopRef,
    // Callbacks
    scrollMessagesToBottom,
    loadOlderMessages,
    resetScrollState,
  };
}
