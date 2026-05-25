import { type FC, useState, useCallback } from 'react';
import { Box } from 'ink';
import { SetupWizard } from './screens/SetupWizard.js';
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
  const isConfigured = configManager.isConfigured();

  // If restoring a session, skip profile select (profile is in session metadata)
  const [state, setState] = useState<AppState>(() => {
    if (!isConfigured) return 'setup';
    if (restoreSessionId) return 'main'; // Skip profile select on restore
    return 'profile';
  });

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

  const handleSetupComplete = useCallback((newConfig: AgentXConfig) => {
    setConfig(newConfig);
    setState('profile');
  }, []);

  const handleSetupCancel = useCallback(() => {
    process.exit(0);
  }, []);

  const handleProfileSelect = useCallback((profile: Profile) => {
    setActiveProfile(profile);
    setState('main');
  }, []);

  if (state === 'setup') {
    return <SetupWizard onComplete={handleSetupComplete} onCancel={handleSetupCancel} />;
  }

  const handleProfileSwitch = useCallback(() => {
    setState('profile');
  }, []);

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
      <SetupWizard onComplete={handleSetupComplete} onCancel={handleSetupCancel} />
    </Box>
  );
};
