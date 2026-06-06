import { type FC, useState, useCallback, useEffect } from 'react';
import { Box, Text } from 'ink';
import { MissionControl } from './screens/MissionControl.js';
import { WelcomeScreen } from './screens/WelcomeScreen.js';
import { SetupAuth } from './screens/SetupAuth.js';
import { Login } from './screens/Login.js';
import {
  ConfigManager,
  SessionStore,
  PluginRegistry,
  MCPBridge,
  ACPBridge,
  PostgresStorageAdapter,
  TelegramBridge,
  CrewManager,
} from '@agentx/engine';
import type { AgentXConfig, Crew } from '@agentx/shared';
import { authManager, getLogger } from '@agentx/shared';
import { COLORS } from './theme/colors.js';

type AppState = 'checking' | 'setup-auth' | 'login' | 'setup' | 'main';

interface AppProps {
  sessionId?: string;
  recovered?: boolean;
  planMode?: boolean;
  fallbackModel?: string;
  maxBudget?: number;
  gitAutoCommit?: boolean;
  gitAware?: boolean;
  daemonMode?: boolean;
}

export const App: FC<AppProps> = ({
  sessionId: restoreSessionId,
  recovered,
  planMode: initialPlanMode,
  fallbackModel,
  maxBudget,
  gitAutoCommit,
  gitAware,
  daemonMode: externalDaemonMode,
}) => {
  const [state, setState] = useState<AppState>('checking');
  const [config, setConfig] = useState<AgentXConfig | null>(null);
  const [crewList, setCrewList] = useState<Crew[]>([]);
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);

  // Shared plugin registry
  const [pluginRegistry] = useState(() => new PluginRegistry());

  // Plugin lifecycle state
  const [pgAdapter, setPgAdapter] = useState<PostgresStorageAdapter | null>(null);
  const [telegramBridge, setTelegramBridge] = useState<TelegramBridge | null>(null);
  const [lifecycleVersion, setLifecycleVersion] = useState(0);

  // Auto-start MCP servers
  const [mcpBridge] = useState(() => new MCPBridge());
  useEffect(() => {
    const logger = getLogger();
    let disposed = false;
    const startedServers: string[] = [];
    
    void (async () => {
      try {
        const manifests = await mcpBridge.discover();
        if (disposed) return;
        
        let loaded = 0;
        for (const m of manifests) {
          if (disposed) break;
          try {
            await mcpBridge.start(m);
            if (!disposed) {
              startedServers.push(m.name);
              loaded++;
            }
          } catch (e) {
            logger.warn('MCP_START_FAILED', `Failed to start MCP ${m.name}: ${e}`);
          }
        }
        if (loaded > 0 && !disposed) logger.info('MCP_SERVERS_STARTED', `Auto-started ${loaded} MCP server(s)`);
      } catch (e) {
        logger.warn('MCP_DISCOVER', `MCP discovery failed: ${e}`);
      }
    })();
    
    return () => {
      disposed = true;
      // Dispose stops any already-started servers
      void mcpBridge.dispose();
    };
  }, []);

  // Auto-start ACP servers
  const [acpBridge] = useState(() => new ACPBridge(pluginRegistry));
  useEffect(() => {
    let disposed = false;
    
    void (async () => {
      if (disposed) return;
      await acpBridge.startAll();
    })();
    
    return () => {
      disposed = true;
      void acpBridge.dispose();
    };
  }, []);

  // Plugin lifecycle effect
  useEffect(() => {
    const logger = getLogger();

    // PostgreSQL
    const pgPlugin = pluginRegistry.getPlugin('postgresql');
    const pgConfig = pgPlugin?.config ?? {};
    if (pgPlugin?.enabled && pgConfig['connectionString']) {
      if (!pgAdapter) {
        const adapter = new PostgresStorageAdapter({
          connectionString: pgConfig['connectionString'] as string,
          max: (pgConfig['poolSize'] as number) ?? 5,
        });
        adapter.connect().then(() => {
          setPgAdapter(adapter);
          logger.info('PG_ADAPTER_STARTED', 'PostgreSQL storage adapter initialized');
        }).catch((e) => logger.error('PG_ADAPTER_FAILED', e));
      }
    } else if (pgAdapter) {
      pgAdapter.disconnect().catch(() => {});
      setPgAdapter(null);
      logger.info('PG_ADAPTER_STOPPED', 'PostgreSQL storage adapter stopped');
    }

    // Telegram
    const tgPlugin = pluginRegistry.getPlugin('telegram');
    const tgConfig = tgPlugin?.config ?? {};
    if (tgPlugin?.enabled && tgConfig['botToken']) {
      if (!telegramBridge) {
        const bridge = new TelegramBridge({ botToken: tgConfig['botToken'] as string });
        bridge.start().then(() => {
          setTelegramBridge(bridge);
          logger.info('TG_BRIDGE_STARTED', 'Telegram bridge started');
        }).catch((e) => logger.error('TG_BRIDGE_FAILED', e));
      }
    } else if (telegramBridge) {
      telegramBridge.stop();
      setTelegramBridge(null);
      logger.info('TG_BRIDGE_STOPPED', 'Telegram bridge stopped');
    }
  }, [lifecycleVersion, pluginRegistry]);

  // ─── Auth Gate ──────────────────────────────────────────────────────

  // On mount: check auth state
  useEffect(() => {
    const hasRoot = authManager.hasRootUser();
    if (!hasRoot) {
      setState('setup-auth');
    } else {
      setState('login');
    }
  }, []);

  const handleAuthSetupComplete = useCallback(() => {
    setState('login');
  }, []);

  const handleLogin = useCallback((token: string) => {
    setAuthToken(token);
    const session = authManager.validateSession(token);
    if (!session) {
      setAuthError('Session validation failed');
      setState('login');
      return;
    }

    // Set DEK on ConfigManager so encrypted config can be read
    const configManager = new ConfigManager();
    configManager.setDEK(session.dek);

    const isSetupDone = configManager.isSetupComplete();

    if (restoreSessionId) {
      try {
        const store = new SessionStore();
        const sess = store.getSession(restoreSessionId);
        if (sess) {
          const pm = new CrewManager();
          pm.setDEK(session.dek);
        }
      } catch { /* ignore */ }
    }

    if (!isSetupDone) {
      setState('setup');
    } else {
      try {
        const cfg = configManager.load();
        setConfig(cfg);
        const pm = new CrewManager();
        pm.setDEK(session.dek);
        setCrewList(pm.list());
        setState('main');
      } catch (e) {
        setAuthError(e instanceof Error ? e.message : 'Failed to load config');
        setState('setup');
      }
    }
  }, [restoreSessionId]);

  // ─── Setup / Main Flow ──────────────────────────────────────────────

  const handleMissionComplete = useCallback((newConfig: AgentXConfig) => {
    process.stdout.write('\x1Bc');
    setConfig(newConfig);
    setState('main');
  }, []);

  const handleSetupCancel = useCallback(() => {
    process.exit(0);
  }, []);



  const handlePluginChanged = useCallback(() => {
    setLifecycleVersion((v) => v + 1);
  }, []);

  // ─── Render ─────────────────────────────────────────────────────────

  if (state === 'checking') {
    return (
      <Box flexDirection="column" padding={2}>
        <Text color={COLORS.primary}>Initializing Agent-X...</Text>
      </Box>
    );
  }

  if (state === 'setup-auth') {
    return <SetupAuth onComplete={handleAuthSetupComplete} />;
  }

  if (state === 'login') {
    return (
      <Box flexDirection="column">
        {authError && (
          <Box padding={1}>
            <Text color={COLORS.error}>⚠ {authError}</Text>
          </Box>
        )}
        <Login onLogin={handleLogin} />
      </Box>
    );
  }

  if (state === 'setup') {
    const session = authToken ? authManager.validateSession(authToken) : null;
    return <MissionControl onComplete={handleMissionComplete} onCancel={handleSetupCancel} dek={session?.dek ?? null} />;
  }

  if (state === 'main' && config) {
    return (
      <WelcomeScreen
        config={config}
        crewList={crewList}
        restoreSessionId={restoreSessionId}
        recovered={recovered}
        pluginRegistry={pluginRegistry}
        onPluginChanged={handlePluginChanged}
        storageAdapter={pgAdapter}
        telegramBridge={telegramBridge}
        initialPlanMode={initialPlanMode}
        fallbackModel={fallbackModel}
        mcpBridge={mcpBridge}
        acpBridge={acpBridge}
        maxBudget={maxBudget}
        gitAutoCommit={gitAutoCommit}
        gitAware={gitAware}
        daemonMode={externalDaemonMode}
      />
    );
  }

  return (
    <Box>
      <MissionControl onComplete={handleMissionComplete} onCancel={handleSetupCancel} />
    </Box>
  );
};
