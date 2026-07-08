import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Chip from '@mui/material/Chip';
import Tooltip from '@mui/material/Tooltip';
import { PanelHeader } from './PanelHeader';
import { ragStudio, type IngestionJob, type IngestStreamEvent } from '../api';
import { colors, alphaColor } from '../theme';

import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import LinkIcon from '@mui/icons-material/Link';
import RefreshIcon from '@mui/icons-material/Refresh';
import StorageIcon from '@mui/icons-material/Storage';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import PendingIcon from '@mui/icons-material/Pending';
import BoltIcon from '@mui/icons-material/Bolt';
import RadarIcon from '@mui/icons-material/Radar';
import SpeedIcon from '@mui/icons-material/Speed';
import TimerIcon from '@mui/icons-material/Timer';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import TerminalIcon from '@mui/icons-material/Terminal';

// ─── Pipeline stage model ───
// Maps the DocumentIngester's fine-grained stages onto a 5-node tactical pipeline.
interface PipelineStage {
  key: string;
  label: string;
  code: string;
  matches: string[]; // ingester stage names that belong to this pipeline node
}

const PIPELINE: PipelineStage[] = [
  { key: 'parse', label: 'PARSE', code: '01', matches: ['parsing'] },
  { key: 'chunk', label: 'CHUNK', code: '02', matches: ['chunking', 'chunked'] },
  { key: 'embed', label: 'EMBED', code: '03', matches: ['embedding'] },
  { key: 'extract', label: 'EXTRACT', code: '04', matches: ['extracting'] },
  { key: 'store', label: 'STORE', code: '05', matches: ['source_created', 'storing', 'complete'] },
];

function stageToPipelineKey(stage: string): string | null {
  for (const p of PIPELINE) {
    if (p.matches.includes(stage)) return p.key;
  }
  return null;
}

// ─── Tracked job (UI state) ───

interface LogEntry {
  ts: number;
  stage: string;
  detail: string;
  level: 'info' | 'ok' | 'warn' | 'err';
}

interface TelemetrySample {
  ts: number;
  chunkIndex: number;
  progress: number;
}

interface TrackedJob {
  jobId: string;
  name: string;
  kind: string;
  status: 'pending' | 'running' | 'done' | 'failed' | 'cancelled';
  progress: number;
  stage: string;
  detail?: string;
  chunkIndex?: number;
  chunkCount?: number;
  batchIndex?: number;
  batchCount?: number;
  totalInputTokens?: number;
  totalOutputTokens?: number;
  error?: string;
  createdAt: number;
  updatedAt: number;
  // Accumulated UI state
  log: LogEntry[];
  samples: TelemetrySample[];
  startedAt?: number;
  completedAt?: number;
}

const ACCEPTED_EXTS = '.pdf,.txt,.md,.markdown,.json,.html,.htm';

const KIND_COLOR: Record<string, string> = {
  pdf: colors.accent.red,
  text: colors.accent.blue,
  markdown: colors.accent.orange,
  json: colors.accent.green,
  web: colors.accent.purple,
};

// ─── Main Panel ───

