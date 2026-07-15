import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import LinearProgress from '@mui/material/LinearProgress';
import { colors, alphaColor } from '../../theme';
import {
  modelBenchmark,
  providers as provApi,
  type BenchmarkGrade,
  type BenchmarkProgressEvent,
  type BenchmarkRunResult,
  type BenchmarkTestResult,
  type ModalityProbeResult,
} from '../../api';
import {
  settingsTheme,
  settingsMonoSx,
  settingsOverlineSx,
  settingsScanlineSx,
  settingsBtnPrimarySx,
  settingsBtnGhostSx,
} from '../../styles/settings-theme';

const GRADE_META: Record<BenchmarkGrade, { label: string; subtitle: string; color: string }> = {
  ELITE: { label: 'ELITE', subtitle: 'Full agentic clearance — deploy without reservation', color: colors.accent.blue },
  CLEARED: { label: 'CLEARED', subtitle: 'Recommended for Agent-X autonomous workloads', color: colors.accent.green },
  LIMITED: { label: 'LIMITED', subtitle: 'Usable with constraints — review failed probes', color: colors.accent.orange },
  STANDBY: { label: 'STANDBY', subtitle: 'Not cleared for agentic deployment', color: colors.accent.red },
};

function gradeAllowsUse(grade: BenchmarkGrade): boolean {
  return grade !== 'STANDBY';
}

export function gradeAllowsAgentX(grade: BenchmarkGrade): boolean {
  return gradeAllowsUse(grade);
}

interface ModelBenchmarkRunnerProps {
  providerId: string;
  modelId: string;
  modelName?: string;
  profileId?: string;
  modelCapabilities?: string[];
  autoStart?: boolean;
  embedded?: boolean;
  onComplete?: (result: BenchmarkRunResult) => void;
  onRunningChange?: (running: boolean) => void;
}

