import { useEffect, useState, useMemo } from 'react';
import { apiGet } from '../api';

interface HealthData {
  status: string;
  pid: number;
  node: string;
  platform: string;
  uptime: number;
  memory?: { heapUsed: number; heapTotal: number; rss: number };
}

interface Props {
  onRetry: () => void;
}

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function fmtBytes(bytes: number): string {
  if (bytes > 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes > 1e6) return `${(bytes / 1e6).toFixed(1)} MB`;
  if (bytes > 1e3) return `${(bytes / 1e3).toFixed(1)} KB`;
  return `${bytes} B`;
}

const codeRainLines = [
  '> system.boot(sequence=0xA4F2)  [OK]',
  '> kernel.init(mode="secure")    [OK]',
  '> runtime.allocate(memory=4096) [OK]',
  '> network.handshake(wss://)     [OK]',
  '> session.establish(id=0x7E3A)  [OK]',
  '> tool.register("web_search")   [OK]',
  '> tool.register("file_ops")     [OK]',
  '> tool.register("shell_exec")  [OK]',
  '> tool.register("code_gen")    [OK]',
  '> provider.connect("openai")   [OK]',
  '> agent.deploy("explorer")     [OK]',
  '> crew.init("research-team")   [OK]',
  '> memory.sync()                [OK]',
  '> permission.load(rules=42)    [OK]',
  '> session.open(chat=0x1A2B)    [OK]',
  '> runtime.health_check()       [OK]',
  '> agent.status() = "active"    [OK]',
  '> pipeline.build(sequence=12)  [OK]',
  '> tool.execute("scrape_url")   [OK]',
  '> data.index(collection=mem)   [OK]',
];

const terminalScript: { text: string; type: string }[] = [
  { text: '', type: 'empty' },
  { text: 'agentx start --profile default', type: 'cmd' },
  { text: '> Initializing agent runtime...', type: 'info' },
  { text: '> Loading tool registry... 42 tools registered', type: 'info' },
  { text: '> Connecting to provider (openai)... connected', type: 'success' },
  { text: '> Agent-X v1.0.0 ready — all systems nominal', type: 'success' },
  { text: '', type: 'empty' },
  { text: '> Deploying autonomous agent...', type: 'info' },
  { text: '> Agent "explorer" created — ID: 0x7E3A', type: 'info' },
  { text: '> Task: Research latest AI breakthroughs', type: 'cmd' },
  { text: '> Planning phase — 3 steps identified', type: 'info' },
  { text: '', type: 'empty' },
  { text: '  ── Step 1: Web reconnaissance ──', type: 'info' },
  { text: '  web_search query="AI breakthroughs 2026"', type: 'tool' },
  { text: '  → 47 results found. Analyzing top 10...', type: 'output' },
  { text: '', type: 'empty' },
  { text: '  ── Step 2: Deep analysis ──', type: 'info' },
  { text: '  scrape_url https://arxiv.org/abs/2403.12345', type: 'tool' },
  { text: '  → Extracting methodology, results, limitations', type: 'output' },
  { text: '  → Paper: "Multi-Agent Collaboration Framework"', type: 'output' },
  { text: '', type: 'empty' },
  { text: '  ── Step 3: Synthesis ──', type: 'info' },
  { text: '  Generating comprehensive summary report...', type: 'output' },
  { text: '  → Task completed in 8.4 seconds', type: 'success' },
  { text: '', type: 'empty' },
  { text: '> Agent ready for next mission. Awaiting input...', type: 'info' },
  { text: '', type: 'empty' },
];

