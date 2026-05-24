import { type FC, useState } from 'react';
import { Box, Text } from 'ink';
import { COLORS } from '../theme/colors.js';
import { Banner } from '../components/Banner.js';
import { MessageArea } from '../components/MessageArea.js';
import { InputField } from '../components/InputField.js';
import { SessionPanel } from '../components/SessionPanel.js';
import { LoadingIndicator } from '../components/LoadingIndicator.js';
import { ScrollableList } from '../components/ScrollableList.js';
import { ErrorBanner } from '../components/ErrorBanner.js';
import { CommandSuggestions } from '../components/CommandSuggestions.js';
import { ProviderPicker } from '../components/ProviderPicker.js';
import { PermissionPrompt } from '../components/PermissionPrompt.js';
import { GimmickDisplay } from '../components/GimmickDisplay.js';
import { TodoProgress } from '../components/TodoProgress.js';
import { AgentProgress } from '../components/AgentProgress.js';
import { ReasoningGlimpse } from '../components/ReasoningGlimpse.js';
import { useSession } from '../hooks/useSession.js';
import type { AgentXConfig, ModelInfo, Profile } from '@agentx/shared';

interface WelcomeScreenProps {
  config: AgentXConfig;
  profile: Profile;
  restoreSessionId?: string;
  recovered?: boolean;
}

export const WelcomeScreen: FC<WelcomeScreenProps> = ({ config, profile, restoreSessionId, recovered }) => {
  const [slashFilter, setSlashFilter] = useState<string | null>(null);

  const {
    messages,
    streamingContent,
    isLoading,
    tokensUsed,
    tokensTotal,
    elapsed,
    error,
    errorActions,
    sendMessage,
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
  } = useSession(config, profile, restoreSessionId);

  // Model picker overlay
  if (modelPickerModels) {
    return (
      <Box flexDirection="column" padding={1}>
        <Banner
          provider={config.provider.activeProvider}
          model={currentModel}
          organization={config.organization}
          profileName={profile.name}
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
          profileName={profile.name}
        />
        <Box marginTop={1}>
          <ProviderPicker
            currentProvider={config.provider.activeProvider}
            onSelect={selectProvider}
            onDismiss={dismissProviderPicker}
          />
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box flexGrow={1}>
        {/* Main content area */}
        <Box flexDirection="column" flexGrow={1}>
          {/* Banner at top */}
          <Banner
            provider={config.provider.activeProvider}
            model={currentModel}
            organization={config.organization}
            profileName={profile.name}
            showReady={messages.length === 0 && !isLoading && !error}
          />

          <MessageArea messages={messages} streamingContent={streamingContent} />

          {isLoading && !streamingContent && (
            <Box paddingX={2}>
              <LoadingIndicator label="Thinking..." type="dots" />
              <GimmickDisplay isVisible={true} />
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
                <Box key={t.tool}>
                  <Text color={COLORS.primary}>⚡ </Text>
                  <Text color={COLORS.textDim}>{t.description || t.tool}</Text>
                </Box>
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

          {/* Command suggestions */}
          {slashFilter !== null && (
            <CommandSuggestions commands={commandList} filter={slashFilter} />
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
        </Box>

        {/* Side panel */}
        <SessionPanel
          sessionId={sessionId}
          provider={config.provider.activeProvider}
          model={currentModel}
          profileName={profile.name}
          tokensUsed={tokensUsed}
          tokensTotal={tokensTotal}
          elapsed={elapsed}
          isProcessing={isLoading}
        />
      </Box>
    </Box>
  );
};
