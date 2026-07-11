import { useState, useEffect, useCallback, useRef } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import CircularProgress from '@mui/material/CircularProgress';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import RefreshIcon from '@mui/icons-material/Refresh';
import ViewQuiltIcon from '@mui/icons-material/ViewQuilt';
import { PanelHeader } from './PanelHeader';
import { CanvasViewer } from './CanvasViewer';
import { canvases, type CanvasRecord } from '../api';
import { useApp } from '../store/AppContext';
import { colors } from '../theme';

function formatWhen(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: d.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined,
    hour: '2-digit',
    minute: '2-digit',
  });
}

function CanvasListItem({
  item,
  selected,
  onSelect,
  onDelete,
}: {
  item: CanvasRecord;
  selected: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) {
  return (
    <Box
      onClick={onSelect}
      sx={{
        mb: 0.7,
        p: 1,
        borderRadius: 1.5,
        cursor: 'pointer',
        bgcolor: selected ? 'rgba(34, 211, 238, 0.08)' : colors.bg.tertiary,
        border: `1px solid ${selected ? colors.border.strong : colors.border.default}`,
        boxShadow: selected ? '0 8px 22px rgba(0,0,0,0.18)' : 'none',
        transition: 'border-color 120ms ease, background 120ms ease, transform 120ms ease',
        '&:hover': { borderColor: colors.border.strong, transform: 'translateY(-1px)' },
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.75 }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.6, mb: 0.45 }}>
            <Typography sx={{
              fontSize: '0.48rem',
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: isInteractiveLabel(item) ? colors.accent.cyan : colors.text.dim,
              fontFamily: "'JetBrains Mono', monospace",
              border: `1px solid ${colors.border.default}`,
              borderRadius: 999,
              px: 0.55,
              py: 0.15,
              lineHeight: 1.4,
            }}>
              {item.contentFormat === 'canvas_tsx' ? 'Live' : 'Doc'}
            </Typography>
            <Typography sx={{ fontSize: '0.5rem', color: colors.text.dim, fontFamily: "'JetBrains Mono', monospace" }}>
              {formatWhen(item.createdAt)}
            </Typography>
          </Box>
          <Typography sx={{
            fontSize: '0.68rem',
            fontWeight: selected ? 700 : 600,
            color: colors.text.primary,
            fontFamily: "'JetBrains Mono', monospace",
            lineHeight: 1.25,
            mb: 0.35,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
            {item.title}
          </Typography>
          {item.excerpt && (
            <Typography sx={{
              fontSize: '0.6rem',
              color: colors.text.secondary,
              lineHeight: 1.35,
              display: '-webkit-box',
              WebkitLineClamp: 1,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}>
              {item.excerpt}
            </Typography>
          )}
        </Box>
        <Tooltip title="Delete canvas">
          <IconButton
            size="small"
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            sx={{ color: colors.text.dim, p: 0.25, '&:hover': { color: colors.accent.red } }}
          >
            <DeleteOutlineIcon sx={{ fontSize: 14 }} />
          </IconButton>
        </Tooltip>
      </Box>
    </Box>
  );
}

function isInteractiveLabel(item: CanvasRecord): boolean {
  return item.contentFormat === 'canvas_tsx';
}

export function CanvasPanel() {
  const { events } = useApp();
  const [items, setItems] = useState<CanvasRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<{
    contentMarkdown?: string;
    contentTsx?: string;
    compiledJs?: string;
    compileError?: string | null;
  } | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const selectedIdRef = useRef<string | null>(null);

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  const loadList = useCallback(async () => {
    setLoading(true);
    try {
      const { canvases: list } = await canvases.list({ limit: 100 });
      setItems(list);
      const currentSelectedId = selectedIdRef.current;
      if (list.length > 0 && !currentSelectedId) {
        setSelectedId(list[0]!.id);
      } else if (currentSelectedId && !list.some((c) => c.id === currentSelectedId)) {
        setSelectedId(list[0]?.id ?? null);
      }
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadList(); }, [loadList]);

  useEffect(() => {
    const last = events[events.length - 1];
    if (last?.type === 'canvas_created') void loadList();
  }, [events, loadList]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    void canvases.get(selectedId).then((payload) => {
      if (cancelled) return;
      setDetail(payload ? {
        contentMarkdown: payload.contentMarkdown,
        contentTsx: payload.contentTsx,
        compiledJs: payload.compiledJs,
        compileError: payload.compileError,
      } : null);
    }).catch(() => {
      if (!cancelled) setDetail(null);
    }).finally(() => {
      if (!cancelled) setDetailLoading(false);
    });
    return () => { cancelled = true; };
  }, [selectedId]);

  const selected = items.find((c) => c.id === selectedId) ?? null;

  const handleDelete = async (id: string) => {
    try {
      await canvases.delete(id);
      setItems((prev) => prev.filter((c) => c.id !== id));
      if (selectedId === id) {
        const rest = items.filter((c) => c.id !== id);
        setSelectedId(rest[0]?.id ?? null);
      }
    } catch { /* ignore */ }
  };

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', bgcolor: colors.bg.primary }}>
      <PanelHeader
        title="Canvases"
        subtitle="Interactive dashboards & reports — export as PDF"
        icon={<ViewQuiltIcon sx={{ fontSize: 18 }} />}
        action={(
          <Tooltip title="Refresh">
            <IconButton size="small" onClick={() => void loadList()} sx={{ color: colors.text.dim }}>
              <RefreshIcon sx={{ fontSize: 16 }} />
            </IconButton>
          </Tooltip>
        )}
      />

      <Box sx={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <Box sx={{
          width: { xs: '100%', md: 292 },
          maxWidth: { xs: '100%', md: 320 },
          flexShrink: 0,
          borderRight: { md: `1px solid ${colors.border.default}` },
          borderBottom: { xs: `1px solid ${colors.border.default}`, md: 'none' },
          overflow: 'auto',
          p: 1.1,
          bgcolor: colors.bg.secondary,
          display: { xs: selected ? 'none' : 'block', md: 'block' },
        }}>
          {loading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
              <CircularProgress size={22} />
            </Box>
          ) : items.length === 0 ? (
            <Typography sx={{ color: colors.text.dim, fontSize: '0.7rem', textAlign: 'center', py: 4, fontFamily: "'JetBrains Mono', monospace" }}>
              No canvases yet. Ask Agent-X to save a response as canvas, or use Save as Canvas on a message.
            </Typography>
          ) : (
            items.map((item) => (
              <CanvasListItem
                key={item.id}
                item={item}
                selected={item.id === selectedId}
                onSelect={() => setSelectedId(item.id)}
                onDelete={() => void handleDelete(item.id)}
              />
            ))
          )}
        </Box>

        <Box sx={{ flex: 1, minWidth: 0, display: { xs: selected ? 'flex' : 'none', md: 'flex' }, flexDirection: 'column' }}>
          {detailLoading ? (
            <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <CircularProgress size={24} />
            </Box>
          ) : selected && !detail ? (
            <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', p: 3 }}>
              <Typography sx={{ color: colors.accent.red, fontSize: '0.72rem', fontFamily: "'JetBrains Mono', monospace", textAlign: 'center' }}>
                Failed to load canvas content
              </Typography>
            </Box>
          ) : selected ? (
            <CanvasViewer
              canvas={selected}
              contentMarkdown={detail?.contentMarkdown}
              contentTsx={detail?.contentTsx}
              compiledJs={detail?.compiledJs}
              compileError={detail?.compileError ?? selected.compileError}
            />
          ) : (
            <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', p: 3 }}>
              <Typography sx={{ color: colors.text.dim, fontSize: '0.72rem', fontFamily: "'JetBrains Mono', monospace", textAlign: 'center' }}>
                Select a canvas to view
              </Typography>
            </Box>
          )}
        </Box>
      </Box>
    </Box>
  );
}