export function ModelBenchmarkRunner({
  providerId,
  modelId,
  modelName,
  profileId,
  modelCapabilities,
  autoStart = false,
  embedded = false,
  onComplete,
  onRunningChange,
}: ModelBenchmarkRunnerProps) {
  const [phaseMessage, setPhaseMessage] = useState('');
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentTest, setCurrentTest] = useState('');
  const [tests, setTests] = useState<BenchmarkTestResult[]>([]);
  const [modalities, setModalities] = useState<ModalityProbeResult[]>([]);
  const [result, setResult] = useState<BenchmarkRunResult | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [logFile, setLogFile] = useState('');
  const [error, setError] = useState('');
  const cleanupRef = useRef<(() => void) | null>(null);
  const startedRef = useRef(false);

  const reset = useCallback(() => {
    cleanupRef.current?.();
    cleanupRef.current = null;
    setPhaseMessage('');
    setProgress(0);
    setCurrentTest('');
    setTests([]);
    setModalities([]);
    setResult(null);
    setFromCache(false);
    setLogFile('');
    setError('');
    startedRef.current = false;
  }, []);

  const handleEvent = useCallback((event: BenchmarkProgressEvent) => {
    if (event.type === 'phase') {
      setPhaseMessage(event.message);
      return;
    }
    if (event.type === 'test_start') {
      setCurrentTest(event.label);
      setProgress(Math.round(((event.index - 1) / event.total) * 100));
      return;
    }
    if (event.type === 'test_complete') {
      setTests((prev) =>
        prev.some((t) => t.id === event.result.id) ? prev : [...prev, event.result],
      );
      setProgress(Math.round((event.index / event.total) * 100));
      return;
    }
    if (event.type === 'modality') {
      setModalities((prev) =>
        prev.some((m) => m.id === event.result.id) ? prev : [...prev, event.result],
      );
      return;
    }
    if (event.type === 'complete') {
      setResult(event.result);
      setFromCache(Boolean(event.result.fromCache));
      setLogFile(event.result.logFile ?? '');
      setProgress(100);
      setRunning(false);
      onComplete?.(event.result);
      return;
    }
    if (event.type === 'error') {
      setError(event.error);
      setTests([]);
      setModalities([]);
      setCurrentTest('');
      setPhaseMessage('');
      setProgress(0);
      setRunning(false);
    }
  }, [onComplete]);

  const startBenchmark = useCallback(async (force = false) => {
    reset();
    setRunning(true);
    onRunningChange?.(true);
    setPhaseMessage(force ? 'Forcing fresh clearance scan…' : 'Arming clearance protocol…');

    try {
      const startRes = await modelBenchmark.start({
        providerId,
        modelId,
        profileId,
        modelCapabilities,
        force,
      });
      if (startRes.cached) {
        setFromCache(true);
        setLogFile(startRes.logFile ?? '');
        setPhaseMessage('Loading archived clearance record…');
      }
      cleanupRef.current = modelBenchmark.stream(startRes.runId, handleEvent);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Benchmark failed to start');
      setRunning(false);
      onRunningChange?.(false);
    }
  }, [providerId, modelId, profileId, modelCapabilities, handleEvent, onRunningChange, reset]);

  const downloadLog = useCallback(async () => {
    try {
      const blob = await modelBenchmark.downloadLog(providerId, modelId);
      const name = logFile || `${providerId}--${modelId}.log`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Log download failed');
    }
  }, [providerId, modelId, logFile]);

  useEffect(() => {
    if (!running) onRunningChange?.(false);
  }, [running, onRunningChange]);

  useEffect(() => {
    if (autoStart && providerId && modelId && !startedRef.current) {
      startedRef.current = true;
      void startBenchmark();
    }
  }, [autoStart, providerId, modelId, startBenchmark]);

  useEffect(() => () => cleanupRef.current?.(), []);

  const gradeMeta = result ? GRADE_META[result.grade] : null;

  return (
    <Box sx={{
      position: 'relative',
      borderRadius: embedded ? '4px' : '8px',
      border: `1px solid ${running ? settingsTheme.border.hud : settingsTheme.border.default}`,
      bgcolor: settingsTheme.bg.inset,
      overflow: 'hidden',
      boxShadow: 'none',
      transition: 'border-color 0.3s',
    }}>
      <Box sx={settingsScanlineSx} />

      {/* Header HUD */}
      <Box sx={{
        position: 'relative', zIndex: 1, px: embedded ? 1.5 : 2.5, py: embedded ? 1.25 : 2,
        borderBottom: `1px solid ${settingsTheme.border.subtle}`,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2,
      }}>
        <Box>
          <Typography sx={{ ...settingsOverlineSx, fontSize: '0.48rem', color: settingsTheme.accent.hud, mb: 0.25 }}>
            Agentic Clearance Protocol
          </Typography>
          <Typography sx={{ ...settingsMonoSx, fontSize: embedded ? '0.68rem' : '0.78rem', fontWeight: 700, color: settingsTheme.text.primary }}>
            {modelName || modelId}
          </Typography>
        </Box>
        {!running && !result && !embedded && (
          <Button size="small" variant="contained" onClick={() => void startBenchmark()} sx={settingsBtnPrimarySx}>
            Initiate Scan
          </Button>
        )}
        {result && !running && (
          <Button size="small" variant="outlined" onClick={() => void startBenchmark(true)} sx={settingsBtnGhostSx}>
            Re-scan
          </Button>
        )}
      </Box>

      <Box sx={{ position: 'relative', zIndex: 1, p: embedded ? 1.5 : 2.5 }}>
        {error && (
          <Typography sx={{ ...settingsMonoSx, fontSize: '0.65rem', color: settingsTheme.accent.alert, mb: 1.5, wordBreak: 'break-word' }}>
            {error}
          </Typography>
        )}

        {fromCache && result && !running && (
          <Box sx={{
            mb: 1.5, px: 1.5, py: 1, borderRadius: '4px',
            border: `1px solid ${alphaColor(settingsTheme.accent.cyan, '44')}`,
            bgcolor: `${alphaColor(settingsTheme.accent.cyan, '0a')}`,
          }}>
            <Typography sx={{ ...settingsMonoSx, fontSize: '0.52rem', color: settingsTheme.accent.cyan }}>
              ARCHIVE :: Loaded saved benchmark — scan not re-run
            </Typography>
            {result.finishedAt && (
              <Typography sx={{ ...settingsMonoSx, fontSize: '0.48rem', color: settingsTheme.text.dim, mt: 0.25 }}>
                Recorded {new Date(result.finishedAt).toLocaleString()}
              </Typography>
            )}
          </Box>
        )}

        {result && !running && (
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 1.5 }}>
            <Button size="small" variant="outlined" onClick={() => void downloadLog()} sx={settingsBtnGhostSx}>
              Download log
            </Button>
            {logFile && (
              <Typography sx={{ ...settingsMonoSx, fontSize: '0.48rem', color: settingsTheme.text.dim, alignSelf: 'center' }}>
                {logFile}
              </Typography>
            )}
          </Box>
        )}

        {(running || result) && (
          <Box sx={{ mb: 2 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.75 }}>
              <Typography sx={{ ...settingsMonoSx, fontSize: '0.52rem', color: settingsTheme.text.dim, textTransform: 'uppercase' }}>
                {phaseMessage || (running ? 'Executing probes…' : 'Scan complete')}
              </Typography>
              <Typography sx={{ ...settingsMonoSx, fontSize: '0.52rem', color: settingsTheme.accent.hud }}>
                {progress}%
              </Typography>
            </Box>
            <LinearProgress
              variant="determinate"
              value={progress}
              sx={{
                height: 4, borderRadius: 2, bgcolor: settingsTheme.bg.hud,
                '& .MuiLinearProgress-bar': {
                  bgcolor: settingsTheme.accent.hud,
                },
              }}
            />
            {currentTest && running && (
              <Typography sx={{ ...settingsMonoSx, fontSize: '0.5rem', color: settingsTheme.accent.cyan, mt: 0.75, letterSpacing: '1px' }}>
                ▸ {currentTest}
              </Typography>
            )}
          </Box>
        )}

        {/* Grade reveal */}
        {result && gradeMeta && (
          <Box sx={{
            mb: 2.5, p: 2, borderRadius: '6px', textAlign: 'center',
            border: `1px solid ${alphaColor(gradeMeta.color, '55')}`,
            bgcolor: `${alphaColor(gradeMeta.color, '0d')}`,
          }}>
            <Typography sx={{
              ...settingsMonoSx, fontSize: embedded ? '1.4rem' : '2rem', fontWeight: 800,
              color: gradeMeta.color, letterSpacing: '6px',
            }}>
              {gradeMeta.label}
            </Typography>
            <Typography sx={{ ...settingsMonoSx, fontSize: '0.58rem', color: settingsTheme.text.secondary, mt: 0.75 }}>
              {gradeMeta.subtitle}
            </Typography>
            <Typography sx={{ ...settingsMonoSx, fontSize: '0.5rem', color: settingsTheme.text.dim, mt: 1 }}>
              SCORE {result.overallScore}/{result.maxScore} · {result.percent}% · {(result.durationMs / 1000).toFixed(1)}s
            </Typography>
          </Box>
        )}

        {/* Test matrix */}
        {tests.length > 0 && (
          <Box sx={{ mb: modalities.length > 0 ? 2 : 0 }}>
            <Typography sx={{ ...settingsOverlineSx, mb: 1 }}>Core capability matrix</Typography>
            <Box sx={{ display: 'grid', gap: 0.75 }}>
              {tests.map((t) => (
                <TestRow key={t.id} test={t} />
              ))}
            </Box>
          </Box>
        )}

        {/* Modality sensors */}
        {modalities.length > 0 && (
          <Box>
            <Typography sx={{ ...settingsOverlineSx, mb: 0.5 }}>Sensory channels · live probes</Typography>
            <Typography sx={{ ...settingsMonoSx, fontSize: '0.48rem', color: settingsTheme.text.dim, mb: 1, lineHeight: 1.5 }}>
              Image, audio, and video are tested with live media payloads. Critical core probes count double toward clearance. Sensory results are informational and do not change the grade.
            </Typography>
            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 0.75 }}>
              {modalities.map((m) => (
                <ModalityChip key={m.id} probe={m} />
              ))}
            </Box>
          </Box>
        )}

        {!running && !result && !error && (
          <Typography sx={{ ...settingsMonoSx, fontSize: '0.62rem', color: settingsTheme.text.dim, textAlign: 'center', py: 2 }}>
            10 agentic probes · reasoning · coding · tools · JSON · decision-making
          </Typography>
        )}
      </Box>
    </Box>
  );
}

