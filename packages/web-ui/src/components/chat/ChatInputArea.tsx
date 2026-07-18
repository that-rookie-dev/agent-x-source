import React, { useCallback, useState } from 'react';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Chip from '@mui/material/Chip';
import Tooltip from '@mui/material/Tooltip';
import AddIcon from '@mui/icons-material/Add';
import CloseIcon from '@mui/icons-material/Close';
import InsertDriveFileIcon from '@mui/icons-material/InsertDriveFile';
import { colors, alphaColor } from '../../theme';
import { ActionPreviewCard } from '../integrations/ActionPreviewCard';
import { ChatInputBar } from '../ChatInputBar';
import { ChatVoicePanel } from '../voice/ChatVoicePanel';
import { WebSearchGlobeToggle } from '../WebSearchGlobeToggle';
import { CrewSuggestionToggle } from '../CrewSuggestionToggle';
import { ChatToolbar } from './ChatToolbar';
import { PermissionBanner } from './PermissionBanner';
import {
  useChatMessagesContext,
  useChatPromptsContext,
  useChatSessionIdentityContext,
  useChatSessionPrivacyContext,
  useChatCrewListContext,
  useChatModelDataContext,
  useChatModelMenuContext,
  useChatInputGateContext,
  useChatComposerContext,
  useChatBypassPermissionsContext,
  useChatSessionSettersContext,
  useChatInputHandlersContext,
} from './ChatSessionProvider';

