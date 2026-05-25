import { type FC, useState, useCallback } from 'react';
import { Box } from 'ink';
import { MissionControl } from './screens/MissionControl.js';
import { ProfileSelect } from './screens/ProfileSelect.js';
import { WelcomeScreen } from './screens/WelcomeScreen.js';
import { ConfigManager, SessionStore } from '@agentx/engine';
import { ProfileManager } from '@agentx/engine';
import type { AgentXConfig, Profile } from '@agentx/shared';

type AppState = 'loading' | 'setup' | 'profile' | 'main';

interface AppProps {
  sessionId?: string;
  recovered?: boolean;
}

export const App: FC<AppProps> = ({ sessionId: restoreSessionId, recovered }) => {
  const configManager = new ConfigManager();
  const isSetupDone = configManager.isSetupComplete();

  // If restoring a session, skip profile select (profile is in session metadata)
  const [state, setState] = useState<AppState>(() => {
    if (!isSetupDone) return 'setup';
    if (restoreSessionId) return 'main'; // Skip profile select on restore
    return 'profile';
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

  const [activeProfile, setActiveProfile] = useState<Profile | null>(() => {
    if (restoreSessionId) {
      // On session restore, load profile from session metadata
      try {
        const store = new SessionStore();
        const session = store.getSession(restoreSessionId);
        if (session) {
          const pm = new ProfileManager();
          const profileId = session['profile_id'] as string | null;
          if (profileId) {
            return pm.get(profileId) ?? pm.getActive();
          }
        }
      } catch { /* fallback */ }
      const pm = new ProfileManager();
      return pm.getActive();
    }
    return null;
  });

  const handleMissionComplete = useCallback((newConfig: AgentXConfig, profile: Profile) => {
    setConfig(newConfig);
    setActiveProfile(profile);
    setState('main'); // Skip profile select — wizard already created one
  }, []);

  const handleSetupCancel = useCallback(() => {
    process.exit(0);
  }, []);

  const handleProfileSelect = useCallback((profile: Profile) => {
    setActiveProfile(profile);
    setState('main');
  }, []);

  const handleProfileSwitch = useCallback(() => {
    setState('profile');
  }, []);

  if (state === 'setup') {
    return <MissionControl onComplete={handleMissionComplete} onCancel={handleSetupCancel} />;
  }

  if (state === 'profile' && config) {
    return (
      <ProfileSelect
        onSelect={handleProfileSelect}
        currentProvider={config.provider.activeProvider}
        currentModel={config.provider.activeModel}
      />
    );
  }

  if (state === 'main' && config && activeProfile) {
    return <WelcomeScreen config={config} profile={activeProfile} restoreSessionId={restoreSessionId} recovered={recovered} onProfileSwitch={handleProfileSwitch} />;
  }

  // Fallback — should not happen
  return (
    <Box>
      <MissionControl onComplete={handleMissionComplete} onCancel={handleSetupCancel} />
    </Box>
  );
};