export function RagStudioPanel() {
  const [jobs, setJobs] = useState<TrackedJob[]>([]);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [urlInput, setUrlInput] = useState('');
  const [textInput, setTextInput] = useState('');
  const [textName, setTextName] = useState('');
  const [showTextInput, setShowTextInput] = useState(false);
  const [clock, setClock] = useState(Date.now());
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragCounter = useRef(0);
  const streamClosers = useRef(new Map<string, () => void>());

  // 1Hz clock to drive ETA / elapsed readouts
  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') setClock(Date.now());
    }, 1000);
    return () => clearInterval(t);
  }, []);

  // Apply an incoming stream event to a job, accumulating log + telemetry
  const applyEvent = useCallback((jobId: string, data: IngestStreamEvent) => {
    setJobs((prev) => prev.map((j) => {
      if (j.jobId !== jobId) return j;
      const now = Date.now();
      const isTerminal = data.status === 'done' || data.status === 'failed' || data.status === 'cancelled';
      const level: LogEntry['level'] = data.status === 'failed' ? 'err' : data.status === 'done' ? 'ok' : data.stage === 'error' ? 'err' : 'info';
      const entry: LogEntry | null = data.detail
        ? { ts: now, stage: data.stage, detail: data.detail, level }
        : null;
      const sample: TelemetrySample | null = data.chunkIndex != null
        ? { ts: now, chunkIndex: data.chunkIndex, progress: data.progress }
        : null;
      const startedAt = j.startedAt ?? (data.status === 'running' || data.progress > 0 ? now : undefined);
      return {
        ...j,
        status: data.status as TrackedJob['status'],
        progress: data.progress,
        stage: data.stage,
        detail: data.detail,
        chunkIndex: data.chunkIndex ?? j.chunkIndex,
        chunkCount: data.chunkCount ?? j.chunkCount,
        batchIndex: data.batchIndex ?? j.batchIndex,
        batchCount: data.batchCount ?? j.batchCount,
        totalInputTokens: data.totalInputTokens ?? j.totalInputTokens,
        totalOutputTokens: data.totalOutputTokens ?? j.totalOutputTokens,
        error: data.error ?? j.error,
        updatedAt: now,
        startedAt,
        completedAt: isTerminal ? now : j.completedAt,
        log: entry ? [...j.log.slice(-199), entry] : j.log,
        samples: sample ? [...j.samples.slice(-99), sample] : j.samples,
      };
    }));
    if (data.status === 'done' || data.status === 'failed' || data.status === 'cancelled') {
      const close = streamClosers.current.get(jobId);
      if (close) { close(); streamClosers.current.delete(jobId); }
      // Notify other panels to refresh their graph data.
      window.dispatchEvent(new CustomEvent('ragstudio:job-complete'));
    }
  }, []);

  // Stream a job's progress via SSE
  const streamJob = useCallback((jobId: string) => {
    if (streamClosers.current.has(jobId)) return;
    const close = ragStudio.streamJob(jobId, (data) => applyEvent(jobId, data));
    streamClosers.current.set(jobId, close);
  }, [applyEvent]);

  // Load historical events for a job and populate its log (used when a job is
  // selected or when loadJobs discovers an already-running job).
  const loadJobEvents = useCallback(async (jobId: string) => {
    try {
      const result = await ragStudio.jobEvents(jobId);
      const events = result.events ?? [];
      if (events.length === 0) return;
      setJobs((prev) => prev.map((j) => {
        if (j.jobId !== jobId) return j;
        // Rebuild log + samples from the historical events.
        const log: LogEntry[] = events
          .filter((e) => e.detail)
          .map((e) => ({
            ts: e.updatedAt ? new Date(e.updatedAt).getTime() : Date.now(),
            stage: e.stage,
            detail: e.detail!,
            level: e.status === 'failed' ? 'err' : e.status === 'done' ? 'ok' : e.stage === 'error' ? 'err' : 'info',
          }));
        const samples: TelemetrySample[] = events
          .filter((e) => e.chunkIndex != null)
          .map((e) => ({
            ts: e.updatedAt ? new Date(e.updatedAt).getTime() : Date.now(),
            chunkIndex: e.chunkIndex!,
            progress: e.progress,
          }));
        const last = events[events.length - 1]!;
        return {
          ...j,
          progress: last.progress,
          stage: last.stage,
          detail: last.detail,
          chunkIndex: last.chunkIndex ?? j.chunkIndex,
          chunkCount: last.chunkCount ?? j.chunkCount,
          batchIndex: last.batchIndex ?? j.batchIndex,
          batchCount: last.batchCount ?? j.batchCount,
          totalInputTokens: last.totalInputTokens ?? j.totalInputTokens,
          totalOutputTokens: last.totalOutputTokens ?? j.totalOutputTokens,
          log: log.slice(-200),
          samples: samples.slice(-100),
        };
      }));
    } catch { /* ignore */ }
  }, []);

  // Load existing jobs on mount
  const loadJobs = useCallback(async () => {
    try {
      const result = await ragStudio.jobs(50);
      const mapped: TrackedJob[] = (result.jobs ?? []).map((j: IngestionJob) => {
        const payload = j.payload as { name?: string; kind?: string } | undefined;
        const detail = j.stageDetail;
        const isTerminal = j.status === 'done' || j.status === 'failed' || j.status === 'cancelled';
        return {
          jobId: j.id,
          name: payload?.name ?? 'unknown',
          kind: payload?.kind ?? 'text',
          status: j.status,
          progress: j.progress,
          stage: detail?.stage ?? (j.status === 'done' ? 'complete' : j.status === 'failed' ? 'error' : 'pending'),
          detail: detail?.detail,
          chunkIndex: detail?.chunkIndex,
          chunkCount: detail?.chunkCount,
          batchIndex: detail?.batchIndex,
          batchCount: detail?.batchCount,
          error: j.error,
          createdAt: new Date(j.createdAt).getTime(),
          updatedAt: new Date(j.updatedAt).getTime(),
          log: [],
          samples: [],
          completedAt: isTerminal ? new Date(j.updatedAt).getTime() : undefined,
        };
      });
      setJobs(mapped);
      // Re-stream any still-active jobs and load their historical events
      for (const j of mapped) {
        if (j.status === 'pending' || j.status === 'running') {
          if (!streamClosers.current.has(j.jobId)) streamJob(j.jobId);
          void loadJobEvents(j.jobId);
        } else {
          // For completed jobs, load events so the log is populated on click.
          void loadJobEvents(j.jobId);
        }
      }
    } catch { /* ignore */ }
  }, [loadJobEvents, streamJob]);

  useEffect(() => { loadJobs(); }, [loadJobs]);

  // When a job is selected, load its historical events to populate the log.
  const handleSelectJob = useCallback((jobId: string) => {
    setSelectedJobId(jobId);
    void loadJobEvents(jobId);
  }, [loadJobEvents]);

  // Cancel a running/pending job.
  const handleCancelJob = useCallback(async (jobId: string) => {
    try {
      await ragStudio.cancelJob(jobId);
      // Update UI immediately — the SSE stream will confirm the transition.
      setJobs((prev) => prev.map((j) => j.jobId === jobId ? { ...j, status: 'cancelled' as const, completedAt: Date.now() } : j));
      // Close the SSE stream for this job.
      const close = streamClosers.current.get(jobId);
      if (close) { close(); streamClosers.current.delete(jobId); }
    } catch { /* ignore */ }
  }, []);

  // Delete a job and remove it from the list.
  const handleDeleteJob = useCallback(async (jobId: string) => {
    try {
      await ragStudio.deleteJob(jobId);
      // Close the SSE stream if open.
      const close = streamClosers.current.get(jobId);
      if (close) { close(); streamClosers.current.delete(jobId); }
      // Remove from the list and deselect if it was selected.
      setJobs((prev) => prev.filter((j) => j.jobId !== jobId));
      setSelectedJobId((prev) => prev === jobId ? null : prev);
    } catch { /* ignore */ }
  }, []);

  // Cleanup all streams on unmount
  useEffect(() => {
    return () => {
      for (const close of streamClosers.current.values()) close();
      streamClosers.current.clear();
    };
  }, []);

  // Handle file drop/selection
  const handleFiles = useCallback(async (files: FileList | File[]) => {
    const fileArray = Array.from(files);
    for (const file of fileArray) {
      try {
        const result = await ragStudio.ingestFile(file);
        const newJob: TrackedJob = {
          jobId: result.jobId, name: result.name, kind: result.kind,
          status: 'pending', progress: 0, stage: 'queued',
          createdAt: Date.now(), updatedAt: Date.now(), log: [], samples: [],
        };
        setJobs((prev) => [newJob, ...prev]);
        setSelectedJobId(result.jobId);
        streamJob(result.jobId);
      } catch { /* ignore — best effort */ }
    }
  }, [streamJob]);

  // Handle URL ingestion
  const handleIngestUrl = useCallback(async () => {
    if (!urlInput.trim()) return;
    try {
      const result = await ragStudio.ingestUrl(urlInput.trim());
      const newJob: TrackedJob = {
        jobId: result.jobId, name: result.name, kind: result.kind,
        status: 'pending', progress: 0, stage: 'queued',
        createdAt: Date.now(), updatedAt: Date.now(), log: [], samples: [],
      };
      setJobs((prev) => [newJob, ...prev]);
      setUrlInput('');
      setSelectedJobId(result.jobId);
      streamJob(result.jobId);
    } catch { /* ignore */ }
  }, [urlInput, streamJob]);

  // Handle text ingestion
  const handleIngestText = useCallback(async () => {
    if (!textInput.trim()) return;
    try {
      const name = textName.trim() || `text-${Date.now()}`;
      const result = await ragStudio.ingestText(textInput, name, 'text');
      const newJob: TrackedJob = {
        jobId: result.jobId, name: result.name, kind: result.kind,
        status: 'pending', progress: 0, stage: 'queued',
        createdAt: Date.now(), updatedAt: Date.now(), log: [], samples: [],
      };
      setJobs((prev) => [newJob, ...prev]);
      setTextInput(''); setTextName(''); setShowTextInput(false);
      setSelectedJobId(result.jobId);
      streamJob(result.jobId);
    } catch { /* ignore */ }
  }, [textInput, textName, streamJob]);

  // Drag-drop handlers
  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation(); dragCounter.current++; setDragOver(true);
  }, []);
  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation(); dragCounter.current--;
    if (dragCounter.current === 0) setDragOver(false);
  }, []);
  const handleDragOver = useCallback((e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); }, []);
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation(); dragCounter.current = 0; setDragOver(false);
    if (e.dataTransfer.files?.length > 0) void handleFiles(e.dataTransfer.files);
  }, [handleFiles]);

  const selectedJob = useMemo(() => jobs.find((j) => j.jobId === selectedJobId) ?? null, [jobs, selectedJobId]);
  const activeCount = jobs.filter((j) => j.status === 'pending' || j.status === 'running').length;

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <PanelHeader
        title="RAG STUDIO"
        subtitle="DOCUMENT INGESTION // NEURAL BRAIN"
        icon={<RadarIcon sx={{ fontSize: 20 }} />}
        action={
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            {activeCount > 0 && (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, px: 1, py: 0.25, border: `1px solid ${alphaColor(colors.accent.blue, '40')}`, borderRadius: 0.5, bgcolor: alphaColor(colors.accent.blue, '08') }}>
                <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: colors.accent.blue, animation: 'ragPulse 1s ease-in-out infinite' }} />
                <Typography sx={{ fontSize: '0.6rem', color: colors.accent.blue, fontFamily: "'JetBrains Mono', monospace", letterSpacing: 1 }}>
                  {activeCount} ACTIVE
                </Typography>
              </Box>
            )}
            <Tooltip title="Refresh job list">
              <IconButton size="small" onClick={loadJobs} sx={{ color: colors.text.dim }}>
                <RefreshIcon sx={{ fontSize: 16 }} />
              </IconButton>
            </Tooltip>
          </Box>
        }
      />

      <Box
        sx={{ flex: 1, overflow: 'auto', p: 2.5 }}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        {/* ─── Tactical Drop Zone ─── */}
        <TacticalDropZone
          dragOver={dragOver}
          onClick={() => fileInputRef.current?.click()}
        />
        <input
          ref={fileInputRef}
          type="file"
          hidden
          multiple
          accept={ACCEPTED_EXTS}
          onChange={(e) => { if (e.target.files) handleFiles(e.target.files); e.target.value = ''; }}
        />

        {/* ─── URL + Text Input Row ─── */}
        <Box sx={{ display: 'flex', gap: 1, mt: 1.5, alignItems: 'flex-start' }}>
          <TextField
            size="small"
            placeholder="https://example.com/article"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleIngestUrl(); }}
            sx={{
              flex: 1,
              '& .MuiOutlinedInput-root': {
                fontSize: '0.72rem', color: colors.text.secondary, bgcolor: colors.bg.tertiary,
                fontFamily: "'JetBrains Mono', monospace",
                '& fieldset': { borderColor: colors.border.default },
                '&:hover fieldset': { borderColor: colors.border.strong },
              },
            }}
          />
          <Button
            size="small"
            startIcon={<LinkIcon sx={{ fontSize: 14 }} />}
            onClick={handleIngestUrl}
            disabled={!urlInput.trim()}
            sx={{ color: colors.accent.green, fontSize: '0.6rem', textTransform: 'none', borderColor: colors.border.strong, '&:hover': { borderColor: colors.accent.green } }}
            variant="outlined"
          >
            INGEST URL
          </Button>
          <Button
            size="small"
            onClick={() => setShowTextInput((v) => !v)}
            sx={{ color: colors.accent.purple, fontSize: '0.6rem', textTransform: 'none' }}
            variant="text"
          >
            {showTextInput ? 'CANCEL' : 'PASTE TEXT'}
          </Button>
        </Box>

        {showTextInput && (
          <Box sx={{ mt: 1.5, p: 1.5, border: `1px solid ${colors.border.default}`, borderRadius: 0.5, bgcolor: colors.bg.tertiary }}>
            <TextField
              size="small"
              placeholder="Document name (optional)"
              value={textName}
              onChange={(e) => setTextName(e.target.value)}
              sx={{ mb: 1, width: '100%', '& .MuiOutlinedInput-root': { fontSize: '0.68rem', color: colors.text.secondary, bgcolor: colors.bg.surface, fontFamily: "'JetBrains Mono', monospace", '& fieldset': { borderColor: colors.border.default } } }}
            />
            <TextField
              multiline
              minRows={4}
              maxRows={8}
              placeholder="Paste text content to ingest…"
              value={textInput}
              onChange={(e) => setTextInput(e.target.value)}
              sx={{ width: '100%', '& .MuiOutlinedInput-root': { fontSize: '0.72rem', color: colors.text.secondary, bgcolor: colors.bg.surface, fontFamily: "'JetBrains Mono', monospace", '& fieldset': { borderColor: colors.border.default } } }}
            />
            <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 1 }}>
              <Button size="small" variant="contained" onClick={handleIngestText} disabled={!textInput.trim()}
                sx={{ bgcolor: colors.accent.blue, fontSize: '0.6rem', textTransform: 'none', fontFamily: "'JetBrains Mono', monospace", '&:hover': { bgcolor: alphaColor(colors.accent.blue, 'cc') } }}>
                INGEST TEXT
              </Button>
            </Box>
          </Box>
        )}

        {/* ─── Ingestion Monitor (selected job) ─── */}
        {selectedJob && (
          <Box sx={{ mt: 2.5 }}>
            <IngestionMonitor
              job={selectedJob}
              clock={clock}
              onClose={() => setSelectedJobId(null)}
              onCancel={() => handleCancelJob(selectedJob.jobId)}
              onDelete={() => handleDeleteJob(selectedJob.jobId)}
            />
          </Box>
        )}

        {/* ─── Job Queue ─── */}
        <Box sx={{ mt: 2.5 }}>
          <SectionHeader label="INGESTION QUEUE" count={jobs.length} />
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
            {jobs.length === 0 && (
              <Box sx={{ textAlign: 'center', py: 3, border: `1px dashed ${colors.border.subtle}`, borderRadius: 0.5 }}>
                <StorageIcon sx={{ fontSize: 28, color: colors.text.dim, mb: 0.5, opacity: 0.4 }} />
                <Typography sx={{ fontSize: '0.65rem', color: colors.text.dim, fontFamily: "'JetBrains Mono', monospace", letterSpacing: 1 }}>
                  NO JOBS // AWAITING INPUT
                </Typography>
              </Box>
            )}
            {jobs.map((job) => (
              <JobRow
                key={job.jobId}
                job={job}
                selected={job.jobId === selectedJobId}
                onSelect={() => handleSelectJob(job.jobId)}
                onCancel={() => handleCancelJob(job.jobId)}
                onDelete={() => handleDeleteJob(job.jobId)}
              />
            ))}
          </Box>
        </Box>
      </Box>

      {/* Keyframes */}
      <style>{`
        @keyframes ragPulse { 0%,100% { opacity: 1; } 50% { opacity: 0.35; } }
        @keyframes ragScan { 0% { transform: translateY(-100%); } 100% { transform: translateY(400%); } }
        @keyframes ragBlink { 0%,49% { opacity: 1; } 50%,100% { opacity: 0.2; } }
        @keyframes ragMarch { to { background-position: 16px 0; } }
      `}</style>
    </Box>
  );
}

