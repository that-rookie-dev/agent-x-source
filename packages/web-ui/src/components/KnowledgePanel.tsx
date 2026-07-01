import { useState, useEffect, useCallback, useMemo } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import Drawer from '@mui/material/Drawer';
import LinearProgress from '@mui/material/LinearProgress';
import InputAdornment from '@mui/material/InputAdornment';
import {
  knowledge,
  rag,
  type MemorySource,
  type MemoryNode,
  type MemoryNodeCategory,
  type RAGResult,
} from '../api';
import { colors } from '../theme';
import { PanelHeader } from './PanelHeader';

import LibraryBooksIcon from '@mui/icons-material/LibraryBooks';
import BrowseIcon from '@mui/icons-material/ViewList';
import SearchIcon from '@mui/icons-material/Search';
import StorageIcon from '@mui/icons-material/Storage';
import ArticleIcon from '@mui/icons-material/Article';
import LightbulbIcon from '@mui/icons-material/Lightbulb';
import ChatBubbleIcon from '@mui/icons-material/ChatBubble';
import BuildIcon from '@mui/icons-material/Build';
import CloseIcon from '@mui/icons-material/Close';
import RefreshIcon from '@mui/icons-material/Refresh';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import ScheduleIcon from '@mui/icons-material/Schedule';

// ─── Constants ───

type ViewId = 'library' | 'browse' | 'search';

const CATEGORY_META: Record<MemoryNodeCategory, { label: string; icon: typeof ArticleIcon; color: string }> = {
  source_doc: { label: 'Documents', icon: ArticleIcon, color: '#58a6ff' },
  semantic: { label: 'Concepts', icon: LightbulbIcon, color: '#d29922' },
  episodic: { label: 'Sessions', icon: ChatBubbleIcon, color: '#3fb950' },
  tool: { label: 'Tools', icon: BuildIcon, color: '#bc8cff' },
  persona: { label: 'Personas', icon: LibraryBooksIcon, color: '#f85149' },
  system: { label: 'System', icon: StorageIcon, color: '#8b8b8b' },
};

const KIND_ICON: Record<string, string> = {
  pdf: '📄',
  text: '📝',
  markdown: '📋',
  json: '🔧',
  web: '🌐',
};

const VIEW_BUTTONS: { id: ViewId; label: string; icon: typeof LibraryBooksIcon }[] = [
  { id: 'library', label: 'Library', icon: LibraryBooksIcon },
  { id: 'browse', label: 'Browse', icon: BrowseIcon },
  { id: 'search', label: 'Search', icon: SearchIcon },
];

// ─── Main Panel ───

export function KnowledgePanel() {
  const [view, setView] = useState<ViewId>('library');
  const [selectedSource, setSelectedSource] = useState<MemorySource | null>(null);
  const [selectedNode, setSelectedNode] = useState<MemoryNode | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const handleSelectSource = useCallback((source: MemorySource | null) => {
    setSelectedSource(source);
    setView('browse');
  }, []);

  const handleSelectNode = useCallback((node: MemoryNode) => {
    setSelectedNode(node);
    setDrawerOpen(true);
  }, []);

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <PanelHeader
        title="Knowledge"
        subtitle="Browse and search what the agent knows"
        icon={<LibraryBooksIcon sx={{ fontSize: 20 }} />}
        action={
          <Box sx={{ display: 'flex', gap: 0.5, bgcolor: colors.bg.tertiary, borderRadius: 1, p: 0.25 }}>
            {VIEW_BUTTONS.map((btn) => {
              const Icon = btn.icon;
              const isActive = view === btn.id;
              return (
                <Tooltip key={btn.id} title={btn.label}>
                  <IconButton
                    size="small"
                    onClick={() => setView(btn.id)}
                    sx={{
                      width: 28, height: 28, borderRadius: 0.5,
                      color: isActive ? colors.text.primary : colors.text.dim,
                      bgcolor: isActive ? colors.border.default : 'transparent',
                      '&:hover': { bgcolor: colors.border.default },
                      transition: 'all 0.15s',
                    }}
                  >
                    <Icon sx={{ fontSize: 15 }} />
                  </IconButton>
                </Tooltip>
              );
            })}
          </Box>
        }
      />

      <Box sx={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {view === 'library' && <LibraryView onSelectSource={handleSelectSource} />}
        {view === 'browse' && (
          <BrowseView
            selectedSource={selectedSource}
            onSelectNode={handleSelectNode}
            onBackToLibrary={() => { setSelectedSource(null); setView('library'); }}
          />
        )}
        {view === 'search' && <SearchView />}
      </Box>

      <NodeDetailDrawer node={selectedNode} open={drawerOpen} onClose={() => setDrawerOpen(false)} />
    </Box>
  );
}

