import { ConfigManager, Agent, SessionManager, ProviderFactory, CrewManager, createDefaultToolkit } from '@agentx/engine';
import type { AgentXConfig, ProviderId } from '@agentx/shared';

export interface EngineState {
  configManager: ConfigManager;
  sessionManager: SessionManager;
  agent: Agent | null;
  crewManager: CrewManager;
  toolkit: ReturnType<typeof createDefaultToolkit>;
  configured: boolean;
}

let state: EngineState | null = null;

function safeLoadConfig(configManager: ConfigManager): void {
  try {
    configManager.load();
  } catch {
    // not configured yet — that's fine
  }
}

export function getEngine(): EngineState {
  if (state) return state;

  const configManager = new ConfigManager();
  const configured = configManager.isConfigured();
  if (configured) {
    safeLoadConfig(configManager);
  }

  const toolkit = createDefaultToolkit(process.cwd());
  const sessionManager = new SessionManager();
  const crewManager = new CrewManager();

  state = {
    configManager,
    sessionManager,
    agent: null,
    crewManager,
    toolkit,
    configured,
  };

  return state;
}

export function createAgent(config?: AgentXConfig): Agent {
  const eng = getEngine();
  let cfg: AgentXConfig;
  if (config) {
    cfg = config;
  } else {
    try {
      cfg = eng.configManager.load();
    } catch {
      cfg = getDefaultConfig();
    }
  }

  const activeProvider = cfg.provider.activeProvider as ProviderId;
  const providerCfg = cfg.provider.providers[activeProvider];
  const apiKey = providerCfg?.apiKey;

  if (providerCfg?.configured) {
    try {
      const prov = ProviderFactory.create(activeProvider, apiKey, providerCfg?.baseUrl);
      prov.validate().catch(() => {});
    } catch {
      // provider not available yet
    }
  }

  const activeCrew = eng.crewManager.getActive();

  const session = eng.sessionManager.createSession(
    activeProvider,
    cfg.provider.activeModel,
    activeCrew.id,
    process.cwd(),
  );

  const agent = new Agent({
    config: cfg,
    sessionId: session.id,
    systemPrompt: activeCrew.systemPrompt,
    toolExecutor: eng.toolkit.executor,
    toolRegistry: eng.toolkit.registry,
  });

  eng.agent = agent;
  return agent;
}

function getDefaultConfig(): AgentXConfig {
  return {
    provider: {
      activeProvider: 'openai',
      activeModel: 'gpt-4o-mini',
      providers: {},
    },
    ui: {
      theme: 'dark',
      showTokenBar: true,
      showTimers: true,
      animationSpeed: 'normal',
    },
    organization: null,
    telemetry: false,
  };
}

export function getOrCreateAgent(config?: AgentXConfig): Agent {
  const eng = getEngine();
  if (eng.agent && !config) return eng.agent;
  return createAgent(config);
}

export function destroyAgent(): void {
  const eng = getEngine();
  if (eng.agent) {
    eng.agent.endSession();
    eng.agent = null;
  }
}
