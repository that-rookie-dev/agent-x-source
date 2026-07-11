import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import Button from '@mui/material/Button';
import Tooltip from '@mui/material/Tooltip';
import CircularProgress from '@mui/material/CircularProgress';
import PauseIcon from '@mui/icons-material/Pause';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import RefreshIcon from '@mui/icons-material/Refresh';
import ScheduleIcon from '@mui/icons-material/Schedule';
import { PanelHeader } from './PanelHeader';
import { automation, type AutomationTaskRecord, type TelemetryEvent } from '../api';
import { usePageVisible } from '../hooks/usePageVisible';
import { automationRunSessionId } from '@agentx/shared/browser';
import { subscribeOptimizedTelemetry } from '../perf/optimized-telemetry';
import { colors } from '../theme';

/** Minimal black & white palette for this panel only */
const bw = {
  bg: colors.bg.primary,
  panel: colors.bg.secondary,
  card: colors.bg.tertiary,
  cardSelected: colors.bg.hover,
  border: colors.border.default,
  borderStrong: colors.border.accent,
  text: colors.text.primary,
  muted: colors.text.secondary,
  dim: colors.text.dim,
};

interface OpsLogEntry {
  id: string;
  ts: number;
  level: 'info' | 'tool' | 'think' | 'ok' | 'err' | 'sys';
  label: string;
  detail?: string;
}

