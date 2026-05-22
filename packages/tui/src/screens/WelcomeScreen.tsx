import { type FC } from 'react';
import { Box, Text } from 'ink';
import { COLORS } from '../theme/colors.js';
import { Banner } from '../components/Banner.js';
import { MessageArea } from '../components/MessageArea.js';
import { InputField } from '../components/InputField.js';
import { SessionPanel } from '../components/SessionPanel.js';
import { LoadingIndicator } from '../components/LoadingIndicator.js';
import { ScrollableList } from '../components/ScrollableList.js';
import { useSession } from '../hooks/useSession.js';
import type { AgentXConfig, ModelInfo } from '@agentx/shared';

interface WelcomeScreenProps {
  config: AgentXConfig;
}

export const WelcomeScreen: FC<WelcomeScreenProps> = ({ config }) => {
  const {
    messages,
    streamingContent,
    isLoading,
    tokensUsed,
    tokensTotal,
    elapsed,
    error,
    sendMessage,
    sessionId,
    modelPickerModels,
    currentModel,
    selectModel,
    dismissModelPicker,
  } = useSession(config);

  // Model picker overlay
  if (modelPickerModels) {
    return (
      <Box flexDirection="column" padding={1}>
        <Banner
          provider={config.provider.activeProvider}
          model={currentModel}
          organization={config.organization}
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

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Banner
        provider={config.provider.activeProvider}
        model={currentModel}
        organization={config.organization}
      />

      <Box flexGrow={1} marginTop={1}>
        {/* Main content area */}
        <Box flexDirection="column" flexGrow={1}>
          {messages.length === 0 && !isLoading && (
            <Box paddingX={2} paddingY={1}>
              <Text color={COLORS.textDim}>
                Ready. Type a message or use / for commands.
              </Text>
            </Box>
          )}

          <MessageArea messages={messages} streamingContent={streamingContent} />

          {isLoading && !streamingContent && (
            <Box paddingX={2}>
              <LoadingIndicator label="Thinking..." type="dots" />
            </Box>
          )}

          {error && (
            <Box paddingX={2}>
              <Text color={COLORS.error}>⚠ {error}</Text>
            </Box>
          )}

          {/* Input */}
          <Box marginTop={1} paddingX={1}>
            <InputField
              onSubmit={sendMessage}
              disabled={isLoading}
              placeholder="Type a message... (/ for commands)"
            />
          </Box>
        </Box>

        {/* Side panel */}
        <SessionPanel
          sessionId={sessionId}
          provider={config.provider.activeProvider}
          model={currentModel}
          tokensUsed={tokensUsed}
          tokensTotal={tokensTotal}
          elapsed={elapsed}
        />
      </Box>
    </Box>
  );
};
