import { type FC, useState, useCallback } from 'react';
import { Box } from 'ink';
import { SetupWizard } from './screens/SetupWizard.js';
import { WelcomeScreen } from './screens/WelcomeScreen.js';
import { ConfigManager } from '@agentx/engine';
import type { AgentXConfig } from '@agentx/shared';

type AppState = 'loading' | 'setup' | 'main';

interface AppProps {
  sessionId?: string;
}

export const App: FC<AppProps> = ({ sessionId: _sessionId }) => {
  const configManager = new ConfigManager();
  const isConfigured = configManager.isConfigured();

  const [state, setState] = useState<AppState>(isConfigured ? 'main' : 'setup');
  const [config, setConfig] = useState<AgentXConfig | null>(() => {
    if (isConfigured) {
      try {
        return configManager.load();
      } catch {
        return null;
      }
    }
    return null;
  });

  const handleSetupComplete = useCallback((newConfig: AgentXConfig) => {
    setConfig(newConfig);
    setState('main');
  }, []);

  const handleSetupCancel = useCallback(() => {
    process.exit(0);
  }, []);

  if (state === 'setup') {
    return <SetupWizard onComplete={handleSetupComplete} onCancel={handleSetupCancel} />;
  }

  if (state === 'main' && config) {
    return <WelcomeScreen config={config} />;
  }

  // Fallback — should not happen
  return (
    <Box>
      <SetupWizard onComplete={handleSetupComplete} onCancel={handleSetupCancel} />
    </Box>
  );
};