// ─── Tactical Drop Zone ───

function TacticalDropZone({ dragOver, onClick }: { dragOver: boolean; onClick: () => void }) {
  const accent = dragOver ? colors.accent.blue : colors.border.strong;
  return (
    <Box
      onClick={onClick}
      sx={{
        position: 'relative',
        border: `1px solid ${accent}`,
        borderRadius: 0.5,
        p: 3,
        textAlign: 'center',
        cursor: 'pointer',
        transition: 'all 0.2s ease',
        bgcolor: dragOver ? alphaColor(colors.accent.blue, '08') : colors.bg.tertiary,
        overflow: 'hidden',
        '&:hover': { borderColor: alphaColor(colors.accent.blue, '80'), bgcolor: alphaColor(colors.accent.blue, '04') },
      }}
    >
      {/* Corner brackets */}
      <Bracket position="top-left" color={accent} />
      <Bracket position="top-right" color={accent} />
      <Bracket position="bottom-left" color={accent} />
      <Bracket position="bottom-right" color={accent} />

      {/* Scan line on drag */}
      {dragOver && (
        <Box sx={{
          position: 'absolute', left: 0, right: 0, top: 0, height: '40%',
          background: `linear-gradient(180deg, ${alphaColor(colors.accent.blue, '15')}, transparent)`,
          animation: 'ragScan 1.4s linear infinite', pointerEvents: 'none',
        }} />
      )}

      <CloudUploadIcon sx={{
        fontSize: 36, color: dragOver ? colors.accent.blue : colors.text.dim, mb: 1,
        transition: 'color 0.2s', ...(dragOver ? { animation: 'ragPulse 1.2s ease-in-out infinite' } : {}),
      }} />
      <Typography sx={{ fontSize: '0.78rem', color: dragOver ? colors.accent.blue : colors.text.secondary, fontFamily: "'JetBrains Mono', monospace", letterSpacing: 2, mb: 0.5, fontWeight: 600 }}>
        {dragOver ? 'RELEASE TO INGEST' : 'DROP DOCUMENTS // CLICK TO SELECT'}
      </Typography>
      <Typography sx={{ fontSize: '0.6rem', color: colors.text.dim, fontFamily: "'JetBrains Mono', monospace", letterSpacing: 1 }}>
        PDF · TXT · MD · JSON · HTML — MAX 50MB
      </Typography>
    </Box>
  );
}