function TestRow({ test }: { test: BenchmarkTestResult }) {
  const pct = test.maxScore > 0 ? Math.round((test.score / test.maxScore) * 100) : 0;
  const isPartial = !test.passed && test.score > 0;
  const color = test.passed ? settingsTheme.accent.signal : isPartial ? settingsTheme.accent.amber : settingsTheme.accent.alert;
  const showDetails = Boolean(test.details || test.error);

  return (
    <Box sx={{
      px: 1, py: 0.75, borderRadius: '3px',
      bgcolor: settingsTheme.bg.hud,
      border: `1px solid ${isPartial ? `${alphaColor(settingsTheme.accent.amber, '44')}` : settingsTheme.border.subtle}`,
    }}>
      <Box sx={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 0.5, alignItems: 'start' }}>
        <Box sx={{ minWidth: 0 }}>
          <Typography sx={{ ...settingsMonoSx, fontSize: '0.58rem', color: settingsTheme.text.primary }}>
            {test.passed ? '✓' : isPartial ? '◐' : '✗'} {test.label}
            {test.critical && (
              <Typography component="span" sx={{ ...settingsMonoSx, fontSize: '0.45rem', color: settingsTheme.accent.alert, ml: 0.75 }}>
                CRITICAL
              </Typography>
            )}
          </Typography>
          <Typography sx={{ ...settingsMonoSx, fontSize: '0.48rem', color: settingsTheme.text.dim, mt: 0.25 }}>
            {test.score}/{test.maxScore} pts
            {isPartial ? ' · partial credit' : test.passed ? ' · full credit' : ' · no credit'}
          </Typography>
        </Box>
        <Box sx={{ textAlign: 'right', minWidth: 48 }}>
          <Typography sx={{ ...settingsMonoSx, fontSize: '0.52rem', color, fontWeight: 700 }}>
            {pct}%
          </Typography>
          <Typography sx={{ ...settingsMonoSx, fontSize: '0.42rem', color: settingsTheme.text.dim }}>
            {test.latencyMs}ms
          </Typography>
        </Box>
      </Box>
      {showDetails && (
        <Box sx={{
          mt: 0.75, pt: 0.75,
          borderTop: `1px solid ${settingsTheme.border.subtle}`,
        }}>
          <Typography sx={{ ...settingsOverlineSx, fontSize: '0.42rem', mb: 0.35, color: isPartial ? settingsTheme.accent.amber : settingsTheme.text.dim }}>
            {test.error ? 'Error' : isPartial ? 'Why partial' : test.passed ? 'Result' : 'Why failed'}
          </Typography>
          <Typography sx={{
            ...settingsMonoSx,
            fontSize: '0.5rem',
            color: test.error ? settingsTheme.accent.alert : isPartial ? settingsTheme.accent.amber : settingsTheme.text.secondary,
            lineHeight: 1.55,
            wordBreak: 'break-word',
            whiteSpace: 'pre-wrap',
          }}>
            {test.error || test.details}
          </Typography>
        </Box>
      )}
    </Box>
  );
}

