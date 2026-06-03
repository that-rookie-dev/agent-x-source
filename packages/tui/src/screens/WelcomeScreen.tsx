import { type FC, useState, useRef, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { COLORS } from '../theme/colors.js';
import { Banner } from '../components/Banner.js';
import { MessageArea } from '../components/MessageArea.js';
import { InputField } from '../components/InputField.js';
import { SessionPanel } from '../components/SessionPanel.js';
import { LoadingIndicator } from '../components/LoadingIndicator.js';
import { ScrollableList } from '../components/ScrollableList.js';
import { ErrorBanner } from '../components/ErrorBanner.js';
import { CommandSuggestions } from '../components/CommandSuggestions.js';
import { PluginHub } from './PluginHub.js';
import { useKeybindings } from '../hooks/useKeybindings.js';
import { ProviderPicker } from '../components/ProviderPicker.js';
import { PermissionPrompt } from '../components/PermissionPrompt.js';
import { ProcessTimer } from '../components/ProcessTimer.js';
import { GimmickDisplay } from '../components/GimmickDisplay.js';
import { TodoProgress } from '../components/TodoProgress.js';
import { AgentProgress } from '../components/AgentProgress.js';
import { ReasoningGlimpse } from '../components/ReasoningGlimpse.js';
import { PlanOverlay } from '../components/PlanOverlay.js';
import { useSession } from '../hooks/useSession.js';
import type { AgentXConfig, ModelInfo, Crew } from '@agentx/shared';
import type { PluginRegistry, PostgresStorageAdapter, TelegramBridge, MCPBridge, ACPBridge } from '@agentx/engine';

interface WelcomeScreenProps {
  config: AgentXConfig;
  crew: Crew;
  restoreSessionId?: string;
  recovered?: boolean;
  onCrewSwitch?: () => void;
  pluginRegistry: PluginRegistry;
  onPluginChanged: () => void;
  storageAdapter: PostgresStorageAdapter | null;
  telegramBridge: TelegramBridge | null;
  initialPlanMode?: boolean;
  fallbackModel?: string;
  mcpBridge?: MCPBridge;
  acpBridge?: ACPBridge;
  maxBudget?: number;
  gitAutoCommit?: boolean;
  gitAware?: boolean;
}

export const WelcomeScreen: FC<WelcomeScreenProps> = ({ config, crew, restoreSessionId, recovered, onCrewSwitch, pluginRegistry, onPluginChanged, storageAdapter, telegramBridge, initialPlanMode, fallbackModel, mcpBridge, acpBridge, maxBudget, gitAutoCommit, gitAware }) => {
  const [showPluginHub, setShowPluginHub] = useState(false);
  const [slashFilter, setSlashFilter] = useState<string | null>(null);

  // derive active profile label (if any) for banner display
  const activeProviderId = config.provider.activeProvider;
  const providerSettings = config.provider.providers?.[activeProviderId];
  let profileLabel: string | null = null;
  if (providerSettings) {
    const activeId = providerSettings.activeProfile;
    if (activeId && providerSettings.profiles && providerSettings.profiles[activeId]) {
      profileLabel = providerSettings.profiles[activeId].label;
    } else if (providerSettings.apiKey || providerSettings.baseUrl) {
      profileLabel = 'Default';
    }
  }

  const {
    messages,
    streamingContent,
    isLoading,
    tokensUsed,
    tokensTotal,
    error,
    errorActions,
    sendMessage,
    cancelProcessing,
    handleErrorAction,
    sessionId,
    modelPickerModels,
    currentModel,
    selectModel,
    dismissModelPicker,
    commandNames,
    commandList,
    showProviderPicker,
    selectProvider,
    dismissProviderPicker,
    permissionRequest,
    respondToPermission,
    todoItems,
    reasoningText,
    isReasoning,
    activeTools,
    subAgents,
    currentPlan,
    planMode,
    approvePlan,
    rejectPlan,
    togglePlanStep,
    cancelPlan,
    togglePlanMode: _togglePlanMode,
    toolCount,
    messageCount,
    sessionCreatedAt,
    totalCost,
    isIndexing,
    indexingProgress,
  } = useSession(config, crew, restoreSessionId, onCrewSwitch, storageAdapter, telegramBridge, initialPlanMode, fallbackModel, maxBudget, gitAutoCommit, gitAware);

  // Placeholders for planned features not yet in UseSessionReturn
  const watcherCount = 0;
  const schedulerCount = 0;
  const ragIndexStats: { indexedCount: number; indexedAt: number | null } | undefined = undefined;
  const currentTaskType: string | null = null;
  const pendingDiff: string | null = null;

  // Double-ESC to cancel processing
  const [escState, setEscState] = useState<'idle' | 'first_press'>('idle');
  const escTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useInput((_input, key) => {
    if (!key.escape || !isLoading) return;

    if (escState === 'idle') {
      setEscState('first_press');
      // Reset after 2 seconds if no second press
      escTimerRef.current = setTimeout(() => {
        setEscState('idle');
      }, 2000);
    } else if (escState === 'first_press') {
      // Second ESC — confirm cancel
      if (escTimerRef.current) clearTimeout(escTimerRef.current);
      setEscState('idle');
      cancelProcessing();
    }
  });

  // Plugin Hub keybinding
  useKeybindings({ onCtrlP: () => setShowPluginHub(true) });

  // Reset ESC state when processing ends
  useEffect(() => {
    if (!isLoading) {
      setEscState('idle');
      if (escTimerRef.current) {
        clearTimeout(escTimerRef.current);
        escTimerRef.current = null;
      }
    }
  }, [isLoading]);

  // Plugin Hub overlay (Ctrl+P)
  if (showPluginHub) {
    return (
      <PluginHub
        currentProvider={config.provider.activeProvider}
        currentModel={currentModel}
        onClose={() => setShowPluginHub(false)}
        registry={pluginRegistry}
        onPluginChanged={onPluginChanged}
        mcpBridge={mcpBridge}
        acpBridge={acpBridge}
      />
    );
  }

  // Model picker overlay
  if (modelPickerModels) {
    return (
      <Box flexDirection="column" padding={1}>
        <Banner
          provider={config.provider.activeProvider}
          model={currentModel}
          organization={config.organization}
          crewName={crew.name}
          profileLabel={profileLabel}
        />
        <Box marginTop={1}>
          <ScrollableList
            items={modelPickerModels}
            label={`Switch model (current: ${currentModel})`}
            onSelect={(model: ModelInfo) => selectModel(model)}
            onCancel={dismissModelPicker}
            renderItem={(model: ModelInfo, isSelected: boolean) => (
              <Box>
                <Text color={isSelected ? COLORS.text : COLORS.textDim}>
                  {model.name}
                </Text>
                {model.id === currentModel && (
                  <Text color={COLORS.primary}> ●</Text>
                )}
                <Text color={COLORS.textDim} dimColor>
                  {' '}({Math.round(model.contextWindow / 1000)}K ctx)
                </Text>
              </Box>
            )}
          />
        </Box>
      </Box>
    );
  }

  // Provider picker overlay
  if (showProviderPicker) {
    return (
      <Box flexDirection="column" padding={1}>
        <Banner
          provider={config.provider.activeProvider}
          model={currentModel}
          organization={config.organization}
          crewName={crew.name}
        />
        <Box marginTop={1}>
          <ProviderPicker
            currentProvider={config.provider.activeProvider}
            onComplete={selectProvider}
            onDismiss={dismissProviderPicker}
          />
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" flexGrow={1}>
      {/* Main content area */}
      <Box flexDirection="column" flexGrow={1}>
        {/* Banner at top */}
        <Banner
          provider={config.provider.activeProvider}
          model={currentModel}
          organization={config.organization}
          crewName={crew.name}
          scopePath={process.cwd()}
          sessionName={sessionId ? sessionId.slice(0, 8) : crew.name}
          toolCount={toolCount}
          planMode={planMode}
          totalCost={totalCost}
          maxBudget={maxBudget ?? undefined}
          ragIndexStats={ragIndexStats}
          isIndexing={isIndexing}
          indexingProgress={indexingProgress}
          currentTaskType={currentTaskType}
        />

        <MessageArea messages={messages} streamingContent={streamingContent} pendingDiff={pendingDiff ?? undefined} />

          {isLoading && !streamingContent && (
            <Box paddingX={2}>
              <LoadingIndicator label="Thinking..." type="dots" />
              <GimmickDisplay isVisible={true} />
            </Box>
          )}

          {/* Cancel hint during processing */}
          {isLoading && escState === 'idle' && (
            <Box paddingX={2}>
              <Text color={COLORS.textDim} dimColor>Press Esc to cancel</Text>
            </Box>
          )}
          {escState === 'first_press' && (
            <Box paddingX={2}>
              <Text color={COLORS.warning}>Press Esc again to confirm cancel</Text>
            </Box>
          )}

          {/* Reasoning glimpse */}
          {isReasoning && (
            <ReasoningGlimpse content={reasoningText} isActive={isReasoning} />
          )}

          {/* Active tool executions */}
          {activeTools.length > 0 && (
            <Box flexDirection="column" paddingX={2}>
              {activeTools.map((t) => (
                <ProcessTimer key={t.id} label={t.description || t.tool} active={true} startTime={t.startTime} />
              ))}
            </Box>
          )}

          {/* Sub-agent progress */}
          {subAgents.map((a) => (
            <AgentProgress
              key={a.agentId}
              agentId={a.agentId}
              agentName={a.name}
              status={a.status as 'running' | 'complete' | 'failed' | 'cancelled'}
              startedAt={a.startTime}
              summary={a.summary}
              endTime={a.endTime}
            />
          ))}

          {/* Todo progress */}
          {todoItems.length > 0 && <TodoProgress items={todoItems} />}

          {/* Crash recovery notice */}
          {recovered && messages.length === 0 && (
            <Box paddingX={2} marginBottom={1}>
              <Text color={COLORS.warning}>🔄 Emergency Reboot — Recovered from unexpected shutdown. Settings restored.</Text>
            </Box>
          )}

          {error && errorActions.length > 0 && (
            <ErrorBanner
              message={error}
              actions={errorActions}
              onAction={handleErrorAction}
              isActive={!isLoading}
            />
          )}

          {error && errorActions.length === 0 && (
            <Box paddingX={2}>
              <Text color={COLORS.warning}>⚠ {error}</Text>
            </Box>
          )}

          {/* Permission prompt overlay */}
          {permissionRequest && (
            <PermissionPrompt
              toolName={permissionRequest.tool}
              targetPath={permissionRequest.path ?? ''}
              riskLevel={permissionRequest.riskLevel as 'low' | 'medium' | 'high' | 'critical'}
              onDecision={respondToPermission}
            />
          )}

          {/* Plan overlay */}
          {currentPlan && (
            <PlanOverlay
              plan={currentPlan}
              onApproveAll={approvePlan}
              onRejectAll={rejectPlan}
              onToggleStep={togglePlanStep}
              onCancel={cancelPlan}
            />
          )}

          {/* Input at bottom */}
          <Box marginTop={1} paddingX={1}>
            <InputField
              onSubmit={(v) => { setSlashFilter(null); sendMessage(v); }}
              disabled={isLoading || (!!error && errorActions.length > 0)}
              placeholder="Type a message... (/ for commands)"
              completions={commandNames}
              onSlashDetected={(v) => setSlashFilter(v)}
              onSlashCleared={() => setSlashFilter(null)}
            />
          </Box>

          {/* Command suggestions — below input */}
          {slashFilter !== null && (
            <CommandSuggestions commands={commandList} filter={slashFilter} />
          )}
        </Box>

        {/* Session panel at bottom */}
        <SessionPanel
          sessionId={sessionId}
          provider={config.provider.activeProvider}
          model={currentModel}
          crewName={crew.name}
          scopePath={process.cwd()}
          tokensUsed={tokensUsed}
          tokensTotal={tokensTotal}
          isProcessing={isLoading}
          messageCount={messageCount}
          sessionCreatedAt={sessionCreatedAt}
          totalCost={totalCost}
          watcherCount={watcherCount}
          schedulerCount={schedulerCount}
        />
    </Box>
  );
};
