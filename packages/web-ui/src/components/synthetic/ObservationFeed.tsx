import { useMemo, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Typography from '@mui/material/Typography';
import { colors, MONO } from '../../theme';
import type { ObservedPatternRecord } from '../../api';

function relative(ms: number): string {
  const d = Date.now() - ms;
  if (d < 60_000) return 'just now';
  if (d < 3_600_000) return `${Math.round(d / 60_000)}m ago`;
  if (d < 86_400_000) return `${Math.round(d / 3_600_000)}h ago`;
  return `${Math.round(d / 86_400_000)}d ago`;
}

const PAGE = 50;

export function ObservationFeed({
  observations,
  onAcknowledge,
  onIgnore,
  onGenerate,
  onCreateFromPrompt,
  onFindSimilar,
}: {
  observations: ObservedPatternRecord[];
  onAcknowledge: (id: string) => void;
  onIgnore: (id: string) => void;
  onGenerate: (id: string) => void;
  onCreateFromPrompt?: () => void;
  onFindSimilar?: (pattern: string) => void;
}) {
  const [minConf, setMinConf] = useState(0);
  const [minFreq, setMinFreq] = useState(0);
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<string | null>(null);
  const [ignoreId, setIgnoreId] = useState<string | null>(null);
  const [permanent, setPermanent] = useState(false);

  const rows = useMemo(
    () => observations.filter((o) => o.confidence * 100 >= minConf && o.frequency >= minFreq),
    [observations, minConf, minFreq],
  );
  const slice = rows.slice(page * PAGE, page * PAGE + PAGE);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (observations.length === 0) {
    return (
      <Box>
        <Typography sx={{ fontSize: '0.75rem', color: colors.text.dim, fontFamily: MONO }}>
          No patterns observed yet. The agent will start detecting recurring tasks as you work — or create one from a prompt.
        </Typography>
        {onCreateFromPrompt && (
          <Button size="small" title="Create a capability from a prompt" onClick={onCreateFromPrompt} sx={{ mt: 1, fontFamily: MONO, textTransform: 'none', fontSize: '0.62rem' }}>
            Create from prompt…
          </Button>
        )}
      </Box>
    );
  }

  return (
    <Box>
      <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', mb: 1, flexWrap: 'wrap' }}>
        <Typography sx={{ fontSize: '0.65rem', fontFamily: MONO, color: colors.text.dim }}>
          Min confidence {minConf}%
        </Typography>
        <input
          aria-label="Minimum confidence"
          title="Filter by minimum confidence"
          type="range"
          min={0}
          max={100}
          value={minConf}
          onChange={(e) => { setMinConf(Number(e.target.value)); setPage(0); }}
        />
        <Typography sx={{ fontSize: '0.65rem', fontFamily: MONO, color: colors.text.dim }}>
          Min frequency {minFreq}
        </Typography>
        <input
          aria-label="Minimum frequency"
          title="Filter by minimum frequency"
          type="range"
          min={0}
          max={10}
          value={minFreq}
          onChange={(e) => { setMinFreq(Number(e.target.value)); setPage(0); }}
        />
        {onCreateFromPrompt && (
          <Button size="small" title="Create a capability from a prompt" onClick={onCreateFromPrompt} sx={{ fontFamily: MONO, textTransform: 'none', fontSize: '0.62rem' }}>
            Create from prompt…
          </Button>
        )}
      </Box>
      {selected.size > 0 && (
        <Box sx={{ display: 'flex', gap: 0.75, mb: 1 }}>
          <Button size="small" title="Acknowledge selected patterns" onClick={() => { for (const id of selected) onAcknowledge(id); setSelected(new Set()); }} sx={{ fontFamily: MONO, textTransform: 'none', fontSize: '0.62rem' }}>
            Acknowledge Selected
          </Button>
          <Button size="small" title="Generate capabilities from selected patterns" onClick={() => { for (const id of selected) onGenerate(id); setSelected(new Set()); }} sx={{ fontFamily: MONO, textTransform: 'none', fontSize: '0.62rem' }}>
            Generate Selected
          </Button>
        </Box>
      )}
      {slice.map((row) => (
        <Box key={row.id} sx={{ py: 1, borderBottom: `1px solid ${colors.border.subtle}` }}>
          <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'flex-start' }}>
            <Checkbox
              size="small"
              checked={selected.has(row.id)}
              onChange={() => toggle(row.id)}
              inputProps={{ 'aria-label': `Select ${row.pattern}` }}
              sx={{ p: 0.25 }}
            />
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography
                onClick={() => setExpanded(expanded === row.id ? null : row.id)}
                title="Expand pattern details"
                sx={{ fontSize: '0.75rem', fontFamily: MONO, color: colors.text.primary, cursor: 'pointer' }}
              >
                {row.pattern}
              </Typography>
              <Typography sx={{ fontSize: '0.62rem', color: colors.text.dim, fontFamily: MONO, mt: 0.25 }}>
                ×{row.frequency} · {Math.round(row.confidence * 100)}% · first {relative(row.firstObservedAt)} · last {relative(row.lastObservedAt)}
              </Typography>
              <Typography sx={{ fontSize: '0.65rem', color: colors.text.secondary, mt: 0.4 }}>{row.context.slice(0, 180)}</Typography>
              {expanded === row.id && (
                <Box sx={{ mt: 0.75, p: 1, border: `1px solid ${colors.border.subtle}`, borderRadius: 0.5 }}>
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, mb: 0.75 }}>
                    <Box sx={{ display: 'flex', gap: 0.75, alignItems: 'center' }}>
                      <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: colors.accent.blue }} />
                      <Typography sx={{ fontSize: '0.62rem', fontFamily: MONO, color: colors.text.dim }}>
                        first observed {relative(row.firstObservedAt)}
                      </Typography>
                    </Box>
                    <Box sx={{ display: 'flex', gap: 0.75, alignItems: 'flex-start' }}>
                      <Box sx={{ mt: 0.35, width: 6, height: 6, borderRadius: '50%', flexShrink: 0, bgcolor: colors.accent.cyan }} />
                      <Typography sx={{ fontSize: '0.65rem', fontFamily: MONO, color: colors.text.secondary }}>
                        {row.context}
                      </Typography>
                    </Box>
                    <Box sx={{ display: 'flex', gap: 0.75, alignItems: 'center' }}>
                      <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: colors.accent.blue }} />
                      <Typography sx={{ fontSize: '0.62rem', fontFamily: MONO, color: colors.text.dim }}>
                        last observed {relative(row.lastObservedAt)}
                      </Typography>
                    </Box>
                  </Box>
                  {row.exampleInputs && row.exampleInputs.length > 0 && (
                    <Typography component="pre" sx={{ fontSize: '0.6rem', fontFamily: MONO, color: colors.text.dim, mt: 0.5 }}>
                      {JSON.stringify(row.exampleInputs, null, 2)}
                    </Typography>
                  )}
                  <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap', mt: 0.5 }}>
                    <Button size="small" title="Create a tool for this pattern" onClick={() => onGenerate(row.id)} sx={{ fontFamily: MONO, textTransform: 'none', fontSize: '0.62rem' }}>
                      Create a tool for this pattern?
                    </Button>
                    {onFindSimilar && (
                      <Button
                        size="small"
                        title="Find capabilities matching this pattern"
                        onClick={() => onFindSimilar(row.pattern)}
                        sx={{ fontFamily: MONO, textTransform: 'none', fontSize: '0.62rem' }}
                      >
                        Find similar capabilities
                      </Button>
                    )}
                  </Box>
                </Box>
              )}
              <Box sx={{ display: 'flex', gap: 0.75, mt: 0.75 }}>
                <Button size="small" title="Acknowledge this pattern" onClick={() => onAcknowledge(row.id)} sx={{ fontFamily: MONO, textTransform: 'none', fontSize: '0.62rem' }}>Acknowledge</Button>
                <Button size="small" title="Generate a capability for this pattern" onClick={() => onGenerate(row.id)} sx={{ fontFamily: MONO, textTransform: 'none', fontSize: '0.62rem' }}>Generate</Button>
                <Button size="small" title="Ignore this pattern" color="error" onClick={() => { setIgnoreId(row.id); setPermanent(false); }} sx={{ fontFamily: MONO, textTransform: 'none', fontSize: '0.62rem' }}>Ignore</Button>
              </Box>
            </Box>
          </Box>
        </Box>
      ))}
      {pages > 1 && (
        <Box sx={{ display: 'flex', gap: 1, mt: 1, alignItems: 'center' }}>
          <Button size="small" title="Previous page" disabled={page === 0} onClick={() => setPage((p) => p - 1)} sx={{ fontFamily: MONO, textTransform: 'none', fontSize: '0.62rem' }}>Prev</Button>
          <Typography sx={{ fontSize: '0.62rem', fontFamily: MONO, color: colors.text.dim }}>{page + 1} / {pages}</Typography>
          <Button size="small" title="Next page" disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)} sx={{ fontFamily: MONO, textTransform: 'none', fontSize: '0.62rem' }}>Next</Button>
        </Box>
      )}
      <Dialog open={!!ignoreId} onClose={() => setIgnoreId(null)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontFamily: MONO, fontSize: '0.85rem' }}>Ignore this pattern?</DialogTitle>
        <DialogContent>
          <label style={{ fontFamily: MONO, fontSize: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
            <input type="checkbox" checked={permanent} onChange={(e) => setPermanent(e.target.checked)} />
            Add to ignore list permanently
          </label>
        </DialogContent>
        <DialogActions>
          <Button title="Cancel" onClick={() => setIgnoreId(null)} sx={{ fontFamily: MONO, textTransform: 'none' }}>Cancel</Button>
          <Button
            title="Confirm ignore"
            onClick={() => {
              if (ignoreId) onIgnore(ignoreId);
              setIgnoreId(null);
              void permanent;
            }}
            sx={{ fontFamily: MONO, textTransform: 'none' }}
          >
            Ignore
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