const MODALITY_SOURCE_LABEL: Record<string, string> = {
  catalog: 'Provider catalog',
  inferred: 'Inferred from model ID',
  probe: 'Live API probe',
  unknown: 'No metadata available',
};

const PROBE_STATUS_LABEL: Record<string, { label: string; color: string }> = {
  passed: { label: 'PROBE PASSED', color: settingsTheme.accent.signal },
  failed: { label: 'PROBE FAILED', color: settingsTheme.accent.alert },
  skipped: { label: 'SKIPPED', color: settingsTheme.text.dim },
  unsupported: { label: 'UNSUPPORTED', color: settingsTheme.accent.amber },
};

function ModalityChip({ probe }: { probe: ModalityProbeResult }) {
  const detected = probe.detected;
  const color = detected ? settingsTheme.accent.cyan : settingsTheme.text.dim;
  const sourceLabel = MODALITY_SOURCE_LABEL[probe.source] ?? probe.source;
  const status = probe.probeStatus ? PROBE_STATUS_LABEL[probe.probeStatus] : null;
  const failureReason = probe.probeStatus === 'failed' || probe.probeStatus === 'unsupported'
    ? (probe.probeStatus === 'failed' ? (probe.details || probe.note) : (probe.note || probe.details))
    : null;

  return (
    <Box sx={{
      p: 1, borderRadius: '4px', border: `1px solid ${alphaColor(color, '33')}`,
      bgcolor: detected ? `${alphaColor(settingsTheme.accent.cyan, '0a')}` : settingsTheme.bg.inset,
    }}>
      <Typography sx={{ ...settingsMonoSx, fontSize: '0.5rem', color, fontWeight: 700, textTransform: 'uppercase' }}>
        {detected ? '● SUPPORTED' : '○ NOT SUPPORTED'}
      </Typography>
      {status && (
        <Typography sx={{ ...settingsMonoSx, fontSize: '0.45rem', color: status.color, fontWeight: 700, mt: 0.35 }}>
          {probe.tested ? status.label : 'NOT TESTED'}
        </Typography>
      )}
      <Typography sx={{ ...settingsMonoSx, fontSize: '0.52rem', color: settingsTheme.text.secondary, mt: 0.4 }}>
        {probe.label}
      </Typography>
      {!failureReason && (
        <Typography sx={{ ...settingsMonoSx, fontSize: '0.45rem', color: settingsTheme.text.dim, mt: 0.35 }}>
          {sourceLabel}
        </Typography>
      )}
      {!failureReason && probe.note && (
        <Typography sx={{ ...settingsMonoSx, fontSize: '0.42rem', color: settingsTheme.text.dim, mt: 0.35, lineHeight: 1.4 }}>
          {probe.note}
        </Typography>
      )}
      {!failureReason && probe.details && (
        <Typography sx={{
          ...settingsMonoSx, fontSize: '0.42rem',
          color: settingsTheme.text.secondary,
          mt: 0.35, lineHeight: 1.4, wordBreak: 'break-word',
        }}>
          {probe.details}
        </Typography>
      )}
      {failureReason && (
        <Typography sx={{
          ...settingsMonoSx, fontSize: '0.42rem',
          color: probe.probeStatus === 'failed' ? settingsTheme.accent.alert : settingsTheme.accent.amber,
          mt: 0.5, lineHeight: 1.45, wordBreak: 'break-word',
        }}>
          {failureReason}
        </Typography>
      )}
    </Box>
  );
}

