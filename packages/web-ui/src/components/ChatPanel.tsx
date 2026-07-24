import React from 'react';
import { ChatSessionProvider } from './chat/ChatSessionProvider';
import { ChatSession } from './chat/ChatSession';

// ─── CSS Keyframes (injected once) ───
import { colors, alphaColor } from '../theme';

const styleId = 'agentx-chat-keyframes';
if (!document.getElementById(styleId)) {
  const style = document.createElement('style');
  style.id = styleId;
  style.textContent = `
    @keyframes agentx-pulse { 0%, 80%, 100% { opacity: 0.3; transform: scale(0.8); } 40% { opacity: 1; transform: scale(1.1); } }
    @keyframes agentx-shimmer { 0% { background-position: -200% 0; } 100% { background-position: 200% 0; } }
    @keyframes agentx-fadeIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
    @keyframes agentx-spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }
    /* Conversational beat rail — opacity-only, one live node at a time */
    @keyframes agentx-rail-breathe {
      0%, 100% { opacity: 0.45; }
      50% { opacity: 1; }
    }
    @keyframes agentx-beat-in {
      from { opacity: 0; transform: translateY(4px); }
      to { opacity: 1; transform: translateY(0); }
    }
  `;
  document.head.appendChild(style);
}

/** Shared height for chat header and right-sidebar section headers. */
export const CHAT_HEADER_HEIGHT = 36;

export const panelHeaderRowSx = {
  px: 1.5,
  py: 0.5,
  height: CHAT_HEADER_HEIGHT,
  boxSizing: 'border-box' as const,
  borderBottom: `1px solid ${colors.border.default}`,
  display: 'flex',
  alignItems: 'center',
  gap: 0.5,
  flexShrink: 0,
};

export const sidebarSectionHeaderSx = (expanded: boolean) => ({
  ...panelHeaderRowSx,
  borderBottom: expanded ? `1px solid ${colors.border.default}` : 'none',
  cursor: 'pointer',
  '&:hover': { bgcolor: alphaColor(colors.bg.tertiary, '40') },
});

export const sidebarSectionHeaderWithDividerSx = (expanded: boolean) => ({
  ...sidebarSectionHeaderSx(expanded),
  borderTop: `1px solid ${colors.border.default}`,
});

export const sidebarSectionContentSx = {
  px: 1.5,
  pt: 1,
  pb: 1.5,
};

interface ChatPanelProps {
  sessionId?: string;
  coreSession?: boolean;
}

/**
 * ChatPanel — thin React.memo layout wrapper.
 * Does NOT own any chat state; does NOT re-render on streaming chunks.
 * All state lives in ChatSessionProvider (via useChatSessionState hook).
 * All UI lives in ChatSession (consumes context).
 */
export const ChatPanel = React.memo(function ChatPanel({ sessionId, coreSession = false }: ChatPanelProps) {
  return (
    <ChatSessionProvider sessionId={sessionId} coreSession={coreSession}>
      <ChatSession />
    </ChatSessionProvider>
  );
});
