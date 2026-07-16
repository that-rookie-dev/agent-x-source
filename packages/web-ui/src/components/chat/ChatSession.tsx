import React from 'react';
import Box from '@mui/material/Box';
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
  // Stable dispatch value.
  const { setChildSessionDrawer } = useChatSessionSettersContext();

  const chatView = (
    <>
      <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, position: 'relative' }}>
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