export const ChatInputArea = React.memo(function ChatInputArea() {
  // Message thread values — re-renders on stream chunks (streaming flag, turn activity, etc.).
  const { streaming, sessionRestoring, turnActivity } = useChatMessagesContext();
  // Prompts — re-render only when a permission/tool prompt appears/dismisses.
  const { permissionPrompt, pendingPermissionCount } = useChatPromptsContext();
  // Session identity and privacy.
  const { currentSessionId, coreSession } = useChatSessionIdentityContext();
  const { isCrewPrivateSession, crewPrivateHost } = useChatSessionPrivacyContext();
  // Crew list and bypass permissions.
  const { crewList } = useChatCrewListContext();
  const { bypassPermissions } = useChatBypassPermissionsContext();
  // Model / provider data.
  const {
    currentModel, currentProvider, currentProviderId, providerList, modelList,
    loadingModels,
  } = useChatModelDataContext();
  // Model / provider menu anchors.
  const { providerMenuAnchor, modelMenuAnchor } = useChatModelMenuContext();
  // Input gate and composer.
  const { questionnairePending, sendBlocked, sendBlockedReason } = useChatInputGateContext();
  const {
    attachments, composerMode, inputClearSignal, voiceAutoStart, webSearchAvailable,
    webSearchForce, crewSuggestionRequested, voiceCtx,
  } = useChatComposerContext();
  // Stable dispatch values — refs, handlers, setters.
  const {
    setPermissionPrompt, setPendingPermissionCount, setVoiceAutoStart,
    setProviderMenuAnchor, setCurrentProvider, setCurrentModel,
    setModelList, setModelMenuAnchor, setTokenTotal, setTokenReserved,
    setComposerMode, fileInputRef, inputBarRef, tokenReservedRef,
    toggleBypassPermissions, revokeSessionPermissions,
  } = useChatSessionSettersContext();
  // Input handlers.
  const {
    handleSend, handleCancel, handleStopAndSend, handleAddToQueue, handleSteer,
    handleFileSelect, handleRemoveAttachment,
    handlePermissionRespond, handlePermissionRespondBatch,
    handleWebSearchToggle, handleCrewSuggestionToggle,
    handleVoiceUserPending, handleVoiceUserDiscarded, handleVoiceTranscript, handleVoiceTiming,
  } = useChatInputHandlersContext();

  // Stable callbacks so React.memo on leaf components (PermissionBanner) is effective.
  const handlePermissionDismiss = useCallback(() => {
    setPermissionPrompt(null);
    setPendingPermissionCount((prev) => Math.max(0, prev - 1));
  }, [setPermissionPrompt, setPendingPermissionCount]);
  const handlePermissionApproveAll = useCallback(() => {
    setPermissionPrompt(null);
    setPendingPermissionCount(0);
  }, [setPermissionPrompt, setPendingPermissionCount]);

  const [isDragging, setIsDragging] = useState(false);
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);
  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    handleFileSelect(e.dataTransfer.files);
  }, [handleFileSelect]);

  return (
    <Box sx={{ px: 2, pb: 1.5, pt: 1, position: 'relative' }}>
      {/* Attachment chips */}
      {attachments.length > 0 && (
        <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mb: 0.75 }}>
          {attachments.map((a, i) => (
            <Chip
              key={i}
              size="small"
              icon={<InsertDriveFileIcon sx={{ fontSize: '13px !important' }} />}
              label={a.name}
              onDelete={() => handleRemoveAttachment(i)}
              deleteIcon={<CloseIcon sx={{ fontSize: '13px !important' }} />}
              sx={{ fontSize: '0.6rem', height: 22, bgcolor: colors.bg.tertiary, border: `1px solid ${colors.border.default}` }}
            />
          ))}
        </Box>
      )}


      {/* Single unified box: input + toolbar — border tinted by mode */}
      <Box
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        sx={{
        position: 'relative',
        zIndex: 1,
        border: `1px solid ${isDragging ? colors.accent.blue : bypassPermissions ? alphaColor(colors.accent.orange, '60') : colors.border.default}`,
        borderRadius: '14px',
        bgcolor: isDragging ? alphaColor(colors.accent.blue, '06') : colors.bg.tertiary,
        backgroundImage: bypassPermissions ? `linear-gradient(${alphaColor(colors.accent.orange, '08')}, ${alphaColor(colors.accent.orange, '08')})` : 'none',
        transition: 'border-color 0.2s, background-color 0.2s, opacity 0.2s ease',
        opacity: questionnairePending || sessionRestoring ? 0.42 : 1,
        pointerEvents: questionnairePending || sessionRestoring ? 'none' : 'auto',
        '&:focus-within': questionnairePending ? {} : { borderColor: bypassPermissions ? alphaColor(colors.accent.orange, '90') : colors.border.strong },
      }}>
        {/* Permission banner above input */}
        {permissionPrompt && (
          <Box sx={{ px: 1.25, pt: 1.25, pb: 0.5 }}>
            {permissionPrompt.integrationPreview ? (
              <ActionPreviewCard
                preview={permissionPrompt.integrationPreview}
                pendingCount={pendingPermissionCount}
                onAllowOnce={() => { void handlePermissionRespond('allow_once'); }}
                onAllowAlways={() => { void handlePermissionRespond('allow_always'); }}
                onDeny={() => { void handlePermissionRespond('deny'); }}
                onApproveAll={() => { void handlePermissionRespondBatch('allow_once'); }}
              />
            ) : (
              <PermissionBanner
                prompt={permissionPrompt}
                pendingCount={pendingPermissionCount}
                onRespond={handlePermissionDismiss}
                onApproveAll={handlePermissionApproveAll}
              />
            )}
          </Box>
        )}
        <input ref={fileInputRef} type="file" multiple hidden onChange={(e) => { handleFileSelect(e.target.files); e.currentTarget.value = ''; }} accept="image/*,.pdf,.txt,.md,.json,.ts,.tsx,.js,.jsx,.py,.yaml,.yml,.toml,.csv,.xml,.html,.css,.sh,.sql,.log,.env,.cfg,.ini,.rs,.go,.java,.c,.cpp,.h,.rb,.php,.swift,.kt,.docx,.xlsx,.pptx" />
        {composerMode === 'text' ? (
        <ChatInputBar
          ref={inputBarRef}
          streaming={streaming}
          inputDisabled={questionnairePending}
          sendBlocked={sendBlocked || questionnairePending}
          sendBlockedReason={sendBlockedReason}
          hasAttachments={attachments.length > 0}
          crewList={crewList}
          disableMentions={isCrewPrivateSession || coreSession}
          placeholder={
            coreSession
              ? 'Talk to Agent-X — your lifelong wingman…'
              : isCrewPrivateSession && crewPrivateHost
                ? `Message ${crewPrivateHost.name}...`
                : undefined
          }
          onSend={handleSend}
          onCancel={handleCancel}
          onStopAndSend={handleStopAndSend}
          onAddToQueue={handleAddToQueue}
          onSteer={handleSteer}
          clearSignal={inputClearSignal}
        />
        ) : (
          <ChatVoicePanel
            chatSessionId={currentSessionId}
            onVoiceUserPending={handleVoiceUserPending}
            onVoiceUserDiscarded={handleVoiceUserDiscarded}
            onTranscriptFinal={handleVoiceTranscript}
            onVoiceTiming={handleVoiceTiming}
            autoStart={voiceAutoStart}
            onAutoStartConsumed={() => setVoiceAutoStart(false)}
          />
        )}

        {/* Toolbar row */}
        <Box sx={{
          display: 'flex', alignItems: 'center', gap: 0.5, px: 1.25, py: 0.5,
          borderTop: `1px solid ${alphaColor(colors.border.default, '20')}`,
        }}>
        {/* Plus button for file attach */}
          <Tooltip title="Attach files" arrow>
            <IconButton size="small" onClick={() => fileInputRef.current?.click()} sx={{ color: colors.text.dim, p: 0.25, '&:hover': { color: colors.text.secondary } }}>
              <AddIcon sx={{ fontSize: 16 }} />
            </IconButton>
          </Tooltip>

          <WebSearchGlobeToggle
            available={webSearchAvailable}
            enabled={webSearchForce}
            onToggle={handleWebSearchToggle}
          />

          {!isCrewPrivateSession && !coreSession && (
            <CrewSuggestionToggle
              available
              enabled={crewSuggestionRequested}
              onToggle={handleCrewSuggestionToggle}
            />
          )}

          <ChatToolbar
            isCrewPrivateSession={isCrewPrivateSession}
            bypassPermissions={bypassPermissions}
            toggleBypassPermissions={toggleBypassPermissions}
            revokeSessionPermissions={revokeSessionPermissions}
            providerList={providerList}
            currentProvider={currentProvider}
            providerMenuAnchor={providerMenuAnchor}
            setProviderMenuAnchor={setProviderMenuAnchor}
            setCurrentProvider={setCurrentProvider}
            setCurrentModel={setCurrentModel}
            setModelList={setModelList}
            modelMenuAnchor={modelMenuAnchor}
            setModelMenuAnchor={setModelMenuAnchor}
            currentModel={currentModel}
            modelList={modelList}
            loadingModels={loadingModels}
            currentProviderId={currentProviderId}
            setTokenTotal={setTokenTotal}
            setTokenReserved={(n: number) => { tokenReservedRef.current = n; setTokenReserved(n); }}
            streaming={streaming}
            turnActivity={turnActivity}
            composerMode={composerMode}
            setComposerMode={setComposerMode}
            voiceReady={!!voiceCtx?.voiceReady}
          />
        </Box>
      </Box>
    </Box>
  );
});
