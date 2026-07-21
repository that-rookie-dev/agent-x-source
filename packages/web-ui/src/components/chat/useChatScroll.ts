// useChatScroll.ts — extracted from useChatSessionState.tsx
// Owns all scroll-related state, refs, callbacks, and effects.
// Self-contained: only needs messages, streaming, sessionRestoring, view, and a couple of shared refs.

import React, { useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react';
import { sessions } from '../../api';
import { mapHistoryToUiMessages } from '../../chat/restoreMessages';
import { MESSAGE_PAGE_SIZE, MESSAGE_WINDOW_MAX } from '../../chat/messageWindow';
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
  /** When false, live trim is paused (user is browsing older history). */
  const liveCapEnabledRef = useRef(true);
  /** True after a load-more dropped the newest page — jump-to-latest must re-fetch. */
  const detachedFromTailRef = useRef(false);

  // ─── scrollMessagesToBottom ───
  const scrollMessagesToBottom = useCallback((behavior: 'smooth' | 'instant' = 'instant') => {
    const el = messagesContainerRef.current;
    if (!el) return;
    // Use bottomRef.scrollIntoView for reliable bottom alignment — works even
    // when content-visibility: auto defers rendering of some messages.
    if (bottomRef.current) {
      bottomRef.current.scrollIntoView({ block: 'end', behavior });
    } else if (behavior === 'smooth') {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    } else {
      el.scrollTop = el.scrollHeight;
    }
  }, []);

  // ─── Live recycling: keep only the newest page while attached to the tail ───
  useEffect(() => {
    if (!liveCapEnabledRef.current) return;
    if (messages.length <= MESSAGE_PAGE_SIZE) return;
    setHasOlderMessages(true);
    setMessages((prev) => (prev.length > MESSAGE_PAGE_SIZE ? prev.slice(-MESSAGE_PAGE_SIZE) : prev));
  }, [messages.length, setMessages]);

  // ─── loadOlderMessages (explicit chip only — no auto scroll-up load) ───
  const loadOlderMessages = useCallback(async () => {
    const sessionId = currentSessionIdRef.current;
    if (!sessionId || loadingOlderRef.current || !hasOlderMessages) return;
    if (!paginationReadyRef.current) return;
    if (Date.now() < paginationCooldownUntilRef.current) return;
    const first = messages.find((m) => m.role === 'user' || m.role === 'assistant');
    if (!first?.id) return;
    loadingOlderRef.current = true;
    liveCapEnabledRef.current = false;
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
      const page = await sessions.getMessagesPage(sessionId, { limit: MESSAGE_PAGE_SIZE, before: first.id });
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
        if (!prepend.length) return prev;
        let next = [...prepend, ...prev];
        // Sliding window: once we exceed two pages, drop the newest page.
        if (next.length > MESSAGE_WINDOW_MAX) {
          next = next.slice(0, next.length - MESSAGE_PAGE_SIZE);
          detachedFromTailRef.current = true;
        }
        return next;
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

  // ─── Jump / reset to the live latest window ───
  const resetToLatestMessages = useCallback(async () => {
    const sessionId = currentSessionIdRef.current;
    if (!sessionId) {
      scrollMessagesToBottom('smooth');
      return;
    }
    if (!detachedFromTailRef.current && liveCapEnabledRef.current) {
      liveCapEnabledRef.current = true;
      setMessages((prev) => (prev.length > MESSAGE_PAGE_SIZE ? prev.slice(-MESSAGE_PAGE_SIZE) : prev));
      scrollMessagesToBottom('smooth');
      return;
    }
    setLoadingOlderMessages(true);
    setFreezeMessageLayout(true);
    try {
      const page = await sessions.getMessagesPage(sessionId, { limit: MESSAGE_PAGE_SIZE });
      const latest = mapHistoryToUiMessages(page.messages);
      setMessages(latest);
      setHasOlderMessages(page.hasMore);
      liveCapEnabledRef.current = true;
      detachedFromTailRef.current = false;
      isAtBottomRef.current = true;
      setShowJumpPill(false);
      requestAnimationFrame(() => scrollMessagesToBottom('instant'));
    } catch {
      scrollMessagesToBottom('smooth');
    } finally {
      setLoadingOlderMessages(false);
      window.setTimeout(() => setFreezeMessageLayout(false), 120);
    }
  }, [currentSessionIdRef, scrollMessagesToBottom, setMessages]);

  // ─── resetScrollState: called by session lifecycle on session switch ───
  const resetScrollState = useCallback(() => {
    setShowJumpPill(false);
    prevRealCountRef.current = 0;
    // Set to true so auto-scroll works immediately after session switch.
    // The initial scroll effect will handle the actual scroll-to-bottom.
    isAtBottomRef.current = true;
    paginationReadyRef.current = false;
    needsInitialScrollRef.current = true;
    lastScrollTopRef.current = 0;
    setInitialScrollDone(false);
    initialScrollDoneRef.current = false;
    paginationAnchorRef.current = null;
    paginationAnchorMessageIdRef.current = null;
    paginationAnchorOffsetRef.current = null;
    jumpSuppressScrollTopRef.current = null;
    liveCapEnabledRef.current = true;
    detachedFromTailRef.current = false;
    setHasOlderMessages(false);
  }, []);

  // ─── Smart auto-scroll: track user scroll position (no auto load-older) ───
  useEffect(() => {
    const el = messagesContainerRef.current;
    if (!el) return;
    const onScroll = () => {
      lastScrollTopRef.current = el.scrollTop;
      const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      const atBottom = distanceFromBottom < 80;
      isAtBottomRef.current = atBottom;
      if (atBottom) {
        jumpSuppressScrollTopRef.current = null;
        setShowJumpPill(false);
        // Re-attach to the live window once the user returns to the newest end
        // (unless a prior load-more dropped the true tail).
        if (!detachedFromTailRef.current) {
          liveCapEnabledRef.current = true;
        }
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
  }, [view]);

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
      // Force bottom on open — don't gate on atBottom (content-visibility can
      // report a false gap before heights expand).
      if (bottomRef.current) {
        bottomRef.current.scrollIntoView({ block: 'end' });
      }
      el.scrollTop = el.scrollHeight;
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
      // Follow-up passes after deferred layout / content-visibility expand.
      requestAnimationFrame(() => {
        if (bottomRef.current) bottomRef.current.scrollIntoView({ block: 'end' });
        const box = messagesContainerRef.current;
        if (box) box.scrollTop = box.scrollHeight;
      });
      window.setTimeout(() => {
        if (bottomRef.current) bottomRef.current.scrollIntoView({ block: 'end' });
        const box = messagesContainerRef.current;
        if (box) {
          box.scrollTop = box.scrollHeight;
          lastScrollTopRef.current = box.scrollTop;
          isAtBottomRef.current = true;
        }
      }, 120);
      window.setTimeout(() => {
        if (bottomRef.current) bottomRef.current.scrollIntoView({ block: 'end' });
        const box = messagesContainerRef.current;
        if (box) box.scrollTop = box.scrollHeight;
      }, 350);
    }
  }, [messages.length, setSessionRestoring, sessionRestoringRef]);

  // ─── Initial scroll timer (fallback for layout effect + content-visibility re-scroll) ───
  useEffect(() => {
    if (!needsInitialScrollRef.current || messages.length === 0) return;
    const timer = window.setTimeout(() => {
      const el = messagesContainerRef.current;
      if (!el || !needsInitialScrollRef.current) return;
      // Use bottomRef.scrollIntoView for reliable bottom alignment.
      if (bottomRef.current) {
        bottomRef.current.scrollIntoView({ block: 'end' });
      }
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
    }, 50);
    // Second pass: content-visibility: auto may not have expanded all messages
    // by 50ms. Re-scroll at 200ms to catch any late layout shifts.
    const timer2 = window.setTimeout(() => {
      if (!needsInitialScrollRef.current) return;
      const el = messagesContainerRef.current;
      if (!el) return;
      if (bottomRef.current) {
        bottomRef.current.scrollIntoView({ block: 'end' });
      }
      el.scrollTop = el.scrollHeight;
      needsInitialScrollRef.current = false;
      initialScrollDoneRef.current = true;
      setInitialScrollDone(true);
      paginationReadyRef.current = true;
      isAtBottomRef.current = true;
      lastScrollTopRef.current = el.scrollTop;
      if (sessionRestoringRef.current) {
        setSessionRestoring(false);
        sessionRestoringRef.current = false;
      }
    }, 200);
    return () => { window.clearTimeout(timer); window.clearTimeout(timer2); };
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

  // ─── Auto-scroll when user is at bottom — smooth for new entries and live updates ───
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
    // New list entries and streaming updates: always ease to the true bottom.
    const behavior: 'smooth' | 'instant' = 'smooth';
    if (countChanged || lengthChanged) {
      if (scrollToBottomTimerRef.current !== null) {
        window.clearTimeout(scrollToBottomTimerRef.current);
        scrollToBottomTimerRef.current = null;
        pendingScrollBehaviorRef.current = null;
      }
      scrollMessagesToBottom('smooth');
      // Second tick after layout settles (thoughts / tools expanding height).
      requestAnimationFrame(() => scrollMessagesToBottom('smooth'));
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
    resetToLatestMessages,
    resetScrollState,
  };
}