function Bracket({ position, color }: { position: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'; color: string }) {
  const sz = 10;
  const common: React.CSSProperties = { position: 'absolute', width: sz, height: sz, borderColor: color, pointerEvents: 'none' };
  const map: Record<string, React.CSSProperties> = {
    'top-left': { top: -1, left: -1, borderTop: `2px solid ${color}`, borderLeft: `2px solid ${color}` },
    'top-right': { top: -1, right: -1, borderTop: `2px solid ${color}`, borderRight: `2px solid ${color}` },
    'bottom-left': { bottom: -1, left: -1, borderBottom: `2px solid ${color}`, borderLeft: `2px solid ${color}` },
    'bottom-right': { bottom: -1, right: -1, borderBottom: `2px solid ${color}`, borderRight: `2px solid ${color}` },
  };
  return <Box sx={{ ...common, ...map[position] }} />;
}

// ─── Section Header ───

function SectionHeader({ label, count }: { label: string; count?: number }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
      <Box sx={{ width: 3, height: 12, bgcolor: colors.accent.blue }} />
      <Typography sx={{ fontSize: '0.65rem', color: colors.text.secondary, fontFamily: "'JetBrains Mono', monospace", letterSpacing: 2, fontWeight: 600 }}>
        {label}
      </Typography>
      {count != null && (
        <Typography sx={{ fontSize: '0.6rem', color: colors.text.dim, fontFamily: "'JetBrains Mono', monospace" }}>
          [{String(count).padStart(2, '0')}]
        </Typography>
      )}
      <Box sx={{ flex: 1, height: 1, background: `repeating-linear-gradient(90deg, ${colors.border.subtle} 0 8px, transparent 8px 16px)` }} />
    </Box>
  );
}

