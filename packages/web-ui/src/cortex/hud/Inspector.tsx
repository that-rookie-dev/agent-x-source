import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import CloseIcon from '@mui/icons-material/Close';
import CircularProgress from '@mui/material/CircularProgress';
import type { CortexNodeDetail } from '../api';
import { categoryStyle } from '../palette';
import { glassPanel, hudLabel, MONO } from './hudStyles';

export interface InspectorProps {
  detail: CortexNodeDetail | null;
  loading: boolean;
  onClose: () => void;
  onHop: (nodeId: string) => void;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <Box sx={{ display: 'flex', gap: 1, alignItems: 'baseline' }}>
      <Box component="span" sx={{ ...hudLabel, minWidth: 74, flexShrink: 0 }}>{label}</Box>
      <Box component="span" sx={{ fontFamily: MONO, fontSize: '0.62rem', color: '#c7d2f0', wordBreak: 'break-word' }}>{value}</Box>
    </Box>
  );
}

export function Inspector({ detail, loading, onClose, onHop }: InspectorProps) {
  if (!detail && !loading) return null;
  const style = detail ? categoryStyle(detail.node.category) : null;

  return (
    <Box sx={{
      ...glassPanel,
      position: 'absolute', top: 76, right: 16, width: 340, maxHeight: 'calc(100% - 170px)',
      display: 'flex', flexDirection: 'column', pointerEvents: 'auto', overflow: 'hidden',
    }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1.75, pt: 1.5, pb: 1 }}>
        {loading || !detail || !style ? (
          <>
            <CircularProgress size={14} sx={{ color: '#8fb4ff' }} />
            <Box component="span" sx={{ fontFamily: MONO, fontSize: '0.66rem', color: '#c7d2f0' }}>reading neuron…</Box>
          </>
        ) : (
          <>
            <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: style.css, boxShadow: `0 0 9px ${style.css}`, flexShrink: 0 }} />
            <Box component="span" sx={{ fontFamily: MONO, fontSize: '0.74rem', fontWeight: 600, color: '#e6ecff', flex: 1, wordBreak: 'break-word' }}>
              {detail.node.label}
            </Box>
          </>
        )}
        <IconButton size="small" onClick={onClose} sx={{ color: 'rgba(148,163,216,0.7)', '&:hover': { color: '#fff' } }}>
          <CloseIcon sx={{ fontSize: 15 }} />
        </IconButton>
      </Box>

      {detail && style && (
        <Box sx={{ px: 1.75, pb: 1.75, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 1.25 }}>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
            <Row label="type" value={style.name.toLowerCase()} />
            <Row label="recalled" value={`${detail.node.accessCount}×`} />
            {detail.node.confidence != null && <Row label="confidence" value={`${Math.round(detail.node.confidence * 100)}%`} />}
            <Row label="formed" value={new Date(detail.node.createdAt).toLocaleString()} />
            {detail.node.lastAccessedAt && <Row label="last recall" value={new Date(detail.node.lastAccessedAt).toLocaleString()} />}
          </Box>

          {detail.node.content && (
            <Box sx={{
              fontFamily: MONO, fontSize: '0.64rem', lineHeight: 1.6, color: '#aebadd',
              bgcolor: 'rgba(125,145,255,0.05)', border: '1px solid rgba(125,145,255,0.09)',
              borderRadius: '8px', p: 1.25, maxHeight: 180, overflowY: 'auto', whiteSpace: 'pre-wrap',
            }}>
              {detail.node.content}
            </Box>
          )}

          {detail.connections.length > 0 && (
            <Box>
              <Box sx={{ ...hudLabel, mb: 0.6 }}>synapses · {detail.connections.length}</Box>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.35 }}>
                {detail.connections.slice(0, 24).map((c, i) => (
                  <Box
                    key={`${c.neighborId}-${i}`}
                    onClick={() => onHop(c.neighborId)}
                    sx={{
                      display: 'flex', alignItems: 'center', gap: 0.75, px: 0.75, py: 0.4,
                      borderRadius: '6px', cursor: 'pointer',
                      '&:hover': { bgcolor: 'rgba(125,145,255,0.09)' },
                    }}
                  >
                    <Box component="span" sx={{ fontFamily: MONO, fontSize: '0.52rem', color: 'rgba(143,180,255,0.8)', letterSpacing: '0.05em', minWidth: 86, flexShrink: 0 }}>
                      {c.relationshipType.toLowerCase().replace(/_/g, ' ')}
                    </Box>
                    <Box component="span" sx={{ fontFamily: MONO, fontSize: '0.62rem', color: '#c7d2f0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {c.neighborLabel ?? c.neighborId.slice(0, 8)}
                    </Box>
                  </Box>
                ))}
              </Box>
            </Box>
          )}
        </Box>
      )}
    </Box>
  );
}
