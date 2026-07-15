import React from 'react';
import {
  CommandPalette,
  SessionSearchModal,
  CheckpointDrawer,
} from '../ChatEnhancements';
import ModeEscalationModal from '../ModeEscalationModal';
import StepCapModal from '../StepCapModal';
import ModeSuggestionModal from '../ModeSuggestionModal';
import { CrewProfileDialog } from '../crew/CrewProfileDialog';
import { FolderPickerModal } from '../FolderPickerModal';
import {
  HyperdriveDisclaimerDialog,
  ClearSessionDialog,
  FolderConsentDialog,
  FolderPickerLoadingOverlay,
} from './ChatDialogs';
import { chat, sessionSettings, agent } from '../../api';
import {
  useChatSessionIdentityContext,
  useChatSessionPrivacyContext,
  useChatModalContext,
  useChatSessionSettersContext,
  useChatNavigationHandlersContext,
  useChatModalActionsContext,
} from './ChatSessionProvider';

export const ChatModals = React.memo(function ChatModals() {
  // Session identity and privacy.
  const { currentSessionId } = useChatSessionIdentityContext();
  const { isCrewPrivateSession } = useChatSessionPrivacyContext();
  // Modal state only — ChatModals does NOT re-render on streaming chunks.
  const {
    paletteOpen, paletteActions, searchOpen, checkpointsOpen,
    folderPickerOpen, folderPickerCallback, modeEscalation,
    crewDossierOpen, crewDossierCrew, modeSuggestOpen, stepCapPrompt,
    showDisclaimer, clearSessionModalOpen, clearSessionBusy,
    folderConsentOpen, folderPickerLoading,
  } = useChatModalContext();
  // Stable dispatch values — setters, handlers, refs.
  const {
    navigate, setPaletteOpen, setSearchOpen, setCheckpointsOpen,
    setMessages, setTokenUsed, setTokenInput, setTokenOutput,
    setFolderPickerOpen, setFolderPickerCallback, setModeEscalation,
    setAgentMode, setStreaming, setCrewDossierOpen, setCrewDossierCrew,
    setModeSuggestOpen, setStepCapPrompt, setShowDisclaimer,
    setClearSessionModalOpen, setFolderConsentOpen, pendingSendTextRef,
  } = useChatSessionSettersContext();
  // Navigation handlers.
  const { handleArchiveSession, handleDeleteSessionContent, handleFolderConsentConfirm } = useChatNavigationHandlersContext();
  // Modal actions.
  const { sendAfterModeChoice, confirmHyperdrive } = useChatModalActionsContext();

  return (
    <>
      {/* ─── Global enhancement modals ─── */}
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} actions={paletteActions} />
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
      <ModeEscalationModal
        open={!!modeEscalation && !isCrewPrivateSession}
        tool={modeEscalation?.tool ?? ''}
        reason={modeEscalation?.reason ?? ''}
        onSwitch={() => {
          agent.respondToModeEscalation(true).then(() => {
            setAgentMode('agent');
            sessionSettings.setMode('agent').catch(() => {});
          }).catch(() => {});
          setModeEscalation(null);
        }}
        onSkip={() => {
          agent.respondToModeEscalation(false).catch(() => {});
          setModeEscalation(null);
          setStreaming(false);
        }}
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
      <ModeSuggestionModal
        open={modeSuggestOpen}
        onSwitch={() => {
          setModeSuggestOpen(false);
          const text = pendingSendTextRef.current;
          pendingSendTextRef.current = null;
          if (text) void sendAfterModeChoice(text, true);
        }}
        onStay={() => {
          setModeSuggestOpen(false);
          const text = pendingSendTextRef.current;
          pendingSendTextRef.current = null;
          if (text) void sendAfterModeChoice(text, false);
        }}
        onClose={() => {
          setModeSuggestOpen(false);
          pendingSendTextRef.current = null;
        }}
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
      {/* Hyperdrive Disclaimer */}
      <HyperdriveDisclaimerDialog
        open={showDisclaimer}
        onClose={() => setShowDisclaimer(false)}
        onConfirm={confirmHyperdrive}
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