const systems = [
  {
    title: 'AUTONOMOUS AGENTS',
    desc: 'Deploy goal-driven AI agents that plan, execute, and adapt to complex tasks in real time.',
    icon: (
      <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round">
        <polygon points="24,4 42,24 24,44 6,24" opacity="0.2" />
        <polygon points="24,12 32,24 24,36 16,24" />
        <circle cx="24" cy="24" r="2" fill="currentColor" stroke="none" />
      </svg>
    ),
  },
  {
    title: 'MULTI-PROVIDER',
    desc: 'Seamlessly switch across LLM providers — Google, OpenAI, Anthropic, and more.',
    icon: (
      <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round">
        <circle cx="18" cy="24" r="10" opacity="0.35" />
        <circle cx="30" cy="24" r="10" opacity="0.35" />
        <circle cx="24" cy="24" r="3" fill="currentColor" stroke="none" />
        <path d="M8 24h6" strokeWidth="1" opacity="0.2" />
        <path d="M34 24h6" strokeWidth="1" opacity="0.2" />
      </svg>
    ),
  },
  {
    title: 'CREW COLLABORATION',
    desc: 'Orchestrate multiple agents with specialized roles to solve problems together.',
    icon: (
      <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round">
        <line x1="24" y1="8" x2="9" y2="36" strokeWidth="1" opacity="0.2" />
        <line x1="24" y1="8" x2="39" y2="36" strokeWidth="1" opacity="0.2" />
        <line x1="9" y1="36" x2="39" y2="36" strokeWidth="1" opacity="0.2" />
        <circle cx="24" cy="8" r="5" />
        <circle cx="9" cy="36" r="5" />
        <circle cx="39" cy="36" r="5" />
        <circle cx="24" cy="8" r="2" fill="currentColor" stroke="none" />
        <circle cx="9" cy="36" r="2" fill="currentColor" stroke="none" />
        <circle cx="39" cy="36" r="2" fill="currentColor" stroke="none" />
      </svg>
    ),
  },
  {
    title: 'TOOL EXECUTION',
    desc: 'Agents interact with your system — file ops, shell commands, web search, and custom tools.',
    icon: (
      <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round">
        <circle cx="24" cy="24" r="9" />
        <circle cx="24" cy="24" r="2.5" fill="currentColor" stroke="none" />
        <line x1="24" y1="5" x2="24" y2="11" opacity="0.3" />
        <line x1="24" y1="37" x2="24" y2="43" opacity="0.3" />
        <line x1="5" y1="24" x2="11" y2="24" opacity="0.3" />
        <line x1="37" y1="24" x2="43" y2="24" opacity="0.3" />
      </svg>
    ),
  },
  {
    title: 'SESSION PERSISTENCE',
    desc: 'Every conversation is saved. Resume any session across devices and time.',
    icon: (
      <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round">
        <rect x="10" y="12" width="28" height="7" rx="2" opacity="0.25" />
        <rect x="10" y="22" width="28" height="7" rx="2" opacity="0.45" />
        <rect x="10" y="32" width="28" height="7" rx="2" />
        <circle cx="34" cy="35.5" r="2" fill="currentColor" stroke="none" />
      </svg>
    ),
  },
  {
    title: 'PERMISSION CONTROL',
    desc: 'Granular allow/deny rules for tool access. Keep your system secure.',
    icon: (
      <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round">
        <path d="M24 4l18 9v14c0 11.2-18 22-18 22S6 38.2 6 27V13z" />
        <path d="M18 24l4 4 8-8" strokeWidth="2" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    title: 'WEB & CODE',
    desc: 'Generate code, browse the web, fetch APIs, and process data autonomously.',
    icon: (
      <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M16 14l-8 10 8 10" />
        <path d="M32 14l8 10-8 10" />
      </svg>
    ),
  },
  {
    title: 'ALWAYS LEARNING',
    desc: 'Memory-augmented agents that recall past context and improve over time.',
    icon: (
      <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
        <path d="M14 30c0-9 20-9 20 0" opacity="0.25" />
        <path d="M9 34c0-15 30-15 30 0" opacity="0.5" />
        <path d="M5 38c0-20 38-20 38 0" />
        <circle cx="24" cy="38" r="2" fill="currentColor" stroke="none" />
      </svg>
    ),
  },
];

export default function HealthCheck({ onRetry }: Props) {
  const [health, setHealth] = useState<HealthData | null>(null);
  const [termLines, setTermLines] = useState<{ text: string; type: string }[]>([]);
  const [termDone, setTermDone] = useState(false);

  useEffect(() => {
    checkHealth();
  }, []);

  useEffect(() => {
    if (!health || health.status !== 'ok') {
      setTermLines([]);
      setTermDone(false);
      return;
    }
    let i = 0;
    setTermLines([]);
    setTermDone(false);
    const interval = setInterval(() => {
      if (i < terminalScript.length) {
        const item = terminalScript[i];
        if (item) {
          setTermLines((prev) => [...prev, item]);
        }
        i++;
      } else {
        setTermDone(true);
        clearInterval(interval);
      }
    }, 180);
    return () => clearInterval(interval);
  }, [health?.status]);

  async function checkHealth() {
    try {
      const h = await apiGet<HealthData>('/api/health');
      setHealth(h);
    } catch {
      setHealth(null);
    }
  }

  const isOnline = health?.status === 'ok';

  const codeContent = useMemo(() => {
    const repeated: string[] = [];
    for (let i = 0; i < 10; i++) {
      for (const line of codeRainLines) {
        repeated.push(line);
      }
    }
    return repeated.join('\n');
  }, []);

  return (
    <div className="portal">
      {/* Starfield */}
      <div className="starfield">
        {Array.from({ length: 60 }).map((_, i) => (
          <div key={i} className="star" style={{
            left: `${Math.random() * 100}%`,
            top: `${Math.random() * 100}%`,
            width: `${Math.random() * 2 + 1}px`,
            height: `${Math.random() * 2 + 1}px`,
            animationDelay: `${Math.random() * 4}s`,
            animationDuration: `${3 + Math.random() * 4}s`,
          }} />
        ))}
      </div>

      {/* Scanline overlay */}
      <div className="scanlines" />

      {/* Code rain background */}
      <div className="code-rain">
        <div className="code-rain-content">{codeContent}</div>
      </div>

      <div className="portal-content">
        {/* ============ HERO (Two-column) ============ */}
        <div className="hero-split">
          {/* Left: Brand + Docking */}
          <div className="hero-left">
            <div className="portal-badge">
              <div className="portal-badge-dot">
                <div className={`portal-dot-inner ${isOnline ? 'online' : 'offline'}`} />
              </div>
              <span>{isOnline ? 'SYSTEM ONLINE' : 'DISCONNECTED'}</span>
            </div>

            <h1 className="portal-title">
              <span className="portal-title-main">AGENT-X</span>
              <span className="portal-title-sub">Autonomous Agent Framework</span>
            </h1>

            <p className="portal-desc">
              {isOnline
                ? 'Your local AI agent runtime is connected and ready.'
                : 'The AGENT-X web API is not running on your local machine.'}
            </p>

            {/* Docking bay (smaller in hero) */}
            <div className={`dock-area ${isOnline ? 'dock-area-online' : 'dock-area-offline'}`}>
              <div className="dock-port">
                <div className={`dock-ring dock-ring-outer ${isOnline ? '' : 'offline'}`} />
                <div className={`dock-ring dock-ring-mid ${isOnline ? '' : 'offline'}`} />
                <div className={`dock-ring dock-ring-inner ${isOnline ? '' : 'offline'}`} />
                {isOnline ? (
                  <div className="dock-core">
                    <div className="dock-core-glow" />
                    <div className="dock-core-dot" />
                  </div>
                ) : (
                  <div className="dock-no-signal">NO SIGNAL</div>
                )}
              </div>
              <div className="dock-info">
                <div className={`dock-status-badge ${isOnline ? '' : 'offline'}`}>
                  <span className={`dock-status-dot ${isOnline ? '' : 'offline'}`} />
                  {isOnline ? 'WORKER DOCKED' : 'BAY VACANT'}
                </div>
              </div>
            </div>
          </div>

          {/* Right: Cockpit Stats Dashboard */}
          <div className="hero-right">
            <div className="cockpit-panel">
              <div className="cockpit-panel-header">
                <span className="cockpit-panel-scan">◉ SCAN</span>
                <span className="cockpit-panel-title">SYSTEM TELEMETRY</span>
                <span className="cockpit-panel-scan">SCAN ◉</span>
              </div>

              <div className="cockpit-grid">
                <div className="cockpit-stat">
                  <span className="cockpit-stat-icon">⟐</span>
                  <div className="cockpit-stat-body">
                    <span className="cockpit-stat-label">UPTIME</span>
                    <span className="cockpit-stat-value">{isOnline ? formatUptime(health!.uptime) : '—'}</span>
                  </div>
                </div>
                <div className="cockpit-stat">
                  <span className="cockpit-stat-icon">◈</span>
                  <div className="cockpit-stat-body">
                    <span className="cockpit-stat-label">PROCESS ID</span>
                    <span className="cockpit-stat-value">{isOnline ? health!.pid : '—'}</span>
                  </div>
                </div>
                <div className="cockpit-stat">
                  <span className="cockpit-stat-icon">◎</span>
                  <div className="cockpit-stat-body">
                    <span className="cockpit-stat-label">NODE</span>
                    <span className="cockpit-stat-value">{isOnline ? health!.node : '—'}</span>
                  </div>
                </div>
                <div className="cockpit-stat">
                  <span className="cockpit-stat-icon">◉</span>
                  <div className="cockpit-stat-body">
                    <span className="cockpit-stat-label">PLATFORM</span>
                    <span className="cockpit-stat-value">{isOnline ? health!.platform : '—'}</span>
                  </div>
                </div>
                <div className="cockpit-stat">
                  <span className="cockpit-stat-icon">▣</span>
                  <div className="cockpit-stat-body">
                    <span className="cockpit-stat-label">MEMORY</span>
                    <span className="cockpit-stat-value">
                      {isOnline && health?.memory ? fmtBytes(health.memory.heapUsed) : '—'}
                    </span>
                  </div>
                </div>
                <div className="cockpit-stat">
                  <span className="cockpit-stat-icon">◉</span>
                  <div className="cockpit-stat-body">
                    <span className="cockpit-stat-label">WORKER</span>
                    <span className="cockpit-stat-value">
                      {isOnline ? (health ? 'ACTIVE' : '—') : 'OFFLINE'}
                    </span>
                  </div>
                </div>
              </div>

              {isOnline ? (
                <a href="/chat" className="cockpit-cta" onClick={(e) => {
                  e.preventDefault();
                  window.location.href = '/chat';
                }}>
                  <span>LAUNCH MISSION CONTROL</span>
                  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 14, height: 14 }}><path d="M2 8h12M8 2l6 6-6 6"/></svg>
                </a>
              ) : (
                <button className="cockpit-cta offline" onClick={onRetry}>
                  <span>RETRY CONNECTION</span>
                  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ width: 14, height: 14 }}><path d="M1 8a7 7 0 0 1 13.5-3M15 8a7 7 0 0 1-13.5 3"/><path d="M14.5 1v4h-4M1.5 15v-4h4"/></svg>
                </button>
              )}
            </div>
          </div>
        </div>

        {/* ============ TERMINAL DEMO SECTION ============ */}
        {isOnline && (
          <section className="demo-section">
            <div className="demo-header">
              <span className="demo-suptitle">● LIVE DEMO</span>
              <h2 className="demo-title">Autonomous Execution</h2>
              <p className="demo-desc">
                Watch an agent autonomously plan, research, and synthesize information — all in real time.
              </p>
            </div>

            <div className="terminal-window">
              <div className="terminal-topbar">
                <div className="terminal-dots">
                  <span className="terminal-dot" />
                  <span className="terminal-dot" />
                  <span className="terminal-dot" />
                </div>
                <span className="terminal-filename">agent-explorer — agentx session</span>
                <div className="terminal-tag">RUNNING</div>
              </div>
              <div className="terminal-body">
                <div className="terminal-line">{'$'} <span className="terminal-cmd">agentx start --profile default</span></div>
                <div className="terminal-line term-info">&gt; Initializing agent runtime...</div>
                {termLines.map((line, i) =>
                  line ? (
                    <div key={i} className={`terminal-line ${line.type ? `term-${line.type}` : ''}`}>
                      {line.type === 'cmd' && <><span className="term-prompt">{'$'}</span> {line.text}</>}
                      {line.type === 'tool' && <><span className="term-bullet">▸</span> {line.text}</>}
                      {line.type === 'info' && <>{line.text}</>}
                      {line.type === 'success' && <>{line.text}</>}
                      {line.type === 'output' && <>{line.text}</>}
                      {line.type === 'empty' && <>&nbsp;</>}
                    </div>
                  ) : null
                )}
                {!termDone && <span className="term-cursor">▊</span>}
              </div>
            </div>
          </section>
        )}

        {/* ============ CAPABILITIES GRID ============ */}
        <div className="sys-section">
          <div className="sys-header">
            <div className="sys-header-line" />
            <span className="sys-header-label">SYSTEM CAPABILITIES</span>
            <div className="sys-header-line" />
          </div>
          <div className="sys-grid">
            {systems.map((sys) => (
              <div key={sys.title} className="sys-module">
                <div className="sys-icon-wrap">
                  <div className="sys-icon-ring" />
                  <div className="sys-icon">{sys.icon}</div>
                </div>
                <div className="sys-title">{sys.title}</div>
                <div className="sys-desc">{sys.desc}</div>
              </div>
            ))}
          </div>
        </div>

        {/* ============ WEB UI MOCKUP ============ */}
        {isOnline && (
          <section className="demo-section">
            <div className="demo-header">
              <span className="demo-suptitle">● INTERFACE</span>
              <h2 className="demo-title">Command Center</h2>
              <p className="demo-desc">
                A full-featured web interface to interact with your agents, manage sessions, and monitor activity.
              </p>
            </div>

            <div className="web-mockup">
              <div className="mockup-topbar">
                <div className="mockup-dots">
                  <span /><span /><span />
                </div>
                <div className="mockup-url-bar">
                  <span className="url-dim">https://</span>
                  <span className="url-highlight">agent-x.local</span>
                  <span className="url-dim">/chat</span>
                </div>
                <div className="mockup-status-indicator">
                  <span className="mockup-status-dot" />
                  ONLINE
                </div>
              </div>
              <div className="mockup-body">
                <div className="mockup-sidebar">
                  <div className="mockup-sidebar-item active">
                    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M8 1l7 4v6l-7 4-7-4V5z"/></svg>
                    Dashboard
                  </div>
                  <div className="mockup-sidebar-item">
                    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M3 1v14M13 1v14M1 3h14M1 13h14"/></svg>
                    Chat
                  </div>
                  <div className="mockup-sidebar-item">
                    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="8" cy="8" r="3"/><path d="M8 1v3M8 12v3M1 8h3M12 8h3"/></svg>
                    Sessions
                  </div>
                  <div className="mockup-sidebar-item">
                    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M2 4l6-3 6 3v8l-6 3-6-3z"/><path d="M2 4l6 3M14 4l-6 3M8 7v6"/></svg>
                    Crews
                  </div>
                  <div className="mockup-sidebar-item">
                    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="8" cy="8" r="7"/><path d="M8 4v4l3 3"/></svg>
                    Settings
                  </div>
                </div>
                <div className="mockup-main">
                  <div className="mockup-stats-row">
                    <div className="mockup-stat-card">
                      <div className="mockup-stat-icon">
                        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="8" cy="8" r="7"/><path d="M8 4v4l3 3"/></svg>
                      </div>
                      <div className="mockup-stat-body">
                        <span className="mockup-stat-label">UPTIME</span>
                        <span className="mockup-stat-num">{isOnline ? formatUptime(health!.uptime) : '—'}</span>
                      </div>
                    </div>
                    <div className="mockup-stat-card">
                      <div className="mockup-stat-icon">
                        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="2" y="4" width="12" height="8" rx="1"/><path d="M8 4V2M4 4V3M12 4V3"/></svg>
                      </div>
                      <div className="mockup-stat-body">
                        <span className="mockup-stat-label">MEMORY</span>
                        <span className="mockup-stat-num">{health?.memory ? fmtBytes(health.memory.heapUsed) : '—'}</span>
                      </div>
                    </div>
                    <div className="mockup-stat-card">
                      <div className="mockup-stat-icon">
                        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="8" cy="8" r="3"/><path d="M8 1v3M8 12v3M1 8h3M12 8h3"/></svg>
                      </div>
                      <div className="mockup-stat-body">
                        <span className="mockup-stat-label">SESSIONS</span>
                        <span className="mockup-stat-num">{health ? '3' : '—'}</span>
                      </div>
                    </div>
                    <div className="mockup-stat-card">
                      <div className="mockup-stat-icon">
                        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M2 4l6-3 6 3v8l-6 3-6-3z"/><path d="M2 4l6 3M14 4l-6 3M8 7v6"/></svg>
                      </div>
                      <div className="mockup-stat-body">
                        <span className="mockup-stat-label">CREWS</span>
                        <span className="mockup-stat-num">{health ? '2' : '—'}</span>
                      </div>
                    </div>
                  </div>
                  <div className="mockup-chat-preview">
                    <div className="mockup-chat-msg agent">
                      <div className="mockup-chat-avatar">X</div>
                      <div className="mockup-chat-bubble">Agent-X ready. How can I assist you today?</div>
                    </div>
                    <div className="mockup-chat-msg user">
                      <div className="mockup-chat-bubble user">Research the latest AI frameworks</div>
                      <div className="mockup-chat-avatar">U</div>
                    </div>
                    <div className="mockup-chat-msg agent">
                      <div className="mockup-chat-avatar">X</div>
                      <div className="mockup-chat-bubble">
                        I'll search the web for the latest AI frameworks and compile a comparison.
                        <span className="mockup-typing">▊</span>
                      </div>
                    </div>
                    <div className="mockup-chat-input">
                      <span className="mockup-input-placeholder">Type a message...</span>
                      <div className="mockup-send-btn">
                        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M1 8l14-6-6 14-3-5-5-3z"/></svg>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* ============ OFFLINE STATE ============ */}
        {!isOnline && (
          <div className="portal-actions">
            <div className="portal-cmd-card">
              <div className="portal-cmd-label">Start Agent</div>
              <code className="portal-cmd">agentx start</code>
            </div>
            <div className="portal-cmd-card">
              <div className="portal-cmd-label">Install Agent-X</div>
              <code className="portal-cmd">curl -fsSL https://raw.githubusercontent.com/SlashpanOrg/agent-x/main/install.sh | bash</code>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="portal-footer">
          <span>AGENT-X v1.0.0</span>
          <span className="portal-footer-sep">|</span>
          <span>{isOnline ? `PID ${health?.pid} · ${health?.node}` : 'Offline'}</span>
        </div>
      </div>
    </div>
  );
}