// ─── Library View ───

function LibraryView({ onSelectSource }: { onSelectSource: (source: MemorySource) => void }) {
  const [sources, setSources] = useState<MemorySource[]>([]);
  const [graphData, setGraphData] = useState<{ nodes: MemoryNode[]; edges: unknown[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [ragStatus, setRagStatus] = useState<{ enabled: boolean; chunkCount: number } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [srcs, graph, status] = await Promise.all([
        knowledge.sources().catch(() => []),
        knowledge.graph({ limit: 5000 }).catch(() => ({ nodes: [], edges: [] })),
        rag.status().catch(() => null),
      ]);
      setSources(srcs);
      setGraphData(graph);
      setRagStatus(status);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Auto-refresh when a RAG Studio ingestion job completes (cross-panel event).
  useEffect(() => {
    const handler = () => { void load(); };
    window.addEventListener('ragstudio:job-complete', handler);
    return () => window.removeEventListener('ragstudio:job-complete', handler);
  }, [load]);

  // Periodic refresh every 30s (catches background ingestion completions).
  useEffect(() => {
    const interval = setInterval(() => { void load(); }, 30000);
    return () => clearInterval(interval);
  }, [load]);

  // Count nodes per source
  const sourceNodeCounts = useMemo(() => {
    const counts = new Map<string, number>();
    if (graphData) {
      for (const node of graphData.nodes) {
        if (node.sourceId) {
          counts.set(node.sourceId, (counts.get(node.sourceId) ?? 0) + 1);
        }
      }
    }
    return counts;
  }, [graphData]);

  // Count nodes by category
  const categoryCounts = useMemo(() => {
    const counts = new Map<MemoryNodeCategory, number>();
    if (graphData) {
      for (const node of graphData.nodes) {
        counts.set(node.category, (counts.get(node.category) ?? 0) + 1);
      }
    }
    return counts;
  }, [graphData]);

  const totalNodes = graphData?.nodes.length ?? 0;
  const totalEdges = graphData?.edges.length ?? 0;

  return (
    <Box sx={{ flex: 1, overflow: 'auto', p: 3 }}>
      {/* Stats Bar */}
      <Box sx={{ display: 'flex', gap: 1.5, mb: 3 }}>
        <StatPill label="Sources" value={sources.length} color={colors.accent.blue} />
        <StatPill label="Knowledge Entries" value={totalNodes} color={colors.accent.green} />
        <StatPill label="Connections" value={totalEdges} color={colors.accent.purple} />
        {ragStatus && ragStatus.chunkCount > 0 && (
          <StatPill label="Indexed Chunks" value={ragStatus.chunkCount} color={colors.accent.orange} />
        )}
      </Box>

      {/* Category Overview */}
      {totalNodes > 0 && (
        <Box sx={{ mb: 3 }}>
          <SectionLabel>By Category</SectionLabel>
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            {(Object.entries(CATEGORY_META) as [MemoryNodeCategory, typeof CATEGORY_META[MemoryNodeCategory]][])
              .map(([cat, meta]) => {
                const count = categoryCounts.get(cat) ?? 0;
                if (count === 0) return null;
                const Icon = meta.icon;
                return (
                  <Chip
                    key={cat}
                    icon={<Icon sx={{ fontSize: 14, color: meta.color }} />}
                    label={`${meta.label} · ${count}`}
                    size="small"
                    sx={{
                      fontSize: '0.65rem',
                      fontFamily: "'JetBrains Mono', monospace",
                      bgcolor: meta.color + '10',
                      border: `1px solid ${meta.color}25`,
                      color: colors.text.secondary,
                      '& .MuiChip-icon': { ml: 0.5 },
                    }}
                  />
                );
              })}
          </Box>
        </Box>
      )}

      {/* Sources Grid */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
        <SectionLabel>Knowledge Sources</SectionLabel>
        <IconButton size="small" onClick={load} sx={{ color: colors.text.dim }}>
          <RefreshIcon sx={{ fontSize: 14 }} />
        </IconButton>
      </Box>

      {loading && <LinearProgress sx={{ mb: 2 }} />}

      {sources.length === 0 && !loading && (
        <Box sx={{ textAlign: 'center', py: 6 }}>
          <StorageIcon sx={{ fontSize: 40, color: colors.text.dim, mb: 1, opacity: 0.3 }} />
          <Typography sx={{ fontSize: '0.8rem', color: colors.text.dim, mb: 0.5 }}>
            No knowledge sources yet
          </Typography>
          <Typography sx={{ fontSize: '0.7rem', color: colors.text.tertiary }}>
            Upload documents via RAG Studio to populate the knowledge base
          </Typography>
        </Box>
      )}

      <Box sx={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
        gap: 1.5,
      }}>
        {sources.map((source) => {
          const nodeCount = sourceNodeCounts.get(source.id) ?? 0;
          const kindEmoji = KIND_ICON[source.kind] ?? '📄';
          return (
            <Box
              key={source.id}
              onClick={() => onSelectSource(source)}
              sx={{
                cursor: 'pointer',
                p: 2,
                borderRadius: 1.5,
                border: `1px solid ${colors.border.default}`,
                bgcolor: colors.bg.tertiary,
                transition: 'all 0.15s',
                position: 'relative',
                overflow: 'hidden',
                '&:hover': {
                  borderColor: source.colorHex + '80',
                  bgcolor: colors.bg.hover,
                  transform: 'translateY(-1px)',
                  boxShadow: `0 4px 12px ${source.colorHex}15`,
                },
                '&::before': {
                  content: '""',
                  position: 'absolute',
                  top: 0, left: 0, right: 0,
                  height: 3,
                  bgcolor: source.colorHex,
                  opacity: 0.6,
                },
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                <Typography sx={{ fontSize: '1.2rem' }}>{kindEmoji}</Typography>
                <Typography sx={{
                  fontSize: '0.8rem',
                  fontWeight: 600,
                  color: colors.text.primary,
                  flex: 1,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}>
                  {source.name}
                </Typography>
              </Box>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1 }}>
                <Chip
                  size="small"
                  label={`${nodeCount} entries`}
                  sx={{
                    fontSize: '0.55rem',
                    height: 18,
                    fontFamily: "'JetBrains Mono', monospace",
                    bgcolor: colors.bg.surface,
                    color: colors.text.dim,
                    border: `1px solid ${colors.border.subtle}`,
                  }}
                />
                <Chip
                  size="small"
                  label={source.kind.toUpperCase()}
                  sx={{
                    fontSize: '0.5rem',
                    height: 18,
                    fontFamily: "'JetBrains Mono', monospace",
                    bgcolor: source.colorHex + '15',
                    color: source.colorHex,
                    border: `1px solid ${source.colorHex}30`,
                  }}
                />
              </Box>
              <Typography sx={{ fontSize: '0.55rem', color: colors.text.dim, mt: 1, display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <ScheduleIcon sx={{ fontSize: 10 }} />
                {new Date(source.createdAt).toLocaleDateString()}
              </Typography>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}

// ─── Browse View ───

function BrowseView({
  selectedSource,
  onSelectNode,
  onBackToLibrary,
}: {
  selectedSource: MemorySource | null;
  onSelectNode: (node: MemoryNode) => void;
  onBackToLibrary: () => void;
}) {
  const [nodes, setNodes] = useState<MemoryNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<MemoryNodeCategory | 'all'>('all');
  const [textFilter, setTextFilter] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (selectedSource) {
        const result = await knowledge.sourceNodes(selectedSource.id, { limit: 500 });
        setNodes(result.nodes);
      } else {
        const result = await knowledge.graph({ limit: 500 });
        setNodes(result.nodes);
      }
    } catch { setNodes([]); }
    finally { setLoading(false); }
  }, [selectedSource]);

  useEffect(() => { load(); }, [load]);

  const filteredNodes = useMemo(() => {
    let result = nodes;
    if (filter !== 'all') {
      result = result.filter((n) => n.category === filter);
    }
    if (textFilter.trim()) {
      const q = textFilter.toLowerCase();
      result = result.filter((n) =>
        n.label.toLowerCase().includes(q) || n.content.toLowerCase().includes(q),
      );
    }
    return result;
  }, [nodes, filter, textFilter]);

  const availableCategories = useMemo(() => {
    const cats = new Set<MemoryNodeCategory>();
    for (const n of nodes) cats.add(n.category);
    return Array.from(cats);
  }, [nodes]);

  return (
    <Box sx={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      {/* Filter Bar */}
      <Box sx={{
        flexShrink: 0,
        px: 2, py: 1.5,
        borderBottom: `1px solid ${colors.border.default}`,
        bgcolor: colors.bg.secondary,
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        flexWrap: 'wrap',
      }}>
        {selectedSource && (
          <IconButton size="small" onClick={onBackToLibrary} sx={{ color: colors.text.dim, mr: 0.5 }}>
            <ArrowBackIcon sx={{ fontSize: 16 }} />
          </IconButton>
        )}

        {selectedSource && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mr: 1 }}>
            <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: selectedSource.colorHex }} />
            <Typography sx={{ fontSize: '0.75rem', color: colors.text.secondary, fontWeight: 600 }}>
              {selectedSource.name}
            </Typography>
          </Box>
        )}

        {/* Category Filter Chips */}
        <Chip
          size="small"
          label="All"
          onClick={() => setFilter('all')}
          sx={{
            fontSize: '0.6rem', height: 22,
            fontFamily: "'JetBrains Mono', monospace",
            bgcolor: filter === 'all' ? colors.accent.blue + '20' : colors.bg.tertiary,
            border: `1px solid ${filter === 'all' ? colors.accent.blue + '50' : colors.border.default}`,
            color: filter === 'all' ? colors.accent.blue : colors.text.dim,
            cursor: 'pointer',
          }}
        />
        {availableCategories.map((cat) => {
          const meta = CATEGORY_META[cat];
          if (!meta) return null;
          const isActive = filter === cat;
          return (
            <Chip
              key={cat}
              size="small"
              label={meta.label}
              onClick={() => setFilter(cat)}
              sx={{
                fontSize: '0.6rem', height: 22,
                fontFamily: "'JetBrains Mono', monospace",
                bgcolor: isActive ? meta.color + '20' : colors.bg.tertiary,
                border: `1px solid ${isActive ? meta.color + '50' : colors.border.default}`,
                color: isActive ? meta.color : colors.text.dim,
                cursor: 'pointer',
              }}
            />
          );
        })}

        <Box sx={{ flex: 1 }} />

        {/* Text Filter */}
        <TextField
          size="small"
          placeholder="Filter…"
          value={textFilter}
          onChange={(e) => setTextFilter(e.target.value)}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon sx={{ fontSize: 14, color: colors.text.dim }} />
              </InputAdornment>
            ),
          }}
          sx={{
            width: 160,
            '& .MuiOutlinedInput-root': {
              fontSize: '0.7rem',
              color: colors.text.secondary,
              bgcolor: colors.bg.tertiary,
              '& fieldset': { borderColor: colors.border.default },
            },
          }}
        />
      </Box>

      {/* Node List */}
      <Box sx={{ flex: 1, overflow: 'auto', p: 2 }}>
        {loading && <LinearProgress />}

        {!loading && filteredNodes.length === 0 && (
          <Box sx={{ textAlign: 'center', py: 6 }}>
            <BrowseIcon sx={{ fontSize: 36, color: colors.text.dim, mb: 1, opacity: 0.3 }} />
            <Typography sx={{ fontSize: '0.75rem', color: colors.text.dim }}>
              {textFilter ? 'No entries match your filter' : 'No knowledge entries found'}
            </Typography>
          </Box>
        )}

        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
          {filteredNodes.map((node) => (
            <NodeCard key={node.id} node={node} onClick={() => onSelectNode(node)} />
          ))}
        </Box>
      </Box>
    </Box>
  );
}