function formatCountdown(ms: number | null): string {
  if (ms === null) return '—';
  if (ms <= 0) return '00:00:00';
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function useCountdown(targetIso: string | null | undefined): number | null {
  const [remaining, setRemaining] = useState<number | null>(null);
  useEffect(() => {
    if (!targetIso) { setRemaining(null); return; }
    const tick = () => {
      const ms = new Date(targetIso).getTime() - Date.now();
      setRemaining(ms > 0 ? ms : 0);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [targetIso]);
  return remaining;
}

function eventBelongsToTask(ev: TelemetryEvent, taskId: string): boolean {
  const sessionId = automationRunSessionId(taskId);
  if (ev.type === 'automation_run_started' || ev.type === 'automation_run_ended'
    || ev.type === 'automation_run_triggered' || ev.type === 'automation_run_preparing') {
    return (ev as { taskId?: string }).taskId === taskId;
  }
  const sid = (ev as { sessionId?: string }).sessionId;
  const tid = (ev as { automationTaskId?: string }).automationTaskId;
  return tid === taskId || sid === sessionId;
}

function telemetryToLogEntry(ev: TelemetryEvent): OpsLogEntry | null {
  const ts = Date.now();
  const id = `${ts}-${Math.random().toString(36).slice(2, 8)}`;
  switch (ev.type) {
    case 'automation_run_triggered':
      return { id, ts, level: 'sys', label: 'TRIGGER', detail: 'Scheduled time reached' };
    case 'automation_run_preparing':
      return {
        id, ts, level: 'sys', label: 'PREP',
        detail: String((ev as { detail?: string }).detail ?? 'Preparing worker…'),
      };
    case 'automation_run_started':
      return { id, ts, level: 'sys', label: 'START', detail: (ev as { title?: string }).title };
    case 'automation_run_ended':
      return {
        id, ts, level: (ev as { status?: string }).status === 'failed' ? 'err' : 'ok',
        label: 'END',
        detail: (ev as { status?: string }).status ?? 'done',
      };
    case 'loading_start':
      return { id, ts, level: 'think', label: 'AGENT', detail: 'Processing…' };
    case 'loading_end':
      return { id, ts, level: 'info', label: 'TURN' };
    case 'agent_thinking':
      return {
        id, ts, level: 'think',
        label: 'THINK',
        detail: String((ev as { content?: string }).content ?? '').slice(0, 500),
      };
    case 'tool_executing':
      return {
        id, ts, level: 'tool',
        label: (ev as { tool?: string }).tool ?? 'tool',
        detail: (ev as { message?: string }).message ?? (ev as { description?: string }).description,
      };
    case 'tool_complete':
    case 'tool_result':
      return {
        id, ts, level: (ev as { success?: boolean }).success === false ? 'err' : 'tool',
        label: (ev as { tool?: string }).tool ?? 'tool',
        detail: String((ev as { output?: string }).output ?? (ev as { result?: { output?: string } }).result?.output ?? '').slice(0, 400),
      };
    case 'tool_output':
      return {
        id, ts, level: 'tool',
        label: `stream ${(ev as { tool?: string }).tool ?? ''}`,
        detail: String((ev as { output?: string }).output ?? '').slice(0, 300),
      };
    case 'message_received': {
      const msg = (ev as { message?: { role?: string; content?: string } }).message;
      if (msg?.role !== 'assistant') return null;
      return { id, ts, level: 'ok', label: 'REPORT', detail: String(msg.content ?? '').slice(0, 600) };
    }
    default:
      return null;
  }
}

function CountdownDisplay({ targetIso, active }: { targetIso: string | null | undefined; active: boolean }) {
  const remaining = useCountdown(active ? targetIso : null);
  return (
    <Typography sx={{
      fontFamily: "'JetBrains Mono', monospace",
      letterSpacing: '0.06em',
      fontSize: '0.85rem',
      fontWeight: 500,
      color: bw.text,
      lineHeight: 1,
    }}>
      {active ? formatCountdown(remaining) : '—'}
    </Typography>
  );
}

function TaskCard({
  task,
  selected,
  running,
  onSelect,
  onPause,
  onResume,
  onRun,
  onCancel,
  onDelete,
  busy,
}: {
  task: AutomationTaskRecord;
  selected: boolean;
  running: boolean;
  onSelect: () => void;
  onPause: () => void;
  onResume: () => void;
  onRun: () => void;
  onCancel: () => void;
  onDelete: () => void;
  busy: boolean;
}) {
  const showCountdown = task.status === 'active' && !running;
  const canCancel = task.status === 'active' || task.status === 'paused';
  const canDelete = task.status === 'completed';
  return (
    <Box
      onClick={onSelect}
      sx={{
        p: 1.5,
        mb: 0.75,
        borderRadius: 0.5,
        cursor: 'pointer',
        border: `1px solid ${selected ? bw.borderStrong : bw.border}`,
        bgcolor: selected ? bw.cardSelected : bw.card,
        transition: 'border-color 0.12s',
        '&:hover': { borderColor: bw.borderStrong },
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 1 }}>
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography sx={{ fontSize: '0.55rem', color: bw.dim, letterSpacing: '0.1em', fontFamily: "'JetBrains Mono', monospace", mb: 0.25 }}>
            {running ? 'RUNNING' : task.status.toUpperCase()} · {task.scheduleType === 'once' ? 'ONCE' : 'RECURRING'}
            {task.displayId ? ` · ${task.displayId}` : ''}
          </Typography>
          <Typography sx={{ fontWeight: 500, fontSize: '0.8rem', color: bw.text, mb: 0.25 }}>
            {task.title}
          </Typography>
          <Typography sx={{
            fontSize: '0.62rem',
            color: bw.muted,
            fontFamily: "'JetBrains Mono', monospace",
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
            {task.scheduleType === 'once'
              ? (task.runAt ? new Date(task.runAt).toLocaleString() : '—')
              : task.nextRunAt
                ? `Next ${new Date(task.nextRunAt).toLocaleString()}`
                : task.status === 'paused'
                  ? 'Paused'
                  : task.lastRunAt
                    ? `Last run ${new Date(task.lastRunAt).toLocaleString()}`
                    : '—'}
          </Typography>
        </Box>
        {showCountdown && (
          <Box sx={{ textAlign: 'right', flexShrink: 0 }}>
            <Typography sx={{ fontSize: '0.5rem', color: bw.dim, letterSpacing: '0.08em', mb: 0.25 }}>
              NEXT
            </Typography>
            <CountdownDisplay targetIso={task.nextRunAt} active={showCountdown} />
          </Box>
        )}
        {running && <CircularProgress size={12} sx={{ color: bw.text, mt: 0.5 }} />}
      </Box>

      <Box sx={{ display: 'flex', gap: 0.25, mt: 1 }} onClick={(e) => e.stopPropagation()}>
        {task.status === 'active' && !running && (
          <>
            <Tooltip title="Run now">
              <span>
                <IconButton size="small" disabled={busy} onClick={onRun} sx={{ color: bw.text }}>
                  <PlayArrowIcon sx={{ fontSize: 15 }} />
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip title="Pause">
              <span>
                <IconButton size="small" disabled={busy} onClick={onPause} sx={{ color: bw.muted }}>
                  <PauseIcon sx={{ fontSize: 15 }} />
                </IconButton>
              </span>
            </Tooltip>
          </>
        )}
        {task.status === 'paused' && (
          <Tooltip title="Resume">
            <span>
              <IconButton size="small" disabled={busy} onClick={onResume} sx={{ color: bw.text }}>
                <PlayArrowIcon sx={{ fontSize: 15 }} />
              </IconButton>
            </span>
          </Tooltip>
        )}
        {canCancel && (
          <Tooltip title="Cancel">
            <span>
              <IconButton size="small" disabled={busy} onClick={onCancel} sx={{ color: bw.dim }}>
                <DeleteOutlineIcon sx={{ fontSize: 15 }} />
              </IconButton>
            </span>
          </Tooltip>
        )}
        {canDelete && (
          <Tooltip title="Delete">
            <span>
              <IconButton size="small" disabled={busy} onClick={onDelete} sx={{ color: bw.dim }}>
                <DeleteOutlineIcon sx={{ fontSize: 15 }} />
              </IconButton>
            </span>
          </Tooltip>
        )}
      </Box>
    </Box>
  );
}

export function AutomationPanel() {
  const pageVisible = usePageVisible();
  const [tasks, setTasks] = useState<AutomationTaskRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [runningIds, setRunningIds] = useState<Set<string>>(new Set());
  const [opsLog, setOpsLog] = useState<OpsLogEntry[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const logRef = useRef<HTMLDivElement>(null);
  const seenEventKeys = useRef<Set<string>>(new Set());
  const runningIdsRef = useRef<Set<string>>(new Set());

  const load = useCallback(async () => {
    try {
      const list = await automation.tasks();
      setTasks(list);
      setSelectedId((prev) => prev ?? list[0]?.id ?? null);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    if (!pageVisible) return;
    void load();
    const t = setInterval(() => { if (document.visibilityState === 'visible') void load(); }, 60_000);
    return () => clearInterval(t);
  }, [load, pageVisible]);

  const selectedTask = useMemo(
    () => tasks.find((t) => t.id === selectedId) ?? null,
    [tasks, selectedId],
  );

  const selectedRunning = selectedId ? runningIds.has(selectedId) : false;

  useEffect(() => {
    runningIdsRef.current = runningIds;
  }, [runningIds]);

  const loadLogs = useCallback(async (taskId: string) => {
    try {
      const logs = await automation.getLogs(taskId, { limit: 80 });
      setOpsLog(logs.map((entry) => ({
        id: entry.id,
        ts: new Date(entry.ts).getTime(),
        level: entry.level,
        label: entry.label,
        detail: entry.detail ?? undefined,
      })));
    } catch {
      setOpsLog([]);
    }
  }, []);

  useEffect(() => {
    if (!selectedId) {
      setOpsLog([]);
      return;
    }
    seenEventKeys.current.clear();
    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (!cancelled) void loadLogs(selectedId);
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [selectedId, loadLogs]);

  useEffect(() => {
    if (!selectedId || !selectedRunning || !pageVisible) return;
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') void loadLogs(selectedId);
    }, 2500);
    return () => clearInterval(t);
  }, [selectedId, selectedRunning, loadLogs, pageVisible]);

  useEffect(() => {
    if (!selectedId) return;
    const disconnect = subscribeOptimizedTelemetry((ev) => {
      if (!eventBelongsToTask(ev, selectedId)) return;
      const key = `${ev.type}-${JSON.stringify(ev).slice(0, 120)}`;
      if (seenEventKeys.current.has(key)) return;
      seenEventKeys.current.add(key);

      if (ev.type === 'automation_run_triggered' || ev.type === 'automation_run_started') {
        const tid = (ev as { taskId?: string }).taskId;
        if (tid) {
          runningIdsRef.current = new Set(runningIdsRef.current).add(tid);
          setRunningIds(runningIdsRef.current);
          if (tid === selectedId) {
            seenEventKeys.current.clear();
            setOpsLog([]);
          }
        }
      }
      if (ev.type === 'automation_run_ended') {
        const tid = (ev as { taskId?: string }).taskId;
        if (tid) {
          const next = new Set(runningIdsRef.current);
          next.delete(tid);
          runningIdsRef.current = next;
          setRunningIds(next);
          void load();
          if (selectedId === tid) void loadLogs(tid);
        }
      }

      const isAutomationSysEvent = ev.type === 'automation_run_triggered'
        || ev.type === 'automation_run_preparing'
        || ev.type === 'automation_run_started'
        || ev.type === 'automation_run_ended';
      const taskRunning = selectedId ? runningIdsRef.current.has(selectedId) : false;
      if (!taskRunning && !isAutomationSysEvent) return;

      const entry = telemetryToLogEntry(ev);
      if (entry) {
        setOpsLog((prev) => {
          if (prev.some((e) => e.id === entry.id)) return prev;
          return [...prev.slice(-199), entry];
        });
      }
    });
    return disconnect;
  }, [selectedId, load, loadLogs]);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [opsLog]);

  const handleAction = async (taskId: string, action: 'pause' | 'resume' | 'run' | 'cancel' | 'delete') => {
    setBusyId(taskId);
    try {
      if (action === 'pause') await automation.pauseTask(taskId);
      else if (action === 'resume') await automation.resumeTask(taskId);
      else if (action === 'run') await automation.runNow(taskId);
      else if (action === 'delete') await automation.deleteTask(taskId);
      else await automation.cancelTask(taskId);
      await load();
      if ((action === 'cancel' || action === 'delete') && selectedId === taskId) setSelectedId(null);
    } catch { /* ignore */ }
    finally { setBusyId(null); }
  };

  const activeCount = tasks.filter((t) => t.status === 'active').length;

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden', bgcolor: bw.bg, color: bw.text }}>
      <PanelHeader
        title="Automation"
        subtitle="Scheduled agent tasks"
        icon={<ScheduleIcon sx={{ fontSize: 20, color: bw.text }} />}
        action={
          <Button
            size="small"
            startIcon={<RefreshIcon sx={{ fontSize: 14 }} />}
            onClick={() => { void load(); }}
            sx={{ color: bw.muted, fontSize: '0.65rem', border: `1px solid ${bw.border}`, '&:hover': { bgcolor: bw.card, borderColor: bw.borderStrong } }}
          >
            Refresh
          </Button>
        }
      />

      <Box sx={{
        px: 2, py: 0.75,
        borderBottom: `1px solid ${bw.border}`,
        display: 'flex', gap: 2,
        bgcolor: bw.panel,
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: '0.58rem',
        color: bw.dim,
        letterSpacing: '0.08em',
      }}>
        <span>{activeCount} active</span>
        <span>{runningIds.size} running</span>
      </Box>

      <Box sx={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <Box sx={{
          width: 320,
          minWidth: 280,
          borderRight: `1px solid ${bw.border}`,
          overflow: 'auto',
          p: 1.25,
          bgcolor: bw.panel,
        }}>
          {loading && tasks.length === 0 && (
            <Typography sx={{ color: bw.dim, fontSize: '0.72rem', textAlign: 'center', mt: 4 }}>
              Loading…
            </Typography>
          )}

          {!loading && tasks.length === 0 && (
            <Box sx={{ textAlign: 'center', mt: 4, px: 1 }}>
              <Typography sx={{ color: bw.muted, fontSize: '0.72rem', mb: 0.5 }}>
                No automations
              </Typography>
              <Typography sx={{ color: bw.dim, fontSize: '0.62rem', lineHeight: 1.5 }}>
                Ask the agent to schedule a reminder or recurring task in chat.
              </Typography>
            </Box>
          )}

          {tasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              selected={task.id === selectedId}
              running={runningIds.has(task.id)}
              onSelect={() => setSelectedId(task.id)}
              onPause={() => { void handleAction(task.id, 'pause'); }}
              onResume={() => { void handleAction(task.id, 'resume'); }}
              onRun={() => { void handleAction(task.id, 'run'); }}
              onCancel={() => { void handleAction(task.id, 'cancel'); }}
              onDelete={() => { void handleAction(task.id, 'delete'); }}
              busy={busyId === task.id}
            />
          ))}
        </Box>

        <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <Box sx={{
            px: 2, py: 0.75,
            borderBottom: `1px solid ${bw.border}`,
            bgcolor: bw.panel,
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: '0.58rem',
            color: bw.dim,
            letterSpacing: '0.06em',
          }}>
            {selectedTask ? (
              <>
                {selectedTask.title}
                {selectedTask.displayId ? ` · ${selectedTask.displayId}` : ''}
                {selectedRunning ? ' · live' : ''}
              </>
            ) : 'Select a task'}
          </Box>

          {!selectedTask && (
            <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Typography sx={{ color: bw.dim, fontSize: '0.72rem', fontFamily: "'JetBrains Mono', monospace" }}>
                Select a task to view its log
              </Typography>
            </Box>
          )}

          {selectedTask && (
            <>
              <Box sx={{ px: 2, py: 1, borderBottom: `1px solid ${bw.border}`, bgcolor: bw.bg }}>
                <Typography sx={{ fontSize: '0.62rem', color: bw.muted, lineHeight: 1.5, fontFamily: "'JetBrains Mono', monospace" }}>
                  {selectedTask.instruction}
                </Typography>
              </Box>
              <Box
                ref={logRef}
                sx={{
                  flex: 1,
                  overflow: 'auto',
                  p: 1.5,
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: '0.62rem',
                  bgcolor: bw.bg,
                  color: bw.muted,
                }}
              >
                {opsLog.length === 0 && (
                  <Typography sx={{ color: bw.dim, fontSize: '0.62rem' }}>
                    {selectedRunning ? 'Waiting for output…' : 'No log entries yet.'}
                  </Typography>
                )}
                {opsLog.map((entry) => (
                  <Box key={entry.id} sx={{ mb: 0.6, lineHeight: 1.45 }}>
                    <Box component="span" sx={{ color: bw.dim, mr: 1 }}>
                      {new Date(entry.ts).toLocaleTimeString()}
                    </Box>
                    <Box component="span" sx={{ color: bw.text, mr: 1 }}>
                      {entry.label}
                    </Box>
                    {entry.detail && (
                      <Box component="span" sx={{ color: bw.muted, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                        {entry.detail}
                      </Box>
                    )}
                  </Box>
                ))}
              </Box>
            </>
          )}
        </Box>
      </Box>
    </Box>
  );
}