// ─── Ingestion Monitor (the big spy panel for the selected job) ───

function IngestionMonitor({ job, clock, onClose, onCancel, onDelete }: { job: TrackedJob; clock: number; onClose: () => void; onCancel: () => void; onDelete: () => void }) {
  const isActive = job.status === 'pending' || job.status === 'running';
  const isDone = job.status === 'done';
  const isFailed = job.status === 'failed';
  const isCancelled = job.status === 'cancelled';
  const statusColor = isDone ? colors.accent.green : isFailed ? colors.accent.red : isCancelled ? colors.text.dim : isActive ? colors.accent.blue : colors.text.dim;
  const currentPipelineKey = stageToPipelineKey(job.stage);

  // Telemetry
  const telemetry = useMemo(() => computeTelemetry(job, clock), [job, clock]);

  // Token usage
  const totalTokens = (job.totalInputTokens ?? 0) + (job.totalOutputTokens ?? 0);
  const fmtTokens = (n: number): string => {
    if (n === 0) return '—';
    if (n < 1000) return n.toString();
    if (n < 1000000) return `${(n / 1000).toFixed(1)}K`;
    return `${(n / 1000000).toFixed(2)}M`;
  };

  return (
    <Box sx={{
      position: 'relative',
      border: `1px solid ${alphaColor(statusColor, '40')}`,
      borderRadius: 0.5,
      bgcolor: colors.bg.secondary,
      overflow: 'hidden',
    }}>
      {/* Corner brackets */}
      <Bracket position="top-left" color={statusColor} />
      <Bracket position="top-right" color={statusColor} />
      <Bracket position="bottom-left" color={statusColor} />
      <Bracket position="bottom-right" color={statusColor} />

      {/* Header bar */}
      <Box sx={{
        display: 'flex', alignItems: 'center', gap: 1, px: 1.5, py: 1,
        borderBottom: `1px solid ${colors.border.default}`,
        bgcolor: colors.bg.tertiary,
      }}>
        <Box sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: statusColor, ...(isActive ? { animation: 'ragPulse 1s ease-in-out infinite' } : {}) }} />
        <Typography sx={{ fontSize: '0.7rem', color: colors.text.primary, fontFamily: "'JetBrains Mono', monospace", fontWeight: 600, letterSpacing: 1, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {job.name}
        </Typography>
        <Chip
          size="small"
          label={job.kind.toUpperCase()}
          sx={{ fontSize: '0.5rem', height: 16, fontFamily: "'JetBrains Mono', monospace", color: KIND_COLOR[job.kind] ?? colors.text.dim, bgcolor: alphaColor((KIND_COLOR[job.kind] ?? colors.text.dim), '15'), border: `1px solid ${alphaColor((KIND_COLOR[job.kind] ?? colors.text.dim), '30')}` }}
        />
        <Chip
          size="small"
          label={job.status.toUpperCase()}
          sx={{ fontSize: '0.5rem', height: 16, fontFamily: "'JetBrains Mono', monospace", color: statusColor, bgcolor: alphaColor(statusColor, '15'), border: `1px solid ${alphaColor(statusColor, '30')}` }}
        />
        {isActive && (
          <Tooltip title="Cancel job">
            <IconButton size="small" onClick={onCancel} sx={{ color: colors.accent.red, p: 0.25 }}>
              <Box sx={{ fontSize: '0.6rem', lineHeight: 1, fontFamily: "'JetBrains Mono', monospace" }}>■</Box>
            </IconButton>
          </Tooltip>
        )}
        {!isActive && (
          <Tooltip title="Delete job">
            <IconButton size="small" onClick={onDelete} sx={{ color: colors.accent.red, p: 0.25 }}>
              <Box sx={{ fontSize: '0.7rem', lineHeight: 1 }}>×</Box>
            </IconButton>
          </Tooltip>
        )}
        <Tooltip title="Close monitor">
          <IconButton size="small" onClick={onClose} sx={{ color: colors.text.dim, p: 0.25 }}>
            <Box sx={{ fontSize: '0.7rem', lineHeight: 1 }}>↗</Box>
          </IconButton>
        </Tooltip>
      </Box>

      <Box sx={{ p: 1.5 }}>
        {/* ─── Stage Pipeline Tracker ─── */}
        <StagePipeline job={job} currentKey={currentPipelineKey} statusColor={statusColor} />

        {/* ─── Progress + chunk counter ─── */}
        <Box sx={{ mt: 1.5 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
            <Typography sx={{ fontSize: '0.6rem', color: colors.text.dim, fontFamily: "'JetBrains Mono', monospace", letterSpacing: 1 }}>
              {job.chunkCount
                ? job.batchCount
                  ? `CHUNK ${job.chunkIndex ?? 0}/${job.chunkCount} · BATCH ${job.batchIndex ?? 0}/${job.batchCount}`
                  : `CHUNK ${job.chunkIndex ?? 0}/${job.chunkCount}`
                : 'PROGRESS'}
            </Typography>
            <Typography sx={{ fontSize: '0.6rem', color: statusColor, fontFamily: "'JetBrains Mono', monospace", fontWeight: 600 }}>
              {job.progress}%
            </Typography>
          </Box>
          <Box sx={{
            height: 6, borderRadius: 1, bgcolor: colors.border.subtle, overflow: 'hidden',
            position: 'relative',
            border: `1px solid ${colors.border.default}`,
          }}>
            <Box sx={{
              height: '100%', width: `${job.progress}%`, bgcolor: statusColor,
              transition: 'width 0.4s ease',
              ...(isActive ? {
                backgroundImage: `repeating-linear-gradient(45deg, ${statusColor} 0 8px, ${alphaColor(statusColor, 'cc')} 8px 16px)`,
                backgroundSize: '16px 16px',
                animation: 'ragMarch 0.6s linear infinite',
              } : {}),
            }} />
          </Box>
        </Box>

        {/* ─── Telemetry Gauges ─── */}
        <Box sx={{ display: 'flex', gap: 1, mt: 1.5 }}>
          <Gauge icon={<SpeedIcon sx={{ fontSize: 13 }} />} label="THROUGHPUT" value={telemetry.throughput} unit="chk/min" color={colors.accent.blue} />
          <Gauge icon={<BoltIcon sx={{ fontSize: 13 }} />} label="STAGE LAT" value={telemetry.stageLatency} unit="ms" color={colors.accent.orange} />
          <Gauge icon={<TrendingUpIcon sx={{ fontSize: 13 }} />} label="EXTRACT" value={telemetry.extractRate} unit="ent/min" color={colors.accent.purple} />
          <Gauge icon={<TimerIcon sx={{ fontSize: 13 }} />} label="ETA" value={telemetry.eta} unit="" color={colors.accent.green} />
        </Box>

        {/* ─── Token Usage Gauges ─── */}
        <Box sx={{ display: 'flex', gap: 1, mt: 1 }}>
          <Gauge icon={<BoltIcon sx={{ fontSize: 13 }} />} label="TOKENS IN" value={fmtTokens(job.totalInputTokens ?? 0)} unit="" color={colors.accent.blue} />
          <Gauge icon={<BoltIcon sx={{ fontSize: 13 }} />} label="TOKENS OUT" value={fmtTokens(job.totalOutputTokens ?? 0)} unit="" color={colors.accent.orange} />
          <Gauge icon={<SpeedIcon sx={{ fontSize: 13 }} />} label="TOTAL" value={fmtTokens(totalTokens)} unit="tok" color={colors.accent.purple} />
        </Box>

        {/* ─── Live Log Stream ─── */}
        <Box sx={{ mt: 1.5 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.5 }}>
            <TerminalIcon sx={{ fontSize: 12, color: colors.accent.green }} />
            <Typography sx={{ fontSize: '0.58rem', color: colors.text.dim, fontFamily: "'JetBrains Mono', monospace", letterSpacing: 1.5 }}>
              EVENT STREAM
            </Typography>
            {isActive && <Box sx={{ width: 5, height: 5, borderRadius: '50%', bgcolor: colors.accent.green, animation: 'ragBlink 1s steps(1) infinite' }} />}
          </Box>
          <LogStream job={job} />
        </Box>
      </Box>
    </Box>
  );
}

// ─── Stage Pipeline Tracker ───

function StagePipeline({ job, currentKey, statusColor }: { job: TrackedJob; currentKey: string | null; statusColor: string }) {
  const isTerminal = job.status === 'done' || job.status === 'failed';
  const failedKey = job.status === 'failed' ? currentKey : null;

  // Per-stage sub-label (always rendered so all cards are equal height)
  const subLabel = (key: string): string => {
    if (key === 'parse') return (job.kind ?? '').toUpperCase() || '—';
    if (key === 'chunk') return job.chunkCount ? `${job.chunkCount} CHK` : '—';
    if (key === 'embed') return job.chunkCount ? `${job.chunkIndex ?? 0}/${job.chunkCount}` : '—';
    if (key === 'extract') {
      if (!job.chunkCount) return '—';
      const base = `${job.chunkIndex ?? 0}/${job.chunkCount}`;
      return job.batchCount ? `${base} · B${job.batchIndex ?? 0}/${job.batchCount}` : base;
    }
    if (key === 'store') return '—';
    return '—';
  };

  return (
    <Box sx={{ display: 'flex', alignItems: 'stretch', gap: 0.5 }}>
      {PIPELINE.map((stage, i) => {
        const idx = PIPELINE.findIndex((s) => s.key === currentKey);
        const isCurrent = stage.key === currentKey && !isTerminal;
        const isComplete = isTerminal && job.status === 'done' ? true : idx !== -1 && PIPELINE.indexOf(stage) < idx;
        const isFailed = stage.key === failedKey;
        const color = isFailed ? colors.accent.red : isComplete ? colors.accent.green : isCurrent ? statusColor : colors.text.dim;
        const sub = subLabel(stage.key);
        return (
          <Box key={stage.key} sx={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
            <Box sx={{
              position: 'relative',
              border: `1px solid ${isCurrent || isComplete ? alphaColor(color, '60') : colors.border.default}`,
              borderRadius: 0.5,
              p: 0.75,
              minHeight: 62,
              display: 'flex',
              flexDirection: 'column',
              bgcolor: isCurrent ? alphaColor(color, '0a') : isComplete ? alphaColor(color, '06') : colors.bg.tertiary,
              transition: 'all 0.25s ease',
              ...(isCurrent ? { boxShadow: `0 0 12px ${alphaColor(color, '30')}, inset 0 0 8px ${alphaColor(color, '10')}` } : {}),
            }}>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.25 }}>
                <Typography sx={{ fontSize: '0.5rem', color: colors.text.dim, fontFamily: "'JetBrains Mono', monospace" }}>
                  {stage.code}
                </Typography>
                <Box sx={{
                  width: 6, height: 6, borderRadius: '50%', bgcolor: color,
                  ...(isCurrent ? { animation: 'ragPulse 1s ease-in-out infinite' } : {}),
                }} />
              </Box>
              <Typography sx={{
                fontSize: '0.6rem', color, fontFamily: "'JetBrains Mono', monospace",
                fontWeight: 600, letterSpacing: 1, textAlign: 'center',
              }}>
                {stage.label}
              </Typography>
              {/* Sub-label slot — always rendered so all cards are equal height */}
              <Typography sx={{
                fontSize: '0.5rem', color: isCurrent || isComplete ? color : colors.text.dim,
                fontFamily: "'JetBrains Mono', monospace", textAlign: 'center', mt: 'auto', pt: 0.25,
                opacity: sub === '—' ? 0.3 : 1,
              }}>
                {sub}
              </Typography>
            </Box>
            {/* Connector */}
            {i < PIPELINE.length - 1 && (
              <Box sx={{ height: 1, mt: 0.5, background: `repeating-linear-gradient(90deg, ${colors.border.default} 0 4px, transparent 4px 8px)` }} />
            )}
          </Box>
        );
      })}
    </Box>
  );
}

// ─── Telemetry Gauge ───

function Gauge({ icon, label, value, unit, color }: { icon: React.ReactNode; label: string; value: string; unit: string; color: string }) {
  return (
    <Box sx={{
      flex: 1, p: 0.75, borderRadius: 0.5,
      border: `1px solid ${colors.border.default}`,
      bgcolor: colors.bg.tertiary,
    }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.25, color }}>
        {icon}
        <Typography sx={{ fontSize: '0.48rem', color: colors.text.dim, fontFamily: "'JetBrains Mono', monospace", letterSpacing: 1 }}>
          {label}
        </Typography>
      </Box>
      <Typography sx={{ fontSize: '0.78rem', color, fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, lineHeight: 1 }}>
        {value}
        {unit && <Box component="span" sx={{ fontSize: '0.5rem', color: colors.text.dim, ml: 0.25, fontWeight: 400 }}>{unit}</Box>}
      </Typography>
    </Box>
  );
}