export function ModelBenchmarkScanner({
  profiles,
  availableProviders,
}: {
  profiles: Array<{ id: string; label: string; providerId: string; providerName: string }>;
  availableProviders: Array<{ id: string; name: string }>;
}) {
  const [providerId, setProviderId] = useState('');
  const [profileId, setProfileId] = useState('');
  const [models, setModels] = useState<Array<{ id: string; name: string; capabilities?: string[] }>>([]);
  const [modelId, setModelId] = useState('');
  const [loadingModels, setLoadingModels] = useState(false);

  const profileOptions = useMemo(
    () => profiles.filter((p) => !providerId || p.providerId === providerId),
    [profiles, providerId],
  );

  useEffect(() => {
    if (profileOptions.length === 1 && !profileId) setProfileId(profileOptions[0]!.id);
  }, [profileOptions, profileId]);

  const loadModels = useCallback(async () => {
    if (!providerId) return;
    setLoadingModels(true);
    setModels([]);
    setModelId('');
    try {
      const list = await provApi.models(providerId);
      setModels(list.map((m: { id: string; name: string; capabilities?: string[] }) => ({ id: m.id, name: m.name, capabilities: m.capabilities })));
    } catch { /* ignore */ }
    finally { setLoadingModels(false); }
  }, [providerId]);

  useEffect(() => { if (providerId) void loadModels(); }, [providerId, loadModels]);

  const selectedModel = models.find((m) => m.id === modelId);

  return (
    <Box>
      <Box sx={{
        display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr 1fr' }, gap: 1.5, mb: 2,
      }}>
        <Box>
          <Typography sx={{ ...settingsOverlineSx, mb: 0.5 }}>Provider</Typography>
          <Box component="select" value={providerId}
            onChange={(e) => { setProviderId(e.target.value); setProfileId(''); }}
            sx={{
              width: '100%', ...settingsMonoSx, fontSize: '0.65rem', p: 1,
              bgcolor: settingsTheme.bg.inset, color: settingsTheme.text.primary,
              border: `1px solid ${settingsTheme.border.default}`, borderRadius: '4px',
            }}>
            <option value="">Select provider…</option>
            {availableProviders.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </Box>
        </Box>
        <Box>
          <Typography sx={{ ...settingsOverlineSx, mb: 0.5 }}>Profile</Typography>
          <Box component="select" value={profileId}
            onChange={(e) => setProfileId(e.target.value)}
            disabled={!providerId}
            sx={{
              width: '100%', ...settingsMonoSx, fontSize: '0.65rem', p: 1,
              bgcolor: settingsTheme.bg.inset, color: settingsTheme.text.primary,
              border: `1px solid ${settingsTheme.border.default}`, borderRadius: '4px',
            }}>
            <option value="">Any active profile</option>
            {profileOptions.map((p) => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </Box>
        </Box>
        <Box>
          <Typography sx={{ ...settingsOverlineSx, mb: 0.5 }}>Model</Typography>
          <Box component="select" value={modelId}
            onChange={(e) => setModelId(e.target.value)}
            disabled={!providerId || loadingModels}
            sx={{
              width: '100%', ...settingsMonoSx, fontSize: '0.65rem', p: 1,
              bgcolor: settingsTheme.bg.inset, color: settingsTheme.text.primary,
              border: `1px solid ${settingsTheme.border.default}`, borderRadius: '4px',
            }}>
            <option value="">{loadingModels ? 'Loading…' : 'Select model…'}</option>
            {models.map((m) => (
              <option key={m.id} value={m.id}>{m.name || m.id}</option>
            ))}
          </Box>
        </Box>
      </Box>

      {modelId && providerId && (
        <ModelBenchmarkRunner
          providerId={providerId}
          modelId={modelId}
          modelName={selectedModel?.name}
          profileId={profileId || undefined}
          modelCapabilities={selectedModel?.capabilities}
        />
      )}
    </Box>
  );
}
