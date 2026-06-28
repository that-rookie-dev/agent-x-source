import { useState, useEffect, useCallback, type ReactNode } from 'react';
import IconButton from '@mui/material/IconButton';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import LinearProgress from '@mui/material/LinearProgress';
import Chip from '@mui/material/Chip';
import {
  health as healthApi,
  agent as agentApi,
  sessions as sessionsApi,
  type HealthStatus,
  type AutonomyStatus,
  type SessionDbStatus,
} from '../api';
import { colors } from '../theme';
import {
  healthTheme,
  healthOverlineSx,
  healthMonoSx,
  healthScanlineSx,
  healthPanelSx,
  barColor,
} from '../styles/health-theme';
import { PanelHeader } from './PanelHeader';

function formatMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3600000) return `${Math.round(ms / 60000)}m`;
  return `${(ms / 3600000).toFixed(1)}h`;
}

function formatUptime(sec: number): string {
  if (!Number.isFinite(sec)) return '—';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '—';
  if (n >= 1048576) return `${(n / 1048576).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${n} B`;
}

function formatCost(cost: number): string {
  if (!Number.isFinite(cost)) return '—';
  return `$${cost.toFixed(4)}`;
}

function safePct(n: number | undefined): number | null {
  if (!Number.isFinite(n)) return null;
  return Math.min(100, Math.max(0, n!));
}

function safeNum(n: number | undefined): number | null {
  return Number.isFinite(n) ? n! : null;
}

function HudPanel({
  title,
  subtitle,
  children,
  action,
  borderColor,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  action?: ReactNode;
  borderColor?: string;
}) {
  return (
    <Box sx={{ ...healthPanelSx(borderColor), display: 'flex', flexDirection: 'column' }}>
      <Box sx={healthScanlineSx} />
      <Box sx={{
        px: 1.5, py: 1, borderBottom: `1px solid ${healthTheme.border.subtle}`,
        display: 'flex', alignItems: 'center', gap: 1, position: 'relative', zIndex: 1,
      }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography sx={healthOverlineSx}>{title}</Typography>
          {subtitle && (
            <Typography sx={{ ...healthMonoSx, fontSize: '0.55rem', color: healthTheme.text.dim, mt: 0.25 }}>
              {subtitle}
            </Typography>
          )}
        </Box>
        {action}
      </Box>
      <Box sx={{ p: 1.5, position: 'relative', zIndex: 1 }}>
        {children}
      </Box>
    </Box>
  );
}

function MetricRow({ label, value, sub, alert }: { label: string; value: string; sub?: string; alert?: boolean }) {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', mb: 0.75, gap: 1 }}>
      <Typography sx={{ ...healthMonoSx, color: healthTheme.text.dim, fontSize: '0.65rem', flexShrink: 0 }}>
        {label}
      </Typography>
      <Box sx={{ textAlign: 'right', minWidth: 0 }}>
        <Typography sx={{
          ...healthMonoSx, fontSize: '0.72rem', fontWeight: 600,
          color: alert ? healthTheme.accent.alert : healthTheme.text.primary,
          wordBreak: 'break-all',
        }}>
          {value}
        </Typography>
        {sub && (
          <Typography sx={{ ...healthMonoSx, color: healthTheme.text.dim, fontSize: '0.55rem' }}>{sub}</Typography>
        )}
      </Box>
    </Box>
  );
}

function ProgressMetric({ label, pct, detail }: { label: string; pct: number; detail?: string }) {
  return (
    <Box sx={{ mb: 1.25 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.4 }}>
        <Typography sx={{ ...healthMonoSx, fontSize: '0.65rem', color: healthTheme.text.dim }}>{label}</Typography>
        <Typography sx={{ ...healthMonoSx, fontSize: '0.65rem', color: healthTheme.text.secondary }}>{pct}%</Typography>
      </Box>
      <LinearProgress variant="determinate" value={pct} sx={{
        height: 4, borderRadius: 1, bgcolor: healthTheme.bg.inset,
        '& .MuiLinearProgress-bar': { bgcolor: barColor(pct) },
      }} />
      {detail && (
        <Typography sx={{ ...healthMonoSx, fontSize: '0.55rem', color: healthTheme.text.dim, mt: 0.35 }}>{detail}</Typography>
      )}
    </Box>
  );
}