// ─── Log Stream ───

function LogStream({ job }: { job: TrackedJob }) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (endRef.current) endRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [job.log.length]);

  if (job.log.length === 0) {
    return (
      <Box sx={{
        height: 120, overflow: 'auto', p: 1, borderRadius: 0.5,
        border: `1px solid ${colors.border.default}`, bgcolor: colors.bg.primary,
        fontFamily: "'JetBrains Mono', monospace",
      }}>
        <Typography sx={{ fontSize: '0.58rem', color: colors.text.dim }}>
          {`> awaiting events...\n> _`}
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={{
      height: 120, overflow: 'auto', p: 1, borderRadius: 0.5,
      border: `1px solid ${colors.border.default}`, bgcolor: colors.bg.primary,
      fontFamily: "'JetBrains Mono', monospace",
    }}>
      {job.log.map((entry, i) => {
        const c = entry.level === 'err' ? colors.accent.red : entry.level === 'ok' ? colors.accent.green : entry.level === 'warn' ? colors.accent.orange : colors.text.secondary;
        const time = new Date(entry.ts).toLocaleTimeString('en-US', { hour12: false }) + '.' + String(entry.ts % 1000).padStart(3, '0').slice(0, 3);
        return (
          <Box key={i} sx={{ fontSize: '0.58rem', lineHeight: 1.5, display: 'flex', gap: 0.5, whiteSpace: 'nowrap' }}>
            <Box component="span" sx={{ color: colors.text.dim, flexShrink: 0 }}>{time}</Box>
            <Box component="span" sx={{ color: c, flexShrink: 0 }}>[{entry.stage.toUpperCase()}]</Box>
            <Box component="span" sx={{ color: colors.text.secondary, overflow: 'hidden', textOverflow: 'ellipsis' }}>{entry.detail}</Box>
          </Box>
        );
      })}
      <div ref={endRef} />
    </Box>
  );
}