// ─── Search View ───

function SearchView() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<RAGResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [recentSearches, setRecentSearches] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('agx:knowledge-recent') ?? '[]'); } catch { return []; }
  });

  const handleSearch = useCallback(async (q?: string) => {
    const searchQuery = (q ?? query).trim();
    if (!searchQuery) return;
    setLoading(true);
    setSearched(true);
    setQuery(searchQuery);
    try {
      const res = await rag.search(searchQuery, 20);
      setResults(res);
      // Save to recent
      setRecentSearches((prev) => {
        const next = [searchQuery, ...prev.filter((s) => s !== searchQuery)].slice(0, 8);
        localStorage.setItem('agx:knowledge-recent', JSON.stringify(next));
        return next;
      });
    } catch { setResults([]); }
    finally { setLoading(false); }
  }, [query]);

  return (
    <Box sx={{ flex: 1, overflow: 'auto', p: 3 }}>
      {/* Search Input */}
      <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
        <TextField
          fullWidth
          placeholder="Ask anything — search what the agent knows…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleSearch(); }}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon sx={{ fontSize: 18, color: colors.accent.blue }} />
              </InputAdornment>
            ),
          }}
          sx={{
            '& .MuiOutlinedInput-root': {
              fontSize: '0.85rem',
              color: colors.text.primary,
              bgcolor: colors.bg.tertiary,
              '& fieldset': { borderColor: colors.border.default },
              '&:hover fieldset': { borderColor: colors.border.strong },
              '&.Mui-focused fieldset': { borderColor: colors.accent.blue },
            },
          } as any}
        />
        <Button
          variant="contained"
          onClick={() => handleSearch()}
          disabled={loading || !query.trim()}
          sx={{
            bgcolor: colors.accent.blue,
            fontSize: '0.7rem',
            textTransform: 'none',
            px: 2,
            '&:hover': { bgcolor: colors.accent.blue + 'cc' },
          }}
        >
          Search
        </Button>
      </Box>

      {/* Recent Searches */}
      {!searched && recentSearches.length > 0 && (
        <Box sx={{ mb: 2 }}>
          <SectionLabel>Recent Searches</SectionLabel>
          <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
            {recentSearches.map((s, i) => (
              <Chip
                key={i}
                size="small"
                label={s}
                onClick={() => handleSearch(s)}
                sx={{
                  fontSize: '0.65rem',
                  fontFamily: "'JetBrains Mono', monospace",
                  bgcolor: colors.bg.tertiary,
                  border: `1px solid ${colors.border.default}`,
                  color: colors.text.secondary,
                  cursor: 'pointer',
                  '&:hover': { borderColor: colors.accent.blue + '50' },
                }}
              />
            ))}
          </Box>
        </Box>
      )}

      {loading && <LinearProgress sx={{ mb: 2 }} />}

      {/* Results */}
      {searched && !loading && results.length === 0 && (
        <Box sx={{ textAlign: 'center', py: 6 }}>
          <SearchIcon sx={{ fontSize: 36, color: colors.text.dim, mb: 1, opacity: 0.3 }} />
          <Typography sx={{ fontSize: '0.8rem', color: colors.text.dim, mb: 0.5 }}>
            No results found
          </Typography>
          <Typography sx={{ fontSize: '0.7rem', color: colors.text.tertiary }}>
            Try different keywords or add more documents via RAG Studio
          </Typography>
        </Box>
      )}

      {results.length > 0 && (
        <Box>
          <SectionLabel>{results.length} Results</SectionLabel>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
            {results.map((r, i) => (
              <SearchResultCard key={i} result={r} />
            ))}
          </Box>
        </Box>
      )}

      {/* Empty State */}
      {!searched && recentSearches.length === 0 && (
        <Box sx={{ textAlign: 'center', py: 8 }}>
          <SearchIcon sx={{ fontSize: 48, color: colors.text.dim, mb: 2, opacity: 0.2 }} />
          <Typography sx={{ fontSize: '0.85rem', color: colors.text.secondary, mb: 0.5 }}>
            Search the Knowledge Base
          </Typography>
          <Typography sx={{ fontSize: '0.7rem', color: colors.text.dim, maxWidth: 320, mx: 'auto' }}>
            Type a question or keywords to find relevant knowledge entries. The agent uses this knowledge when answering your questions.
          </Typography>
        </Box>
      )}
    </Box>
  );
}