function StatusChip({ label, state }: { label: string; state: 'ok' | 'warn' | 'off' }) {
  const color = state === 'ok' ? healthTheme.accent.live : state === 'warn' ? healthTheme.accent.warn : healthTheme.text.dim;
  return (
    <Box sx={{
      display: 'flex', alignItems: 'center', gap: 0.75, px: 1.25, py: 0.75,
      border: `1px solid ${healthTheme.border.default}`, borderRadius: '4px',
      bgcolor: healthTheme.bg.inset,
    }}>
      <Box sx={{
        width: 6, height: 6, borderRadius: '50%', bgcolor: color, flexShrink: 0,
        opacity: state === 'off' ? 0.4 : 1,
      }} />
      <Typography sx={{ ...healthMonoSx, fontSize: '0.62rem', fontWeight: 600, color: healthTheme.text.primary }}>
        {label}
      </Typography>
    </Box>
  );
}

function TextBlock({ text }: { text: string }) {
  if (!text?.trim()) return null;
  return (
    <Box sx={{ mb: 1 }}>
      {text.split('\n').filter(l => l.trim()).map((line, i) => (
        <Typography key={i} sx={{ ...healthMonoSx, color: healthTheme.text.secondary, fontSize: '0.6rem', lineHeight: 1.55 }}>
          {line}
        </Typography>
      ))}
    </Box>
  );
}