// ─── Job Row (compact, in the queue list) ───

function JobRow({ job, selected, onSelect, onCancel, onDelete }: { job: TrackedJob; selected: boolean; onSelect: () => void; onCancel: () => void; onDelete: () => void }) {
  const isDone = job.status === 'done';
  const isFailed = job.status === 'failed';
  const isCancelled = job.status === 'cancelled';
  const isActive = job.status === 'pending' || job.status === 'running';
  const statusColor = isDone ? colors.accent.green : isFailed ? colors.accent.red : isCancelled ? colors.text.dim : isActive ? colors.accent.blue : colors.text.dim;
  const StageIcon = isDone ? CheckCircleIcon : isFailed ? ErrorIcon : isCancelled ? PendingIcon : isActive ? BoltIcon : PendingIcon;

  return (
    <Box
      onClick={onSelect}
      sx={{
        p: 1, borderRadius: 0.5, cursor: 'pointer',
        border: `1px solid ${selected ? alphaColor(statusColor, '60') : colors.border.default}`,
        bgcolor: selected ? alphaColor(statusColor, '06') : colors.bg.tertiary,
        transition: 'all 0.15s',
        '&:hover': { borderColor: colors.border.strong },
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.5 }}>
        <StageIcon sx={{ fontSize: 13, color: statusColor, ...(isActive ? { animation: 'ragPulse 1.5s ease-in-out infinite' } : {}) }} />
        <Typography sx={{ fontSize: '0.68rem', color: colors.text.primary, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: "'JetBrains Mono', monospace" }}>
          {job.name}
        </Typography>
        <Typography sx={{ fontSize: '0.55rem', color: statusColor, fontFamily: "'JetBrains Mono', monospace", fontWeight: 600 }}>
          {job.progress}%
        </Typography>
        {isActive && (
          <Tooltip title="Cancel">
            <IconButton size="small" onClick={(e) => { e.stopPropagation(); onCancel(); }} sx={{ color: colors.accent.red, p: 0.15, ml: 0.25 }}>
              <Box sx={{ fontSize: '0.55rem', lineHeight: 1 }}>■</Box>
            </IconButton>
          </Tooltip>
        )}
        {!isActive && (
          <Tooltip title="Delete">
            <IconButton size="small" onClick={(e) => { e.stopPropagation(); onDelete(); }} sx={{ color: colors.text.dim, p: 0.15, ml: 0.25, '&:hover': { color: colors.accent.red } }}>
              <Box sx={{ fontSize: '0.6rem', lineHeight: 1 }}>×</Box>
            </IconButton>
          </Tooltip>
        )}
      </Box>
      <Box sx={{ height: 2, borderRadius: 1, bgcolor: colors.border.subtle, overflow: 'hidden' }}>
        <Box sx={{ height: '100%', width: `${job.progress}%`, bgcolor: statusColor, transition: 'width 0.4s ease' }} />
      </Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 0.25 }}>
        <Typography sx={{ fontSize: '0.52rem', color: colors.text.dim, fontFamily: "'JetBrains Mono', monospace" }}>
          {isFailed ? (job.error ?? 'ERROR') : isCancelled ? 'CANCELLED' : (job.detail ?? job.stage).toUpperCase()}
        </Typography>
        <Typography sx={{ fontSize: '0.52rem', color: colors.text.dim, fontFamily: "'JetBrains Mono', monospace" }}>
          {new Date(job.createdAt).toLocaleTimeString('en-US', { hour12: false })}
        </Typography>
      </Box>
    </Box>
  );
}