// ─── Node Detail Drawer ───

function NodeDetailDrawer({ node, open, onClose }: { node: MemoryNode | null; open: boolean; onClose: () => void }) {
  const meta = node ? CATEGORY_META[node.category] : null;
  const Icon = meta?.icon ?? ArticleIcon;

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      PaperProps={{
        sx: {
          width: 420,
          maxWidth: '90vw',
          bgcolor: colors.bg.secondary,
          borderLeft: `1px solid ${colors.border.default}`,
        },
      }}
    >
      {node && (
        <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
          {/* Header */}
          <Box sx={{
            flexShrink: 0,
            px: 2, py: 2,
            borderBottom: `1px solid ${colors.border.default}`,
            display: 'flex',
            alignItems: 'flex-start',
            gap: 1,
          }}>
            <Box sx={{
              width: 32, height: 32, borderRadius: 1,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              bgcolor: (meta?.color ?? colors.text.dim) + '15',
              border: `1px solid ${(meta?.color ?? colors.text.dim) + '30'}`,
              flexShrink: 0,
            }}>
              <Icon sx={{ fontSize: 18, color: meta?.color ?? colors.text.dim }} />
            </Box>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography sx={{ fontSize: '0.85rem', fontWeight: 600, color: colors.text.primary, lineHeight: 1.3 }}>
                {node.label}
              </Typography>
              <Box sx={{ display: 'flex', gap: 0.5, mt: 0.5, flexWrap: 'wrap' }}>
                <Chip
                  size="small"
                  label={meta?.label ?? node.category}
                  sx={{
                    fontSize: '0.55rem', height: 18,
                    fontFamily: "'JetBrains Mono', monospace",
                    bgcolor: (meta?.color ?? colors.text.dim) + '15',
                    color: meta?.color ?? colors.text.dim,
                    border: `1px solid ${(meta?.color ?? colors.text.dim) + '30'}`,
                  }}
                />
                {node.confidence != null && (
                  <Chip
                    size="small"
                    label={`${Math.round(node.confidence * 100)}% confidence`}
                    sx={{
                      fontSize: '0.55rem', height: 18,
                      fontFamily: "'JetBrains Mono', monospace",
                      bgcolor: colors.bg.tertiary,
                      color: colors.text.dim,
                      border: `1px solid ${colors.border.subtle}`,
                    }}
                  />
                )}
              </Box>
            </Box>
            <IconButton size="small" onClick={onClose} sx={{ color: colors.text.dim, flexShrink: 0 }}>
              <CloseIcon sx={{ fontSize: 18 }} />
            </IconButton>
          </Box>

          {/* Content */}
          <Box sx={{ flex: 1, overflow: 'auto', p: 2 }}>
            <SectionLabel>Content</SectionLabel>
            <Box sx={{
              p: 1.5,
              borderRadius: 1,
              bgcolor: colors.bg.tertiary,
              border: `1px solid ${colors.border.subtle}`,
              mb: 2,
            }}>
              <Typography sx={{
                fontSize: '0.75rem',
                color: colors.text.secondary,
                lineHeight: 1.6,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}>
                {node.content}
              </Typography>
            </Box>

            {/* Metadata */}
            <SectionLabel>Details</SectionLabel>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
              <DetailRow label="ID" value={node.id.slice(0, 8) + '…'} />
              <DetailRow label="Category" value={meta?.label ?? node.category} />
              <DetailRow label="Status" value={node.status} />
              {node.sourceId && <DetailRow label="Source" value={node.sourceId.slice(0, 8) + '…'} />}
              {node.sessionId && <DetailRow label="Session" value={node.sessionId.slice(0, 8) + '…'} />}
              {node.tag && <DetailRow label="Tag" value={node.tag} />}
              <DetailRow label="Created" value={new Date(node.createdAt).toLocaleString()} />
              <DetailRow label="Updated" value={new Date(node.updatedAt).toLocaleString()} />
              <DetailRow label="Accessed" value={node.accessCount > 0 ? `${node.accessCount} times` : 'Never'} />
              {node.lastAccessedAt && <DetailRow label="Last Access" value={new Date(node.lastAccessedAt).toLocaleString()} />}
            </Box>
          </Box>
        </Box>
      )}
    </Drawer>
  );
}