export function HealthPanel() {
  const [data, setData] = useState<HealthStatus | null>(null);
  const [autonomy, setAutonomy] = useState<AutonomyStatus | null>(null);
  const [dbStatus, setDbStatus] = useState<SessionDbStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const fetchAll = useCallback(async () => {
    try {
      const [healthData, autonomyData, dbData] = await Promise.all([
        healthApi.check().catch(() => null),
        agentApi.autonomyStatus().catch(() => null),
        sessionsApi.dbStatus().catch(() => null),
      ]);
      if (healthData) setData(healthData);
      if (autonomyData) setAutonomy(autonomyData);
      if (dbData) setDbStatus(dbData);
      setLastRefresh(new Date());
      setError(healthData ? null : 'Unable to reach health endpoint');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to fetch telemetry');
    }
  }, []);

  useEffect(() => {
    fetchAll();
    const interval = setInterval(fetchAll, 5000);
    return () => clearInterval(interval);
  }, [fetchAll]);

  const ah = data?.agentHealth ?? autonomy?.health ?? null;
  const budgetPct = safePct(ah?.budgetPct);
  const ctxWindow = safeNum(ah?.contextWindow);
  const ctxTokens = safeNum(ah?.contextTokens);
  const ctxPct = ah && ctxWindow && ctxWindow > 0 && ctxTokens != null
    ? Math.round((ctxTokens / ctxWindow) * 100)
    : null;
  const cb = autonomy?.circuitBreakers ?? [];
  const cbActive = cb.filter(c => c.blacklisted);
  const sessions = data?.sessionCount ?? data?.sessions ?? 0;
  const crews = data?.crewCount ?? data?.crews ?? 0;
  const systemOk = data?.status === 'ok';
  const agentActive = !!data?.agentActive;
  const hasAgentMetrics = !!ah;
  const heapTotal = data?.memory?.heapTotal;
  const heapUsed = data?.memory?.heapUsed;
  const heapPct = heapTotal && heapUsed != null ? Math.round((heapUsed / heapTotal) * 100) : null;
  const costHistory = ah?.costHistory?.filter(p => p.cost > 0).slice(-24).map(p => p.cost) ?? [];
  const hasNeural = !!(autonomy?.neural?.proven || autonomy?.neural?.caution || autonomy?.neural?.growth || autonomy?.memoryDriven);
  const hasEscalation = (autonomy?.escalation?.checkpointDetails?.length ?? 0) > 0;
  const hasCompaction = safeNum(autonomy?.compaction?.count) != null && autonomy!.compaction!.count > 0;
  const alertCount = cbActive.length + (hasEscalation ? autonomy!.escalation!.checkpointDetails.length : 0);
  const telegramConfigured = data?.telegramConnected || !!data?.telegramBot;
  const hasGateway = (data?.gateway?.channels?.length ?? 0) > 0;

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden', bgcolor: healthTheme.bg.void }}>
      <PanelHeader
        title="Health"
        subtitle="System health · telemetry · budgets"
        action={
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            {lastRefresh && (
              <Typography sx={{ ...healthMonoSx, fontSize: '0.5rem', color: colors.text.dim, display: { xs: 'none', sm: 'block' } }}>
                {lastRefresh.toLocaleTimeString()}
              </Typography>
            )}
            {data?.version && (
              <Typography sx={{ ...healthMonoSx, fontSize: '0.55rem', color: colors.text.dim }}>
                v{data.version}
              </Typography>
            )}
          </Box>
        }
      />

      <Box sx={{ flex: 1, overflow: 'auto', p: 1.5, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
        {error && (
          <Typography sx={{ ...healthMonoSx, color: healthTheme.accent.alert, fontSize: '0.7rem' }}>
            {error}
          </Typography>
        )}

        {/* Compact status */}
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          <StatusChip label={systemOk ? 'System OK' : 'System degraded'} state={systemOk ? 'ok' : 'warn'} />
          <StatusChip
            label={agentActive ? (hasAgentMetrics ? 'Agent active' : 'Agent starting') : 'No agent session'}
            state={agentActive ? 'ok' : 'off'}
          />
          {alertCount > 0 && (
            <StatusChip label={`${alertCount} alert${alertCount > 1 ? 's' : ''}`} state="warn" />
          )}
        </Box>

        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 1.5 }}>
          {/* System */}
          <HudPanel title="System" subtitle="Server & storage">
            <MetricRow label="Status" value={data?.status?.toUpperCase() ?? '—'} alert={!systemOk} />
            <MetricRow label="Uptime" value={formatUptime(data?.uptime ?? 0)} />
            <MetricRow label="Memory" value={formatBytes(heapUsed ?? 0)}
              sub={heapTotal ? `Heap ${formatBytes(heapUsed ?? 0)} / ${formatBytes(heapTotal)}` : `RSS ${formatBytes(data?.memory?.rss ?? 0)}`} />
            {heapPct != null && <ProgressMetric label="Heap usage" pct={heapPct} />}
            <MetricRow label="Sessions" value={String(sessions)} />
            <MetricRow label="Crews" value={String(crews)} />
            {data?.config?.provider && (
              <MetricRow label="Provider" value={data.config.provider} sub={data.config.model} />
            )}
            {dbStatus && (
              <MetricRow label="Database" value={dbStatus.backend?.toUpperCase() ?? '—'}
                sub={`${dbStatus.connected ? 'Connected' : 'Disconnected'} · ${dbStatus.sessionCount} stored · schema v${dbStatus.schemaVersion}`} />
            )}
            {telegramConfigured && (
              <MetricRow label="Telegram" value={data?.telegramConnected ? 'Connected' : 'Configured'}
                sub={data?.telegramBot ? `@${data.telegramBot}` : undefined} />
            )}
            {hasGateway && (
              <MetricRow label="Gateway" value={data?.gateway?.focus ?? '—'}
                sub={data?.gateway?.channels?.join(', ')} />
            )}
          </HudPanel>

          {/* Agent session */}
          <HudPanel
            title="Agent"
            subtitle={hasAgentMetrics ? `Session ${ah!.sessionId.slice(0, 8)}` : undefined}
          >
            {!hasAgentMetrics ? (
              <Typography sx={{ ...healthMonoSx, fontSize: '0.65rem', color: healthTheme.text.dim, lineHeight: 1.6, py: 1 }}>
                {agentActive
                  ? 'Agent is running — waiting for metrics.'
                  : 'No active session. Open chat to start an agent.'}
              </Typography>
            ) : (
              <>
                {(ah!.planMode || ah!.hyperdriveMode || cbActive.length > 0) && (
                  <Box sx={{ display: 'flex', gap: 0.5, mb: 1.25, flexWrap: 'wrap' }}>
                    {ah!.planMode && (
                      <Chip label="Plan mode" size="small" sx={{ height: 18, fontSize: '0.5rem', ...healthMonoSx, bgcolor: 'transparent', border: `1px solid ${healthTheme.border.default}`, color: healthTheme.text.secondary }} />
                    )}
                    {ah!.hyperdriveMode && (
                      <Chip label="Hyperdrive" size="small" sx={{ height: 18, fontSize: '0.5rem', ...healthMonoSx, bgcolor: 'transparent', border: `1px solid ${healthTheme.border.default}`, color: healthTheme.text.secondary }} />
                    )}
                    {cbActive.length > 0 && (
                      <Chip label={`${cbActive.length} breaker${cbActive.length > 1 ? 's' : ''} tripped`} size="small" sx={{ height: 18, fontSize: '0.5rem', ...healthMonoSx, bgcolor: 'transparent', border: `1px solid ${healthTheme.accent.alert}`, color: healthTheme.accent.alert }} />
                    )}
                  </Box>
                )}
                <MetricRow label="Model" value={ah!.model ?? '—'} sub={ah!.provider} />
                {ctxPct != null && (
                  <ProgressMetric
                    label="Context"
                    pct={ctxPct}
                    detail={`${(ctxTokens ?? 0).toLocaleString()} / ${(ctxWindow ?? 0).toLocaleString()} tokens`}
                  />
                )}
                {budgetPct != null && (
                  <ProgressMetric
                    label="Budget"
                    pct={budgetPct}
                    detail={`${formatCost(safeNum(ah!.totalCost) ?? 0)} of ${formatCost(safeNum(ah!.budgetLimit) ?? 0)}`}
                  />
                )}
                {costHistory.length > 1 && (
                  <Box sx={{ display: 'flex', alignItems: 'end', gap: '2px', height: 24, mb: 1.25 }}>
                    {costHistory.map((p, i) => {
                      const max = Math.max(...costHistory);
                      return (
                        <Box key={i} sx={{
                          flex: 1, minWidth: 2,
                          height: Math.max(2, (p / max) * 24),
                          bgcolor: healthTheme.text.dim,
                          borderRadius: '1px',
                          opacity: 0.6,
                        }} />
                      );
                    })}
                  </Box>
                )}
                <MetricRow label="LLM calls" value={String(safeNum(ah!.llmCalls) ?? 0)} />
                <MetricRow label="Tool executions" value={String(safeNum(ah!.toolExecs) ?? 0)} />
                {(safeNum(ah!.errors) ?? 0) > 0 && (
                  <MetricRow label="Errors" value={String(ah!.errors)} alert
                    sub={safeNum(ah!.llmCalls) ? `${((ah!.errors / ah!.llmCalls) * 100).toFixed(1)}% of calls` : undefined} />
                )}
                <MetricRow label="Avg response" value={formatMs(safeNum(ah!.avgResponseMs) ?? 0)} />
                <MetricRow label="Session uptime" value={formatMs(safeNum(ah!.uptimeMs) ?? 0)} />
                {(safeNum(ah!.activeSubAgents) ?? 0) > 0 && (
                  <MetricRow label="Sub-agents" value={String(ah!.activeSubAgents)} />
                )}
                {(safeNum(ah!.compactionCount) ?? 0) > 0 && (
                  <MetricRow label="Compactions" value={String(ah!.compactionCount)} />
                )}
              </>
            )}
          </HudPanel>
        </Box>

        {/* Circuit breakers — only when present */}
        {cb.length > 0 && (
          <HudPanel
            title="Circuit breakers"
            subtitle={`${cbActive.length} tripped`}
            borderColor={cbActive.length > 0 ? healthTheme.accent.alert : undefined}
            action={
              <IconButton size="small" onClick={async () => { await agentApi.resetCircuitBreaker(); fetchAll(); }}
                sx={{ color: healthTheme.text.dim, p: 0.5, '&:hover': { color: healthTheme.text.primary } }}>
                <RestartAltIcon sx={{ fontSize: 14 }} />
              </IconButton>
            }
          >
            {cb.map(c => (
              <Box key={c.tool} sx={{
                mb: 0.75, p: 1, borderRadius: '4px',
                border: `1px solid ${c.blacklisted ? healthTheme.accent.alert : healthTheme.border.subtle}`,
                bgcolor: healthTheme.bg.inset,
              }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Typography sx={{ ...healthMonoSx, fontSize: '0.65rem', fontWeight: 600, color: healthTheme.text.primary }}>
                    {c.tool}
                  </Typography>
                  <Typography sx={{ ...healthMonoSx, fontSize: '0.55rem', color: c.blacklisted ? healthTheme.accent.alert : healthTheme.text.dim }}>
                    {c.blacklisted ? `Banned · ${Math.ceil((safeNum(c.remainingMs) ?? 0) / 1000)}s` : `${c.failures}/3 failures`}
                  </Typography>
                </Box>
              </Box>
            ))}
          </HudPanel>
        )}

        {/* Neural context — only when agent has content */}
        {hasNeural && (
          <HudPanel title="Neural context" subtitle="Active patterns">
            {autonomy?.neural?.proven && (
              <Box sx={{ mb: 1 }}>
                <Typography sx={{ ...healthOverlineSx, mb: 0.5 }}>Proven</Typography>
                <TextBlock text={autonomy.neural.proven} />
              </Box>
            )}
            {autonomy?.neural?.caution && (
              <Box sx={{ mb: 1 }}>
                <Typography sx={{ ...healthOverlineSx, mb: 0.5 }}>Caution</Typography>
                <TextBlock text={autonomy.neural.caution} />
              </Box>
            )}
            {autonomy?.neural?.growth && (
              <Box sx={{ mb: 1 }}>
                <Typography sx={{ ...healthOverlineSx, mb: 0.5 }}>Growth</Typography>
                <TextBlock text={autonomy.neural.growth} />
              </Box>
            )}
            {autonomy?.memoryDriven && (
              <Box>
                <Typography sx={{ ...healthOverlineSx, mb: 0.5 }}>Memory-driven</Typography>
                <TextBlock text={autonomy.memoryDriven} />
              </Box>
            )}
          </HudPanel>
        )}

        {/* Alerts — only real issues */}
        {(hasEscalation || hasCompaction || autonomy?.offlineFallback?.available) && (
          <HudPanel title="Alerts" subtitle="Active issues & compaction">
            {autonomy?.escalation?.checkpointDetails?.map((d, i) => (
              <Box key={i} sx={{ mb: 0.75, p: 1, borderRadius: '4px', border: `1px solid ${healthTheme.accent.alert}`, bgcolor: healthTheme.bg.inset }}>
                <Typography sx={{ ...healthMonoSx, fontSize: '0.6rem', color: healthTheme.accent.alert, lineHeight: 1.5 }}>
                  {d.description}
                </Typography>
              </Box>
            ))}
            {hasCompaction && autonomy?.compaction && (
              <>
                <MetricRow label="Compactions" value={String(autonomy.compaction.count)} />
                <ProgressMetric
                  label="Context after compaction"
                  pct={safePct(autonomy.compaction.tokenUsagePct) ?? 0}
                  detail={`${safeNum(autonomy.compaction.contextTokens)?.toLocaleString() ?? '—'} / ${safeNum(autonomy.compaction.contextWindow)?.toLocaleString() ?? '—'} tokens`}
                />
              </>
            )}
            {autonomy?.offlineFallback?.available && (
              <MetricRow label="Offline fallback" value={autonomy.offlineFallback.provider} sub={autonomy.offlineFallback.model} />
            )}
          </HudPanel>
        )}
      </Box>
    </Box>
  );
}