// ─── Telemetry computation ───

function computeTelemetry(job: TrackedJob, now: number): {
  throughput: string; stageLatency: string; extractRate: string; eta: string;
} {
  if (!job.chunkCount) {
    return { throughput: '—', stageLatency: '—', extractRate: '—', eta: '—' };
  }

  // ── Stage latency: avg gap between consecutive SSE events (sub-step time) ──
  const samples = job.samples;
  let gapSum = 0, gapCount = 0;
  for (let i = 1; i < samples.length; i++) {
    const dt = samples[i]!.ts - samples[i - 1]!.ts;
    if (dt > 0 && dt < 60000) { gapSum += dt; gapCount++; }
  }
  const stageLatency = gapCount > 0 ? gapSum / gapCount : 0;

  // ── Throughput + ETA: prefer startedAt-based estimate (works on chunk 1) ──
  const startedAt = job.startedAt ?? job.createdAt;
  const elapsedMs = Math.max(now - startedAt, 0);
  const elapsedMin = Math.max(elapsedMs / 60000, 0.0001);
  const currentChunk = job.chunkIndex ?? 0;
  const remaining = Math.max(job.chunkCount - currentChunk, 0);

  // Throughput: chunks processed per minute. On chunk 1 this is ~1/elapsedMin
  // (an upper-bound estimate) — still useful and non-zero.
  const throughput = currentChunk > 0 ? currentChunk / elapsedMin : 0;

  // ETA: from throughput if we have it; otherwise from stageLatency × sub-steps
  // per chunk (~5: embed + extract batches + store) × remaining.
  let etaMin = 0;
  if (throughput > 0) {
    etaMin = remaining / throughput;
  } else if (stageLatency > 0) {
    const subStepsPerChunk = 5;
    etaMin = (remaining * subStepsPerChunk * stageLatency) / 60000;
  }

  // ── Extract rate: extracting-stage log entries per minute ──
  const logStart = job.log[0]?.ts ?? now;
  const logElapsedMin = Math.max((now - logStart) / 60000, 0.0001);
  const extractEntries = job.log.filter((e) => e.stage === 'extracting').length;
  const extractRate = extractEntries / logElapsedMin;

  const fmtEta = (m: number): string => {
    if (m <= 0) return '—';
    if (m < 1) return `${Math.round(m * 60)}s`;
    if (m < 60) return `${m.toFixed(1)}m`;
    const h = Math.floor(m / 60); const rem = Math.round(m % 60);
    return `${h}h${rem}m`;
  };

  return {
    throughput: throughput > 0 ? throughput.toFixed(1) : '—',
    stageLatency: stageLatency > 0 ? Math.round(stageLatency).toString() : '—',
    extractRate: extractRate > 0 ? extractRate.toFixed(1) : '—',
    eta: fmtEta(etaMin),
  };
}
