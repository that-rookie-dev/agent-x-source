import React from 'react';
import Box from '@mui/material/Box';
import { colors } from '../../theme';
import { hyperdrive } from '../../styles/brands';
import { ChildSessionDrawer } from '../../chat/ChildSessionDrawer';
import { ChatHeader } from './ChatHeader';
import { ChatRightSidebar } from './ChatRightSidebar';
import { SessionListView } from './SessionListView';
import { ChatBanners } from './ChatBanners';
import { ChatThreadArea } from './ChatThreadArea';
import { ChatInputArea } from './ChatInputArea';
import { ChatModals } from './ChatModals';
import {
  useChatViewContext,
  useChatSessionIdentityContext,
  useChatHyperdriveModeContext,
  useChatSessionSettersContext,
} from './ChatSessionProvider';
import {
  panelHeaderRowSx,
  sidebarSectionHeaderSx,
  sidebarSectionHeaderWithDividerSx,
  sidebarSectionContentSx,
} from '../ChatPanel';

export const ChatSession = React.memo(function ChatSession() {
  // View / drawer state.
  const { view, childSessionDrawer } = useChatViewContext();
  // Session identity.
  const { currentSessionTitle } = useChatSessionIdentityContext();
  // Hyperdrive mode.
  const { hyperdriveMode } = useChatHyperdriveModeContext();
  // Stable dispatch value.
  const { setChildSessionDrawer } = useChatSessionSettersContext();

  const chatView = (
    <>
      <Box sx={{
        flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, position: 'relative',
        ...(hyperdriveMode ? {
          borderRadius: 2,
          transition: 'all 0.6s ease',
          '&::before': {
            content: '""',
            position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 0,
            background: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(255,0,255,0.03) 2px, rgba(255,0,255,0.03) 4px)',
            animation: 'agentx-scanlines 4s linear infinite',
            borderRadius: 'inherit',
          },
        } : {}),
      }}>
        {/* Hyperdrive cosmic particles background */}
        {hyperdriveMode && (
          <Box sx={{
            position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none', zIndex: 0,
            borderRadius: 'inherit',
          }}>
            {Array.from({ length: 30 }).map((_, i) => (
              <Box key={i} sx={{
                position: 'absolute',
                width: 1 + Math.random() * 2, height: 1 + Math.random() * 2,
                bgcolor: i % 3 === 0 ? hyperdrive.magenta : i % 3 === 1 ? hyperdrive.cyan : colors.ink,
                borderRadius: '50%',
                left: `${Math.random() * 100}%`, top: `${Math.random() * 100}%`,
                opacity: 0.3 + Math.random() * 0.7,
                animation: `agentx-flicker ${2 + Math.random() * 4}s ease-in-out ${Math.random() * 3}s infinite`,
              }} />
            ))}
          </Box>
        )}
        {/* Header */}
        <ChatHeader panelHeaderRowSx={panelHeaderRowSx} />

        <ChatBanners />

        <ChatThreadArea />

        <ChatInputArea />

        <ChildSessionDrawer
          open={!!childSessionDrawer}
          state={childSessionDrawer}
          parentSessionTitle={currentSessionTitle ?? undefined}
          onClose={() => setChildSessionDrawer(null)}
        />
      </Box>

      {/* ─── Right sidebar ─── */}
      <ChatRightSidebar
        sidebarSectionHeaderSx={sidebarSectionHeaderSx}
        sidebarSectionHeaderWithDividerSx={sidebarSectionHeaderWithDividerSx}
        sidebarSectionContentSx={sidebarSectionContentSx}
      />
    </>
  );

  return (
    <Box sx={{ height: '100%', display: 'flex' }}>
      {view === 'sessions' ? (
        <SessionListView />
      ) : (
        chatView
      )}

      {/* ─── Global enhancement modals ─── */}
      <ChatModals />
    </Box>
  );
});
