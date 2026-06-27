import { useEffect, useMemo, useState } from 'react';
import { api, type SessionInfo, type DbStatus } from './api.ts';
import { neuronTheme } from './theme.ts';

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function statusDotStyle(online: boolean): React.CSSProperties {
  return {
    width: 8,
    height: 8,
    borderRadius: '50%',
    background: online ? neuronTheme.accent.green : neuronTheme.accent.red,
    boxShadow: online ? `0 0 8px ${neuronTheme.accent.green}` : `0 0 8px ${neuronTheme.accent.red}`,
  };
}

function nodeStyle(i: number): React.CSSProperties {
  return {
    background: neuronTheme.bg.inset,
    border: `1px solid ${neuronTheme.border.default}`,
    borderLeft: `3px solid ${i % 2 === 0 ? neuronTheme.accent.amber : neuronTheme.accent.orange}`,
    borderRadius: '4px',
    padding: '16px',
    transition: 'border-color 0.2s, background 0.2s',
  };
}

export default function App() {
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [dbStatus, setDbStatus] = useState<DbStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    async function load() {
      try {
        const [s, d] = await Promise.all([api.sessions(), api.dbStatus()]);
        if (!mounted) return;
        setSessions(s);
        setDbStatus(d);
        setError(null);
      } catch (e) {
        if (!mounted) return;
        setError(e instanceof Error ? e.message : 'Failed to load neural data');
      } finally {
        if (mounted) setLoading(false);
      }
    }
    load();
    const interval = setInterval(load, 5000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  const totalMessages = useMemo(() => sessions.reduce((sum, s) => sum + (s.messageCount || 0), 0), [sessions]);
  const apiBase = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3333';

  return (
    <div style={styles.page}>
      <div style={styles.gridOverlay} />

      <header style={styles.header}>
        <div style={styles.badge}>AGENT-X // NEURAL VISUALIZER</div>
        <div style={styles.statusRow}>
          <span style={statusDotStyle(dbStatus?.connected ?? false)} />
          <span style={styles.statusText}>{dbStatus?.connected ? 'POSTGRES ONLINE' : 'POSTGRES OFFLINE'}</span>
        </div>
      </header>

      <main style={styles.main}>
        {loading && (
          <div style={styles.center}>
            <div style={styles.spinner} />
            <p style={styles.hudText}>ESTABLISHING UPLINK...</p>
          </div>
        )}

        {!loading && error && (
          <div style={styles.panel}>
            <p style={styles.alert}>COMMS FAILURE: {error}</p>
            <p style={styles.dim}>Ensure the web-api is running on {apiBase}</p>
          </div>
        )}

        {!loading && !error && (
          <>
            <div style={styles.statsRow}>
              <Stat label="SESSIONS" value={sessions.length} />
              <Stat label="MESSAGES" value={totalMessages} />
              <Stat label="TABLES" value={dbStatus?.stats.tableCount ?? 0} />
              <Stat label="BACKEND" value={dbStatus?.backend?.toUpperCase() ?? '—'} />
            </div>

            <div style={styles.panel}>
              <h2 style={styles.panelTitle}>NEURAL NODES</h2>
              {sessions.length === 0 ? (
                <p style={styles.dim}>No active neural nodes. Create a session in the main console.</p>
              ) : (
                <div style={styles.nodeList}>
                  {sessions.map((s, i) => (
                    <div key={s.id} style={nodeStyle(i)}>
                      <div style={styles.nodeHeader}>
                        <span style={styles.nodeId}>NODE {i + 1}</span>
                        <span style={styles.nodeBadge}>{s.status.toUpperCase()}</span>
                      </div>
                      <div style={styles.nodeTitle}>{s.title || 'Untitled Session'}</div>
                      <div style={styles.nodeMeta}>
                        <span>{s.provider}</span>
                        <span>·</span>
                        <span>{s.model}</span>
                        <span>·</span>
                        <span>{s.messageCount} messages</span>
                        <span>·</span>
                        <span>UPDATED {formatTime(s.updatedAt)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </main>

      <footer style={styles.footer}>
        <span style={styles.dim}>PORT 3334 // BLACK & WHITE + AMBER ACCENT // SPACE+Mil SPEC</span>
      </footer>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div style={styles.statCard}>
      <div style={styles.statLabel}>{label}</div>
      <div style={styles.statValue}>{value}</div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    background: neuronTheme.bg.void,
    color: neuronTheme.text.primary,
    fontFamily: neuronTheme.font,
    position: 'relative',
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
  },
  gridOverlay: {
    position: 'absolute',
    inset: 0,
    backgroundImage: `
      linear-gradient(rgba(255, 255, 255, 0.03) 1px, transparent 1px),
      linear-gradient(90deg, rgba(255, 255, 255, 0.03) 1px, transparent 1px)
    `,
    backgroundSize: '40px 40px',
    pointerEvents: 'none',
    zIndex: 0,
  },
  header: {
    position: 'relative',
    zIndex: 1,
    padding: '24px 32px',
    borderBottom: `1px solid ${neuronTheme.border.default}`,
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    background: 'rgba(0,0,0,0.6)',
    backdropFilter: 'blur(4px)',
  },
  badge: {
    fontSize: '0.85rem',
    fontWeight: 700,
    letterSpacing: '2px',
    color: neuronTheme.text.primary,
    border: `1px solid ${neuronTheme.border.strong}`,
    padding: '6px 12px',
    borderRadius: '4px',
  },
  statusRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  statusText: {
    fontSize: '0.65rem',
    letterSpacing: '1.5px',
    color: neuronTheme.text.secondary,
  },
  main: {
    position: 'relative',
    zIndex: 1,
    flex: 1,
    padding: '32px',
    display: 'flex',
    flexDirection: 'column',
    gap: '24px',
    maxWidth: 1200,
    width: '100%',
    margin: '0 auto',
  },
  center: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
    gap: '16px',
  },
  spinner: {
    width: 32,
    height: 32,
    border: `2px solid ${neuronTheme.border.strong}`,
    borderTopColor: neuronTheme.accent.amber,
    borderRadius: '50%',
    animation: 'spin 1s linear infinite',
  },
  hudText: {
    fontSize: '0.75rem',
    letterSpacing: '2px',
    color: neuronTheme.text.dim,
  },
  statsRow: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
    gap: '16px',
  },
  statCard: {
    background: neuronTheme.bg.panel,
    border: `1px solid ${neuronTheme.border.default}`,
    borderRadius: '6px',
    padding: '18px 20px',
  },
  statLabel: {
    fontSize: '0.6rem',
    letterSpacing: '1.5px',
    color: neuronTheme.text.dim,
    marginBottom: '8px',
  },
  statValue: {
    fontSize: '1.6rem',
    fontWeight: 700,
    color: neuronTheme.text.primary,
  },
  panel: {
    background: neuronTheme.bg.panel,
    border: `1px solid ${neuronTheme.border.default}`,
    borderRadius: '6px',
    padding: '24px',
  },
  panelTitle: {
    fontSize: '0.75rem',
    letterSpacing: '2px',
    color: neuronTheme.accent.amber,
    marginTop: 0,
    marginBottom: '20px',
  },
  nodeList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  nodeHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '8px',
  },
  nodeId: {
    fontSize: '0.6rem',
    letterSpacing: '1.5px',
    color: neuronTheme.text.dim,
  },
  nodeBadge: {
    fontSize: '0.55rem',
    letterSpacing: '1px',
    color: neuronTheme.accent.green,
    border: `1px solid ${neuronTheme.accent.green}40`,
    padding: '2px 6px',
    borderRadius: '3px',
  },
  nodeTitle: {
    fontSize: '0.95rem',
    fontWeight: 600,
    color: neuronTheme.text.primary,
    marginBottom: '6px',
  },
  nodeMeta: {
    fontSize: '0.65rem',
    color: neuronTheme.text.secondary,
    display: 'flex',
    gap: '8px',
    flexWrap: 'wrap',
  },
  dim: {
    color: neuronTheme.text.dim,
    fontSize: '0.75rem',
  },
  alert: {
    color: neuronTheme.accent.red,
    fontSize: '0.85rem',
    fontWeight: 600,
  },
  footer: {
    position: 'relative',
    zIndex: 1,
    padding: '16px 32px',
    borderTop: `1px solid ${neuronTheme.border.default}`,
    textAlign: 'center',
  },
};