// ─── Shared Sub-components ───

function StatPill({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <Box sx={{
      flex: 1,
      minWidth: 100,
      px: 2, py: 1,
      borderRadius: 1,
      bgcolor: colors.bg.tertiary,
      border: `1px solid ${colors.border.default}`,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
    }}>
      <Typography sx={{
        fontSize: '1.3rem',
        fontWeight: 700,
        color,
        fontFamily: "'JetBrains Mono', monospace",
        lineHeight: 1,
      }}>
        {value.toLocaleString()}
      </Typography>
      <Typography sx={{
        fontSize: '0.55rem',
        color: colors.text.dim,
        fontFamily: "'JetBrains Mono', monospace",
        letterSpacing: 1,
        mt: 0.25,
        textTransform: 'uppercase',
      }}>
        {label}
      </Typography>
    </Box>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <Typography sx={{
      fontSize: '0.6rem',
      fontWeight: 600,
      color: colors.text.dim,
      fontFamily: "'JetBrains Mono', monospace",
      letterSpacing: 1.5,
      textTransform: 'uppercase',
      mb: 1,
    }}>
      {children}
    </Typography>
  );
}

function NodeCard({ node, onClick }: { node: MemoryNode; onClick: () => void }) {
  const meta = CATEGORY_META[node.category] ?? CATEGORY_META.system;
  const Icon = meta.icon;
  return (
    <Box
      onClick={onClick}
      sx={{
        cursor: 'pointer',
        p: 1.5,
        borderRadius: 1,
        border: `1px solid ${colors.border.default}`,
        bgcolor: colors.bg.tertiary,
        transition: 'all 0.15s',
        '&:hover': {
          borderColor: meta.color + '50',
          bgcolor: colors.bg.hover,
        },
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
        <Icon sx={{ fontSize: 16, color: meta.color, mt: 0.1, flexShrink: 0 }} />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography sx={{
            fontSize: '0.75rem',
            fontWeight: 600,
            color: colors.text.primary,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            mb: 0.25,
          }}>
            {node.label}
          </Typography>
          <Typography sx={{
            fontSize: '0.65rem',
            color: colors.text.tertiary,
            lineHeight: 1.4,
            overflow: 'hidden',
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
          }}>
            {node.content}
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.5 }}>
            <Chip
              size="small"
              label={meta.label}
              sx={{
                fontSize: '0.5rem', height: 16,
                fontFamily: "'JetBrains Mono', monospace",
                bgcolor: meta.color + '10',
                color: meta.color,
                border: `1px solid ${meta.color}20`,
              }}
            />
            <Typography sx={{ fontSize: '0.55rem', color: colors.text.dim }}>
              {new Date(node.createdAt).toLocaleDateString()}
            </Typography>
          </Box>
        </Box>
      </Box>
    </Box>
  );
}

