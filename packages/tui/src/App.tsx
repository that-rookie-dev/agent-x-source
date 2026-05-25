import { type FC, useState, useCallback } from 'react';
import { Box } from 'ink';
import { MissionControl } from './screens/MissionControl.js';
import { CrewSelect } from './screens/CrewSelect.js';
import { WelcomeScreen } from './screens/WelcomeScreen.js';
import { ConfigManager, SessionStore } from '@agentx/engine';
import { CrewManager } from '@agentx/engine';
import type { AgentXConfig,Crew } from '@agentx/shared';

type AppState = 'loading' | 'setup' | 'crew' | 'main';

interface AppProps {
  sessionId?: string;
  recovered?: boolean;
}

export const App: FC<AppProps> = ({ sessionId: restoreSessionId, recovered }) => {
  const configManager = new ConfigManager();
  const isSetupDone = configManager.isSetupComplete();

  // If restoring a session, skip crew select (crew is in session metadata)
  const [state, setState] = useState<AppState>(() => {
    if (!isSetupDone) return 'setup';
    if (restoreSessionId) return 'main'; // Skip crew select on restore
    return 'crew';
  });

  const [config, setConfig] = useState<AgentXConfig | null>(() => {
    if (isSetupDone) {
      try {
        return configManager.load();
      } catch {
        return null;
      }
    }
    return null;
  });

  const [activeCrew, setActiveCrew] = useState<Crew | null>(() => {
    if (restoreSessionId) {
      // On session restore, load crew from session metadata
      try {
        const store = new SessionStore();
        const session = store.getSession(restoreSessionId);
        if (session) {
          const pm = new CrewManager();
          const crewId = session['crew_id'] as string | null;
          if (crewId) {
            return pm.get(crewId) ?? pm.getActive();
          }
        }
      } catch { /* fallback */ }
      const pm = new CrewManager();
      return pm.getActive();
    }
    return null;
  });

  const handleMissionComplete = useCallback((newConfig: AgentXConfig, crew: Crew) => {
    // Clear terminal so wizard residue doesn't show behind chat
    process.stdout.write('\x1Bc');
    setConfig(newConfig);
    setActiveCrew(crew);
    setState('main');
  }, []);

  const handleSetupCancel = useCallback(() => {
    process.exit(0);
  }, []);

  const handleCrewSelect = useCallback((crew: Crew) => {
    setActiveCrew(crew);
    setState('main');
  }, []);

  const handleCrewSwitch = useCallback(() => {
    setState('crew');
  }, []);

  if (state === 'setup') {
    return <MissionControl onComplete={handleMissionComplete} onCancel={handleSetupCancel} />;
  }

  if (state === 'crew' && config) {
    return (
      <CrewSelect
        onSelect={handleCrewSelect}
        currentProvider={config.provider.activeProvider}
        currentModel={config.provider.activeModel}
      />
    );
  }

  if (state === 'main' && config && activeCrew) {
    return <WelcomeScreen config={config} crew={activeCrew} restoreSessionId={restoreSessionId} recovered={recovered} onCrewSwitch={handleCrewSwitch} />;
  }

  // Fallback — should not happen
  return (
    <Box>
      <MissionControl onComplete={handleMissionComplete} onCancel={handleSetupCancel} />
    </Box>
  );
};
