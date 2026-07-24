import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Chip from '@mui/material/Chip';
import Tooltip from '@mui/material/Tooltip';
import CircularProgress from '@mui/material/CircularProgress';
import AddIcon from '@mui/icons-material/Add';
import CloseIcon from '@mui/icons-material/Close';
import InsertDriveFileIcon from '@mui/icons-material/InsertDriveFile';
import { colors, alphaColor } from '../../theme';
import { ActionPreviewCard } from '../integrations/ActionPreviewCard';
import { ChatInputBar } from '../ChatInputBar';
import { WebSearchGlobeToggle } from '../WebSearchGlobeToggle';
import { CrewSuggestionToggle } from '../CrewSuggestionToggle';
import { ChatToolbar } from './ChatToolbar';
import { PermissionBanner } from './PermissionBanner';
import { PendingTodosBanner, type TodoDisposition } from './PendingTodosBanner';
import type { ComposerFileHit, ComposerFolderHit } from '../ComposerMentionMenu';
import {
  useChatTurnControlContext,
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
  // Turn flags only — must NOT subscribe to messages (stream chunks caused typing lag).
  const { streaming, sessionRestoring } = useChatTurnControlContext();
  const { permissionPrompt, pendingPermissionCount } = useChatPromptsContext();
  const { coreSession } = useChatSessionIdentityContext();
  const { isCrewPrivateSession, crewPrivateHost } = useChatSessionPrivacyContext();
  const { crewList } = useChatCrewListContext();
  const { bypassPermissions } = useChatBypassPermissionsContext();
  const {
    currentModel, currentProvider, currentProviderId, providerList, modelList,
    loadingModels,
  } = useChatModelDataContext();
  const { providerMenuAnchor, modelMenuAnchor } = useChatModelMenuContext();
  const { questionnairePending, sendBlocked, sendBlockedReason } = useChatInputGateContext();
  const {
    attachments, inputClearSignal, webSearchAvailable,
    webSearchForce, crewSuggestionRequested, todoItems,
  } = useChatComposerContext();
  const {
    setPermissionPrompt, setPendingPermissionCount,
    setProviderMenuAnchor, setCurrentProvider, setCurrentModel,
    setModelList, setModelMenuAnchor, setTokenTotal, setTokenReserved,
    setAttachments, setTodoItems,
    fileInputRef, inputBarRef, tokenReservedRef,
    toggleBypassPermissions, revokeSessionPermissions,
  } = useChatSessionSettersContext();
  const {
    handleSend, handleCancel, handleStopAndSend, handleAddToQueue, handleSteer,
    handleFileSelect, handleRemoveAttachment,
    handlePermissionRespond, handlePermissionRespondBatch, handleSwitchToBypassMode,
    handleWebSearchToggle, handleCrewSuggestionToggle,
  } = useChatInputHandlersContext();

  const incompleteTodos = useMemo(
    () => todoItems.filter((t) => t.status === 'not-started' || t.status === 'in-progress'),
    [todoItems],
  );
  const [todoGateDraft, setTodoGateDraft] = useState<string | null>(null);

  const requestSend = useCallback((text: string) => {
    // Leftover TASKS → always confirm disposition before the turn starts.
    if (incompleteTodos.length > 0) {
      setTodoGateDraft(text);
      return;
    }
    void handleSend(text);
  }, [incompleteTodos.length, handleSend]);

  const resolveTodoGate = useCallback((disposition: TodoDisposition) => {
    const text = todoGateDraft ?? '';
    setTodoGateDraft(null);
    if (disposition === 'skip') {
      setTodoItems([]);
    }
    void handleSend(text, { todoDisposition: disposition });
  }, [todoGateDraft, setTodoItems, handleSend]);

  const handlePermissionDismiss = useCallback(() => {
    setPermissionPrompt(null);
    setPendingPermissionCount((prev) => Math.max(0, prev - 1));
  }, [setPermissionPrompt, setPendingPermissionCount]);
  const handlePermissionApproveAll = useCallback(() => {
    setPermissionPrompt(null);
    setPendingPermissionCount(0);
  }, [setPermissionPrompt, setPendingPermissionCount]);

  const handleAttachWorkspaceFile = useCallback((file: ComposerFileHit & { id: string }) => {
    const ext = file.name.includes('.') ? file.name.split('.').pop()!.toLowerCase() : '';
    const mimeMap: Record<string, string> = {
      png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
      pdf: 'application/pdf', txt: 'text/plain', md: 'text/markdown', json: 'application/json',
      ts: 'application/typescript', tsx: 'application/typescript', js: 'application/javascript',
      jsx: 'application/javascript', py: 'text/x-python', csv: 'text/csv',
    };
    setAttachments((prev) => {
      if (prev.some((a) => a.id === file.id || a.originalPath === file.path)) return prev;
      return [...prev, {
        id: file.id,
        name: file.name,
        mimeType: mimeMap[ext] ?? 'application/octet-stream',
        originalPath: file.path,
        uploaded: true,
        placement: 'inline',
        kind: 'file' as const,
      }];
    });
  }, [setAttachments]);

  const handleAttachWorkspaceFolder = useCallback((folder: ComposerFolderHit & { id: string }) => {
    setAttachments((prev) => {
      if (prev.some((a) => a.id === folder.id || a.originalPath === folder.path)) return prev;
      return [...prev, {
        id: folder.id,
        name: folder.name,
        mimeType: 'inode/directory',
        originalPath: folder.path,
        uploaded: true,
        placement: 'inline',
        kind: 'folder' as const,
      }];
    });
  }, [setAttachments]);

  const handleRemoveAttachmentById = useCallback((id: string) => {
    handleRemoveAttachment(id);
  }, [handleRemoveAttachment]);

  // + / drag-drop attachments only — @ mentions stay as inline text chips.
  const chipAttachments = useMemo(
    () => attachments.filter((a) => (a.placement ?? 'chip') === 'chip'),
    [attachments],
  );

  const [isDragging, setIsDragging] = useState(false);
  const [filePickerBusy, setFilePickerBusy] = useState(false);
  const filePickerClearTimerRef = useRef<number | null>(null);

  const clearFilePickerBusy = useCallback(() => {
    if (filePickerClearTimerRef.current != null) {
      window.clearTimeout(filePickerClearTimerRef.current);
      filePickerClearTimerRef.current = null;
    }
    setFilePickerBusy(false);
  }, []);

  const openFilePicker = useCallback(() => {
    if (filePickerBusy) return;
    setFilePickerBusy(true);

    // Native dialogs block the main thread after click — paint the spinner first.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        fileInputRef.current?.click();
      });
    });

    // Cancel / close: window regains focus when the OS dialog dismisses.
    const onWindowFocus = () => {
      window.setTimeout(() => clearFilePickerBusy(), 120);
    };
    window.addEventListener('focus', onWindowFocus, { once: true });

    // Safety net if focus never fires (some embedded webviews).
    filePickerClearTimerRef.current = window.setTimeout(() => {
      clearFilePickerBusy();
    }, 30_000);
  }, [filePickerBusy, fileInputRef, clearFilePickerBusy]);

  useEffect(() => () => {
    if (filePickerClearTimerRef.current != null) {
      window.clearTimeout(filePickerClearTimerRef.current);
    }
  }, []);

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
      {chipAttachments.length > 0 && (
        <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mb: 0.75 }}>
          {chipAttachments.map((a) => (
            <Chip
              key={a.id}
              size="small"
              icon={<InsertDriveFileIcon sx={{ fontSize: '13px !important' }} />}
              label={a.name}
              onDelete={() => handleRemoveAttachment(a.id)}
              deleteIcon={<CloseIcon sx={{ fontSize: '13px !important' }} />}
              sx={{ fontSize: '0.6rem', height: 22, bgcolor: colors.bg.tertiary, border: `1px solid ${colors.border.default}` }}
            />
          ))}
        </Box>
      )}

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
        {(permissionPrompt || todoGateDraft !== null) && (
          <Box sx={{ px: 1.25, pt: 1.25, pb: 0.5, display: 'flex', flexDirection: 'column', gap: 0.75 }}>
            {todoGateDraft !== null && (
              <PendingTodosBanner
                todos={incompleteTodos}
                onChoose={resolveTodoGate}
                onCancel={() => setTodoGateDraft(null)}
              />
            )}
            {permissionPrompt?.integrationPreview ? (
              <ActionPreviewCard
                preview={permissionPrompt.integrationPreview}
                pendingCount={pendingPermissionCount}
                onAllowOnce={() => { void handlePermissionRespond('allow_once'); }}
                onAllowAlways={() => { void handlePermissionRespond('allow_always'); }}
                onDeny={() => { void handlePermissionRespond('deny'); }}
                onApproveAll={() => { void handlePermissionRespondBatch('allow_once'); }}
                onSwitchToBypass={() => { void handleSwitchToBypassMode(); }}
              />
            ) : permissionPrompt ? (
              <PermissionBanner
                prompt={permissionPrompt}
                pendingCount={pendingPermissionCount}
                onRespond={handlePermissionDismiss}
                onApproveAll={handlePermissionApproveAll}
                onSwitchToBypass={() => { void handleSwitchToBypassMode(); }}
              />
            ) : null}
          </Box>
        )}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            clearFilePickerBusy();
            handleFileSelect(e.target.files);
            e.currentTarget.value = '';
          }}
          accept="image/*,.pdf,.txt,.md,.json,.ts,.tsx,.js,.jsx,.py,.yaml,.yml,.toml,.csv,.xml,.html,.css,.sh,.sql,.log,.env,.cfg,.ini,.rs,.go,.java,.c,.cpp,.h,.rb,.php,.swift,.kt,.docx,.xlsx,.pptx"
        />
        <ChatInputBar
          ref={inputBarRef}
          streaming={streaming}
          inputDisabled={questionnairePending}
          sendBlocked={sendBlocked || questionnairePending}
          sendBlockedReason={sendBlockedReason}
          hasAttachments={attachments.length > 0}
          crewList={crewList}
          // @mention (Directory / files / folders) in every session type.
          // Crew category is group-session only.
          disableCrew={isCrewPrivateSession || coreSession}
          placeholder={
            coreSession
              ? '@ to attach files — talk to Agent-X…'
              : isCrewPrivateSession && crewPrivateHost
                ? `@ to attach files — message ${crewPrivateHost.name}…`
                : '@ for crew or files — message your AI wingman…'
          }
          onSend={requestSend}
          onCancel={handleCancel}
          onStopAndSend={handleStopAndSend}
          onAddToQueue={handleAddToQueue}
          onSteer={handleSteer}
          onAttachWorkspaceFile={handleAttachWorkspaceFile}
          onAttachWorkspaceFolder={handleAttachWorkspaceFolder}
          onRemoveAttachmentById={handleRemoveAttachmentById}
          clearSignal={inputClearSignal}
        />

        <Box sx={{
          display: 'flex', alignItems: 'center', gap: 0.5, px: 1.25, py: 0.5,
          borderTop: `1px solid ${alphaColor(colors.border.default, '20')}`,
        }}>
          <Tooltip title={filePickerBusy ? 'Opening file picker…' : 'Attach files'} arrow>
            <span>
              <IconButton
                size="small"
                onClick={openFilePicker}
                disabled={filePickerBusy}
                aria-label={filePickerBusy ? 'Opening file picker' : 'Attach files'}
                sx={{
                  color: colors.text.dim,
                  p: 0.25,
                  '&:hover': { color: colors.text.secondary },
                  '&.Mui-disabled': { color: colors.text.dim, opacity: 0.85 },
                }}
              >
                {filePickerBusy
                  ? <CircularProgress size={14} thickness={5} sx={{ color: colors.accent.cyan }} />
                  : <AddIcon sx={{ fontSize: 16 }} />}
              </IconButton>
            </span>
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
          />
        </Box>
      </Box>
    </Box>
  );
});