function SearchResultCard({ result }: { result: RAGResult }) {
  const score = Math.round(result.score * 100);
  const scoreColor = score >= 80 ? colors.accent.green : score >= 50 ? colors.accent.orange : colors.accent.red;

  return (
    <Box sx={{
      p: 1.5,
      borderRadius: 1,
      border: `1px solid ${colors.border.default}`,
      bgcolor: colors.bg.tertiary,
      transition: 'all 0.15s',
      '&:hover': {
        borderColor: scoreColor + '40',
        bgcolor: colors.bg.hover,
      },
    }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
        <Box sx={{
          width: 28, height: 4, borderRadius: 2,
          bgcolor: colors.border.subtle,
          overflow: 'hidden',
          flexShrink: 0,
        }}>
          <Box sx={{ width: `${score}%`, height: '100%', bgcolor: scoreColor, borderRadius: 2 }} />
        </Box>
        <Typography sx={{
          fontSize: '0.55rem',
          fontFamily: "'JetBrains Mono', monospace",
          color: scoreColor,
          fontWeight: 600,
        }}>
          {score}% match
        </Typography>
        {result.metadata && Object.keys(result.metadata).length > 0 && (
          <Typography sx={{ fontSize: '0.55rem', color: colors.text.dim, ml: 'auto' }}>
            {Object.values(result.metadata).slice(0, 2).join(' · ')}
          </Typography>
        )}
      </Box>
      <Typography sx={{
        fontSize: '0.7rem',
        color: colors.text.secondary,
        lineHeight: 1.5,
        overflow: 'hidden',
        display: '-webkit-box',
        WebkitLineClamp: 4,
        WebkitBoxOrient: 'vertical',
      }}>
        {result.content}
      </Typography>
    </Box>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <Typography sx={{ fontSize: '0.6rem', color: colors.text.dim, fontFamily: "'JetBrains Mono', monospace" }}>
        {label}
      </Typography>
      <Typography sx={{ fontSize: '0.65rem', color: colors.text.secondary, textAlign: 'right' }}>
        {value}
      </Typography>
    </Box>
  );
}
