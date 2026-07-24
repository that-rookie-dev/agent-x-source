import { useState, useEffect, useCallback, useRef } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import CircularProgress from '@mui/material/CircularProgress';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import RefreshIcon from '@mui/icons-material/Refresh';
import ArticleOutlinedIcon from '@mui/icons-material/ArticleOutlined';
import { PanelHeader } from './PanelHeader';
import { MarkdownViewer } from './MarkdownViewer';
import { markdownDocuments, type MarkdownDocumentRecord } from '../api';
import { groupMarkdownDocumentsByDay } from '../markdown/markdown-list-groups';
import { useApp } from '../store/AppContext';
import { colors, MONO, PANEL_SIDE_LIST_WIDTH } from '../theme';

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function DateGroupDivider({ label, first }: { label: string; first?: boolean }) {
  return (
    <Box sx={{
      display: 'flex',
      alignItems: 'center',
      gap: 0.6,
      mt: first ? 0.25 : 1.1,
      mb: 0.55,
      px: 0.15,
    }}>
      <Box sx={{ flex: 1, height: '1px', bgcolor: colors.border.subtle }} />
      <Typography sx={{
        fontSize: '0.48rem',
        letterSpacing: '0.09em',
        textTransform: 'uppercase',
        color: colors.text.dim,
        fontFamily: MONO,
        whiteSpace: 'nowrap',
        flexShrink: 0,
      }}>
        [{label}]
      </Typography>
      <Box sx={{ flex: 1, height: '1px', bgcolor: colors.border.subtle }} />
    </Box>
  );
}

function MarkdownListItem({
  item,
  selected,
  onSelect,
  onDelete,
}: {
  item: MarkdownDocumentRecord;
  selected: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) {
  return (
    <Box
      onClick={onSelect}
      sx={{
        mb: 0.6,
        p: 0.9,
        borderRadius: 1.25,
        cursor: 'pointer',
        bgcolor: selected ? 'rgba(34, 211, 238, 0.08)' : colors.bg.tertiary,
        border: `1px solid ${selected ? colors.border.strong : colors.border.default}`,
        transition: 'border-color 120ms ease, background 120ms ease',
        '&:hover': { borderColor: colors.border.strong },
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.75 }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography sx={{ fontSize: '0.5rem', color: colors.text.dim, fontFamily: MONO, mb: 0.35 }}>
            {formatTime(item.createdAt)}
          </Typography>
          <Typography sx={{
            fontSize: '0.66rem',
            fontWeight: selected ? 700 : 600,
            color: colors.text.primary,
            fontFamily: "'JetBrains Mono', monospace",
            lineHeight: 1.25,
            mb: 0.3,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
            {item.title}
          </Typography>
          {item.excerpt && (
            <Typography sx={{
              fontSize: '0.58rem',
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
        <Tooltip title="Delete document">
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

export function MarkdownPanel() {
  const { events } = useApp();
  const [items, setItems] = useState<MarkdownDocumentRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ contentMarkdown?: string } | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const selectedIdRef = useRef<string | null>(null);

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  const loadList = useCallback(async () => {
    setLoading(true);
    try {
      const { documents: list } = await markdownDocuments.list({ limit: 100 });
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
    if (last?.type === 'markdown_created') void loadList();
  }, [events, loadList]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    void markdownDocuments.get(selectedId).then((payload) => {
      if (cancelled) return;
      setDetail(payload ? { contentMarkdown: payload.contentMarkdown } : null);
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
      await markdownDocuments.delete(id);
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
        title="Markdown"
        subtitle="Saved reports & replies — export as PDF"
        icon={<ArticleOutlinedIcon sx={{ fontSize: 18 }} />}
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
          width: { xs: '100%', md: PANEL_SIDE_LIST_WIDTH },
          flexShrink: 0,
          borderRight: { md: `1px solid ${colors.border.default}` },
          borderBottom: { xs: `1px solid ${colors.border.default}`, md: 'none' },
          overflow: 'auto',
          p: 1,
          bgcolor: colors.bg.secondary,
          display: { xs: selected ? 'none' : 'block', md: 'block' },
        }}>
          {loading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
              <CircularProgress size={22} />
            </Box>
          ) : items.length === 0 ? (
            <Typography sx={{ color: colors.text.dim, fontSize: '0.7rem', textAlign: 'center', py: 4, fontFamily: "'JetBrains Mono', monospace" }}>
              No documents yet. Ask Agent-X to save a response as markdown, or use Save as Markdown on a message.
            </Typography>
          ) : (
            groupMarkdownDocumentsByDay(items).map((group, groupIdx) => (
              <Box key={group.dayKey || `ungrouped-${groupIdx}`}>
                {group.label ? (
                  <DateGroupDivider label={group.label} first={groupIdx === 0} />
                ) : null}
                {group.items.map((item) => (
                  <MarkdownListItem
                    key={item.id}
                    item={item}
                    selected={item.id === selectedId}
                    onSelect={() => setSelectedId(item.id)}
                    onDelete={() => void handleDelete(item.id)}
                  />
                ))}
              </Box>
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
                Failed to load document
              </Typography>
            </Box>
          ) : selected ? (
            <MarkdownViewer
              document={selected}
              contentMarkdown={detail?.contentMarkdown}
            />
          ) : (
            <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', p: 3 }}>
              <Typography sx={{ color: colors.text.dim, fontSize: '0.72rem', fontFamily: "'JetBrains Mono', monospace", textAlign: 'center' }}>
                Select a document to view
              </Typography>
            </Box>
          )}
        </Box>
      </Box>
    </Box>
  );
}
