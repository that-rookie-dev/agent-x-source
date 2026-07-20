import React from 'react';
import {
  SessionSearchModal,
  CheckpointDrawer,
} from '../ChatEnhancements';
import StepCapModal from '../StepCapModal';
import { CrewProfileDialog } from '../crew/CrewProfileDialog';
import { FolderPickerModal } from '../FolderPickerModal';
import {
  ClearSessionDialog,
  FolderConsentDialog,
  FolderPickerLoadingOverlay,
} from './ChatDialogs';
import { chat, agent } from '../../api';
import {
  useChatSessionIdentityContext,
  useChatModalContext,
  useChatSessionSettersContext,
  useChatNavigationHandlersContext,
} from './ChatSessionProvider';

export const ChatModals = React.memo(function ChatModals() {
  // Session identity.
  const { currentSessionId } = useChatSessionIdentityContext();
  // Modal state only — ChatModals does NOT re-render on streaming chunks.
  const {
    searchOpen, checkpointsOpen,
    folderPickerOpen, folderPickerCallback,
    crewDossierOpen, crewDossierCrew, stepCapPrompt,
    clearSessionModalOpen, clearSessionBusy,
    folderConsentOpen, folderPickerLoading,
  } = useChatModalContext();
  // Stable dispatch values — setters, handlers, refs.
  const {
    navigate, setSearchOpen, setCheckpointsOpen,
    setMessages, setTokenUsed, setTokenInput, setTokenOutput,
    setFolderPickerOpen, setFolderPickerCallback,
    setStreaming, setCrewDossierOpen, setCrewDossierCrew,
    setStepCapPrompt,
    setClearSessionModalOpen, setFolderConsentOpen,
  } = useChatSessionSettersContext();
  // Navigation handlers.
  const { handleArchiveSession, handleDeleteSessionContent, handleFolderConsentConfirm } = useChatNavigationHandlersContext();

  return (
    <>
      {/* ─── Global enhancement modals ─── */}
      <SessionSearchModal
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        onPickSession={(sid) => { navigate(`/console/chat/${sid}`); }}
      />
      <CheckpointDrawer
        open={checkpointsOpen}
        onClose={() => setCheckpointsOpen(false)}
        sessionId={currentSessionId}
        onRestored={async () => {
          try {
            const h = await chat.history();
            const visible = h.filter(m => m.role !== 'system');
            setMessages(visible.map(m => ({ ...m, streaming: false })));
            const totalUsed = visible.reduce((acc, m) => acc + (m.tokenCount ?? Math.ceil((m.content?.length ?? 0) / 4)), 0);
            setTokenUsed(totalUsed);
            const inputEst = visible.filter(m => m.role === 'user').reduce((acc, m) => acc + (m.tokenCount ?? Math.ceil((m.content?.length ?? 0) / 4)), 0);
            const outputEst = visible.filter(m => m.role === 'assistant').reduce((acc, m) => acc + (m.tokenCount ?? Math.ceil((m.content?.length ?? 0) / 4)), 0);
            setTokenInput(inputEst);
            setTokenOutput(outputEst);
          } catch { /* ignore */ }
        }}
      />
      <FolderPickerModal
        open={folderPickerOpen}
        onSelect={(path) => {
          setFolderPickerOpen(false);
          folderPickerCallback?.(path);
          setFolderPickerCallback(null);
        }}
        onCancel={() => { setFolderPickerOpen(false); setFolderPickerCallback(null); }}
      />
      <CrewProfileDialog
        open={crewDossierOpen}
        crew={crewDossierCrew}
        imported={false}
        importLoading={false}
        onClose={() => { setCrewDossierOpen(false); setCrewDossierCrew(null); }}
        onImport={() => {}}
        onRemove={() => {}}
      />
      <StepCapModal
        open={!!stepCapPrompt}
        currentSteps={stepCapPrompt?.currentSteps ?? 25}
        maxSteps={stepCapPrompt?.maxSteps ?? 25}
        onContinue={() => {
          agent.respondToStepCap(true).catch(() => {});
          setStepCapPrompt(null);
        }}
        onStop={() => {
          agent.respondToStepCap(false).catch(() => {});
          setStepCapPrompt(null);
          setStreaming(false);
        }}
      />
      <ClearSessionDialog
        open={clearSessionModalOpen}
        busy={clearSessionBusy}
        onClose={() => setClearSessionModalOpen(false)}
        onArchive={() => { void handleArchiveSession(); }}
        onDelete={() => { void handleDeleteSessionContent(); }}
      />
      <FolderConsentDialog
        open={folderConsentOpen}
        onClose={() => setFolderConsentOpen(false)}
        onConfirm={handleFolderConsentConfirm}
      />
      <FolderPickerLoadingOverlay loading={folderPickerLoading} />
    </>
  );
});
