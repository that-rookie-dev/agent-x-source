import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import type { DeepSearchProgress, DeepSearchResultBundle } from '@agentx/shared/browser';
import { colors, alphaColor } from '../../theme';
import { DeepSearchResultCard } from './DeepSearchResultCard';
import { ResearchBoardTrigger } from './DeepSearchResearchBoard';
import { searchResultsRowSx, deepSearchShellSx } from './card-utils';
import { formatSearchProvidersList } from './provider-labels';

function ProgressStrip({ progress, running }: { progress?: DeepSearchProgress; running?: boolean }) {
  if (!progress && !running) return null;
  const phase = progress?.phase ?? (running ? 'searching' : 'done');
  const message = progress?.message ?? (running ? 'Searching…' : '');
  return (
    <Box sx={{
      px: 1,
      py: 0.45,
      borderBottom: `1px solid ${colors.border.subtle}`,
      bgcolor: `${alphaColor(colors.accent.blue, '08')}`,
    }}>
      <Typography sx={{ fontSize: '0.54rem', color: colors.accent.blue, fontFamily: "'JetBrains Mono', monospace" }}>
        {phase.toUpperCase()} · {message}
        {progress?.searched != null ? ` · scanned ${progress.searched}` : ''}
        {progress?.fetched != null && progress.total ? ` · fetched ${progress.fetched}/${progress.total}` : ''}
      </Typography>
    </Box>
  );
}

export function DeepSearchShell({
  bundle,
  running,
  progress,
}: {
  bundle?: DeepSearchResultBundle | null;
  running?: boolean;
  progress?: DeepSearchProgress;
}) {
  if (!bundle && !running) return null;

  const results = bundle?.results ?? [];
  const stats = bundle?.stats;
  const providersLabel = formatSearchProvidersList(bundle, results);

  return (
    <Box sx={deepSearchShellSx}>
      <Box sx={{
        px: 1,
        py: 0.55,
        borderBottom: `1px solid ${colors.border.subtle}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 0.75,
        flexWrap: 'wrap',
      }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0, flexWrap: 'wrap' }}>
          <Typography sx={{
            fontSize: '0.58rem',
            fontWeight: 700,
            letterSpacing: '0.8px',
            fontFamily: "'JetBrains Mono', monospace",
            color: colors.accent.cyan,
          }}>
            DEEP WEB SEARCH
          </Typography>
          {providersLabel && (
            <Typography sx={{
              fontSize: '0.5rem',
              color: colors.text.secondary,
              fontFamily: "'JetBrains Mono', monospace",
            }}>
              via {providersLabel}
            </Typography>
          )}
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
          {stats && (
            <Typography sx={{ fontSize: '0.5rem', color: colors.text.dim, fontFamily: "'JetBrains Mono', monospace" }}>
              {stats.kept} kept · {stats.searched} scanned · {(stats.ms / 1000).toFixed(1)}s
            </Typography>
          )}
          {bundle && <ResearchBoardTrigger bundle={bundle} />}
        </Box>
      </Box>

      <ProgressStrip progress={progress ?? bundle?.progress} running={running} />

      {bundle?.query && (
        <Box sx={{ px: 1, py: 0.5, borderBottom: `1px solid ${colors.border.subtle}` }}>
          <Typography sx={{ fontSize: '0.62rem', color: colors.text.secondary, fontStyle: 'italic', lineHeight: 1.35 }}>
            “{bundle.query}”
          </Typography>
          {bundle.plan.intent.length > 0 && (
            <Typography sx={{ fontSize: '0.5rem', color: colors.text.dim, mt: 0.2, fontFamily: "'JetBrains Mono', monospace" }}>
              Intent: {bundle.plan.intent.join(', ')}
            </Typography>
          )}
        </Box>
      )}

      {results.length > 0 ? (
        <Box sx={searchResultsRowSx}>
          {results.map((result, i) => (
            <DeepSearchResultCard key={result.id} result={result} rank={i + 1} />
          ))}
        </Box>
      ) : running ? (
        <Box sx={{ px: 1, py: 1 }}>
          <Typography sx={{ fontSize: '0.58rem', color: colors.text.dim, fontStyle: 'italic' }}>
            Running multi-source search and ranking…
          </Typography>
        </Box>
      ) : (
        <Box sx={{ px: 1, py: 0.85 }}>
          <Typography sx={{ fontSize: '0.58rem', color: colors.text.secondary, mb: providersLabel ? 0.35 : 0 }}>
            No ranked results met the quality threshold.
          </Typography>
          {!providersLabel && (
            <Typography sx={{ fontSize: '0.52rem', color: colors.text.dim, fontFamily: "'JetBrains Mono', monospace" }}>
              No search providers were recorded for this run.
            </Typography>
          )}
        </Box>
      )}
    </Box>
  );
}
