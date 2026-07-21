import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import GroupIcon from '@mui/icons-material/Group';
import FolderIcon from '@mui/icons-material/Folder';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import InsertDriveFileIcon from '@mui/icons-material/InsertDriveFile';
import LibraryBooksIcon from '@mui/icons-material/LibraryBooks';
import CheckBoxOutlineBlankIcon from '@mui/icons-material/CheckBoxOutlineBlank';
import CircularProgress from '@mui/material/CircularProgress';
import { colors, alphaColor } from '../theme';
import { getCrewAccent } from '../styles/crew-theme';
import { knowledgeBase, system, type Crew } from '../api';
import type { KnowledgeSource } from '@agentx/shared';
import { crewRequiresMedicalDisclaimer } from '@agentx/shared/browser';

export type ComposerFileHit = {
  name: string;
  path: string;
  relativePath: string;
};

export type ComposerFolderHit = {
  name: string;
  path: string;
  relativePath: string;
};

export type ComposerKbHit = {
  sourceId: string;
  name: string;
  mimeType?: string;
};

type MenuStage = 'root' | 'crew' | 'files' | 'kb';

type NavItem =
  | { kind: 'back' }
  | { kind: 'select-folder' }
  | { kind: 'category'; category: 'crew' | 'files' | 'kb' }
  | { kind: 'crew'; crew: Crew }
  | { kind: 'dir'; dir: ComposerFolderHit }
  | { kind: 'file'; file: ComposerFileHit }
  | { kind: 'kb'; source: ComposerKbHit };

/**
 * Multi-level @ picker: Crew / Directory / Knowledge Base.
 */
export function ComposerMentionMenu({
  query,
  crewList,
  disableCrew = false,
  onSelectCrew,
  onSelectFile,
  onSelectFolder,
  onSelectKb,
  onClose,
}: {
  query: string;
  crewList: Crew[];
  disableCrew?: boolean;
  onSelectCrew: (crew: Crew) => void;
  onSelectFile: (file: ComposerFileHit) => void;
  onSelectFolder: (folder: ComposerFolderHit) => void;
  onSelectKb?: (source: ComposerKbHit) => void;
  onClose: () => void;
}) {
  const q = query.toLowerCase();
  const [stage, setStage] = useState<MenuStage>('root');
  /** Workspace-relative browse path ('' = workspace root). */
  const [browseRel, setBrowseRel] = useState('');
  const [browseName, setBrowseName] = useState('workspace');
  const [browseAbs, setBrowseAbs] = useState('');
  const [parentRelative, setParentRelative] = useState<string | null>(null);
  const [dirs, setDirs] = useState<ComposerFolderHit[]>([]);
  const [files, setFiles] = useState<ComposerFileHit[]>([]);
  const [searchFiles, setSearchFiles] = useState<ComposerFileHit[]>([]);
  const [kbSources, setKbSources] = useState<ComposerKbHit[]>([]);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [loadingKb, setLoadingKb] = useState(false);
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const searching = stage === 'files' && q.length > 0;

  // Reset when a new @ session starts. Skip Crew/Directory chooser when Crew is disabled.
  useEffect(() => {
    setStage(disableCrew ? 'files' : 'root');
    setBrowseRel('');
    setActive(0);
  }, [disableCrew]);

  // Browse current directory when not searching.
  useEffect(() => {
    if (stage !== 'files' || searching) return;
    let cancelled = false;
    const ctrl = new AbortController();
    setLoadingFiles(true);
    void system.browseWorkspace(browseRel, ctrl.signal)
      .then((res) => {
        if (cancelled) return;
        setBrowseAbs(res.current);
        setBrowseName(res.name);
        setParentRelative(res.parentRelative);
        setDirs(res.dirs);
        setFiles(res.files);
      })
      .catch(() => {
        if (cancelled) return;
        setDirs([]);
        setFiles([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingFiles(false);
      });
    return () => {
      cancelled = true;
      ctrl.abort();
    };
  }, [stage, browseRel, searching]);

  // Knowledge Base sources (ready preferred).
  useEffect(() => {
    if (stage !== 'kb') return;
    let cancelled = false;
    setLoadingKb(true);
    void knowledgeBase.list()
      .then((sources: KnowledgeSource[]) => {
        if (cancelled) return;
        const mapped = sources
          .filter((s) => s.status === 'ready' || s.status === 'indexing' || s.status === 'embedding')
          .map((s) => ({ sourceId: s.id, name: s.name, mimeType: s.mimeType }));
        setKbSources(mapped);
      })
      .catch(() => {
        if (!cancelled) setKbSources([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingKb(false);
      });
    return () => { cancelled = true; };
  }, [stage]);

  // Flat file search when user types a filter.
  useEffect(() => {
    if (stage !== 'files' || !searching) {
      setSearchFiles([]);
      return;
    }
    let cancelled = false;
    const ctrl = new AbortController();
    setLoadingFiles(true);
    const t = window.setTimeout(() => {
      void system.searchFiles(query, 24, ctrl.signal)
        .then((res) => {
          if (!cancelled) setSearchFiles(res.files);
        })
        .catch(() => {
          if (!cancelled) setSearchFiles([]);
        })
        .finally(() => {
          if (!cancelled) setLoadingFiles(false);
        });
    }, 90);
    return () => {
      cancelled = true;
      ctrl.abort();
      window.clearTimeout(t);
    };
  }, [query, stage, searching]);

  const crewFiltered = useMemo(() => {
    if (disableCrew) return [] as Crew[];
    if (!q) return crewList.slice(0, 16);
    return crewList
      .filter((c) =>
        c.name.toLowerCase().includes(q)
        || (c.title?.toLowerCase().includes(q) ?? false)
        || c.callsign.toLowerCase().includes(q),
      )
      .slice(0, 16);
  }, [crewList, disableCrew, q]);

  const kbFiltered = useMemo(() => {
    if (!q) return kbSources.slice(0, 24);
    return kbSources
      .filter((s) => s.name.toLowerCase().includes(q) || s.sourceId.toLowerCase().includes(q))
      .slice(0, 24);
  }, [kbSources, q]);

  const items: NavItem[] = useMemo(() => {
    if (stage === 'root') {
      const cats: NavItem[] = [];
      if (!disableCrew) cats.push({ kind: 'category', category: 'crew' });
      cats.push({ kind: 'category', category: 'files' });
      cats.push({ kind: 'category', category: 'kb' });
      return cats;
    }
    if (stage === 'crew') {
      return [
        { kind: 'back' as const },
        ...crewFiltered.map((crew) => ({ kind: 'crew' as const, crew })),
      ];
    }
    if (stage === 'kb') {
      return [
        { kind: 'back' as const },
        ...kbFiltered.map((source) => ({ kind: 'kb' as const, source })),
      ];
    }
    if (searching) {
      return [
        { kind: 'back' as const },
        { kind: 'select-folder' as const },
        ...searchFiles.map((file) => ({ kind: 'file' as const, file })),
      ];
    }
    return [
      { kind: 'back' as const },
      { kind: 'select-folder' as const },
      ...dirs.map((dir) => ({ kind: 'dir' as const, dir })),
      ...files.map((file) => ({ kind: 'file' as const, file })),
    ];
  }, [stage, disableCrew, crewFiltered, kbFiltered, searching, searchFiles, dirs, files]);

  // Reset highlight only when the browse context changes — not when item count
  // flickers during async loads (that was resetting selection mid-navigation).
  useEffect(() => { setActive(0); }, [stage, query, browseRel]);

  useEffect(() => {
    setActive((i) => (items.length === 0 ? 0 : Math.min(i, items.length - 1)));
  }, [items.length]);

  // Keep the highlighted row in view without jumping it to the viewport center.
  useEffect(() => {
    const root = listRef.current;
    if (!root) return;
    const el = root.querySelector<HTMLElement>(`[data-mention-idx="${active}"]`);
    if (!el) return;
    const rootTop = root.scrollTop;
    const rootBottom = rootTop + root.clientHeight;
    const elTop = el.offsetTop;
    const elBottom = elTop + el.offsetHeight;
    if (elBottom > rootBottom) {
      root.scrollTop = elBottom - root.clientHeight;
    } else if (elTop < rootTop) {
      root.scrollTop = elTop;
    }
  }, [active, stage, items.length]);

  const selectIndex = useCallback((i: number) => {
    const item = items[i];
    if (!item) return;
    if (item.kind === 'back') {
      if (stage === 'files' && browseRel) {
        setBrowseRel(parentRelative ?? '');
        return;
      }
      // No Crew category — back from Directory root dismisses the menu.
      if (disableCrew && stage === 'files') {
        onClose();
        return;
      }
      setStage('root');
      setBrowseRel('');
      return;
    }
    if (item.kind === 'select-folder') {
      if (!browseAbs) return;
      const rel = browseRel || '.';
      onSelectFolder({
        name: browseName || 'workspace',
        path: browseAbs,
        relativePath: rel,
      });
      return;
    }
    if (item.kind === 'category') {
      if (item.category === 'crew') setStage('crew');
      else if (item.category === 'kb') setStage('kb');
      else {
        setStage('files');
        setBrowseRel('');
      }
      return;
    }
    if (item.kind === 'crew') {
      onSelectCrew(item.crew);
      return;
    }
    if (item.kind === 'kb') {
      onSelectKb?.(item.source);
      return;
    }
    if (item.kind === 'dir') {
      setBrowseRel(item.dir.relativePath);
      return;
    }
    onSelectFile(item.file);
  }, [
    items, onSelectCrew, onSelectFile, onSelectFolder, onSelectKb, onClose, disableCrew,
    stage, browseRel, parentRelative, browseName, browseAbs,
  ]);

  const handleKeyboard = useCallback((e: KeyboardEvent) => {
    const navKeys = e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Tab'
      || e.key === 'Enter' || e.key === 'Escape';
    if (!navKeys) return;

    // Strictly consume — must not bubble to composer send-on-Enter.
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    if (e.key === 'Escape') {
      if (stage === 'files' && browseRel) {
        setBrowseRel(parentRelative ?? '');
        return;
      }
      if (stage !== 'root' && !disableCrew) {
        setStage('root');
        setBrowseRel('');
        return;
      }
      onClose();
      return;
    }

    if (items.length === 0) return;

    if (e.key === 'ArrowDown') {
      setActive((i) => Math.min(items.length - 1, i + 1));
      return;
    }
    if (e.key === 'ArrowUp') {
      setActive((i) => Math.max(0, i - 1));
      return;
    }
    if (e.key === 'Tab' || e.key === 'Enter') {
      selectIndex(active);
    }
  }, [items.length, active, selectIndex, onClose, stage, browseRel, parentRelative, disableCrew]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyboard, true);
    return () => window.removeEventListener('keydown', handleKeyboard, true);
  }, [handleKeyboard]);

  const title = stage === 'root'
    ? '@ ATTACH'
    : stage === 'crew'
      ? '@ CREW'
      : stage === 'kb'
        ? '@ KNOWLEDGE BASE'
        : browseRel
          ? `@ ${browseRel}`
          : '@ DIRECTORY';

  const emptyBrowse = !searching && !loadingFiles && dirs.length === 0 && files.length === 0;
  const emptySearch = searching && !loadingFiles && searchFiles.length === 0;
  const emptyKb = stage === 'kb' && !loadingKb && kbFiltered.length === 0;

  return (
    <Box
      sx={{
        position: 'absolute',
        bottom: 'calc(100% + 6px)',
        left: 0,
        width: 'min(280px, 100%)',
        bgcolor: colors.bg.secondary,
        border: `1px solid ${alphaColor(colors.accent.blue, '40')}`,
        borderRadius: '7px',
        boxShadow: `0 5px 14px ${colors.shadow.heavy}`,
        maxHeight: 200,
        zIndex: 100,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        animation: 'agentx-fadeIn 0.12s ease-out',
      }}
    >
      <Box
        data-mention-header
        sx={{
          px: 0.85, py: 0.3,
          borderBottom: `1px solid ${colors.border.subtle}`,
          display: 'flex', alignItems: 'center', gap: 0.5,
          flexShrink: 0,
          bgcolor: colors.bg.secondary,
        }}
      >
        <Typography sx={{ fontSize: '0.44rem', fontFamily: "'JetBrains Mono', monospace", color: colors.text.dim, letterSpacing: '0.8px' }} noWrap>
          {title}
        </Typography>
        <Box sx={{ flex: 1 }} />
        {(stage === 'files' && loadingFiles) || (stage === 'kb' && loadingKb)
          ? <CircularProgress size={8} sx={{ color: colors.text.dim }} />
          : null}
        <Typography sx={{ fontSize: '0.4rem', color: colors.text.dim }}>↑↓ · ⏎ · esc</Typography>
      </Box>

      <Box
        ref={listRef}
        sx={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          overflowX: 'hidden',
        }}
      >

      {stage === 'root' && items.map((item, i) => {
        if (item.kind !== 'category') return null;
        const meta = item.category === 'crew'
          ? { label: 'Crew', hint: 'Mention a crew member', color: colors.accent.blue, icon: <GroupIcon sx={{ fontSize: 13, color: colors.accent.blue }} /> }
          : item.category === 'kb'
            ? { label: 'Knowledge Base', hint: 'Pick an embedded document', color: colors.accent.purple, icon: <LibraryBooksIcon sx={{ fontSize: 13, color: colors.accent.purple }} /> }
            : { label: 'Directory', hint: 'Browse files & folders', color: colors.accent.cyan, icon: <FolderIcon sx={{ fontSize: 13, color: colors.accent.cyan }} /> };
        return (
          <Box
            key={item.category}
            data-mention-idx={i}
            onClick={() => selectIndex(i)}
            onMouseEnter={() => setActive(i)}
            sx={{
              px: 0.85, py: 0.45,
              display: 'flex', alignItems: 'center', gap: 0.65,
              cursor: 'pointer',
              bgcolor: i === active ? alphaColor(meta.color, '14') : 'transparent',
              borderLeft: i === active
                ? `2px solid ${meta.color}`
                : '2px solid transparent',
            }}
          >
            {meta.icon}
            <Box sx={{ minWidth: 0 }}>
              <Typography sx={{ fontSize: '0.62rem', fontWeight: 600, color: colors.text.primary }}>
                {meta.label}
              </Typography>
              <Typography sx={{ fontSize: '0.45rem', color: colors.text.dim }}>
                {meta.hint}
              </Typography>
            </Box>
          </Box>
        );
      })}

      {stage === 'kb' && (
        <>
          {items.map((item, i) => {
            if (item.kind === 'back') {
              return (
                <Box
                  key="back"
                  data-mention-idx={i}
                  onClick={() => selectIndex(i)}
                  onMouseEnter={() => setActive(i)}
                  sx={{
                    px: 0.85, py: 0.35,
                    display: 'flex', alignItems: 'center', gap: 0.5,
                    cursor: 'pointer',
                    bgcolor: i === active ? alphaColor(colors.accent.purple, '12') : 'transparent',
                    borderBottom: `1px solid ${colors.border.subtle}`,
                  }}
                >
                  <ArrowBackIcon sx={{ fontSize: 12, color: colors.text.dim }} />
                  <Typography sx={{ fontSize: '0.55rem', color: colors.text.secondary }}>Go back</Typography>
                </Box>
              );
            }
            if (item.kind !== 'kb') return null;
            const src = item.source;
            const ext = src.name.includes('.') ? (src.name.split('.').pop() || '').toUpperCase().slice(0, 6) : 'DOC';
            return (
              <Box
                key={`kb-${src.sourceId}`}
                data-mention-idx={i}
                onClick={() => selectIndex(i)}
                onMouseEnter={() => setActive(i)}
                sx={{
                  px: 0.85, py: 0.3,
                  display: 'flex', alignItems: 'center', gap: 0.55,
                  cursor: 'pointer',
                  bgcolor: i === active ? alphaColor(colors.accent.purple, '15') : 'transparent',
                  borderLeft: i === active ? `2px solid ${colors.accent.purple}` : '2px solid transparent',
                }}
              >
                <Box sx={{
                  minWidth: 16, height: 14, px: 0.35, borderRadius: '999px',
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  bgcolor: colors.accent.purple, color: colors.bg.primary,
                  fontSize: '0.4rem', fontWeight: 700, flexShrink: 0,
                }}>
                  {ext}
                </Box>
                <Typography sx={{ fontSize: '0.55rem', color: colors.text.primary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {src.name}
                </Typography>
              </Box>
            );
          })}
          {emptyKb && (
            <Typography sx={{ px: 1, py: 1.25, fontSize: '0.5rem', color: colors.text.dim }}>
              No ready Knowledge Base documents
            </Typography>
          )}
        </>
      )}

      {stage === 'crew' && items.map((item, i) => {
        if (item.kind === 'back') {
          return (
            <Box
              key="back"
              data-mention-idx={i}
              onClick={() => selectIndex(i)}
              onMouseEnter={() => setActive(i)}
              sx={{
                px: 0.85, py: 0.35,
                display: 'flex', alignItems: 'center', gap: 0.5,
                cursor: 'pointer',
                bgcolor: i === active ? alphaColor(colors.accent.blue, '12') : 'transparent',
                borderBottom: `1px solid ${colors.border.subtle}`,
              }}
            >
              <ArrowBackIcon sx={{ fontSize: 12, color: colors.text.dim }} />
              <Typography sx={{ fontSize: '0.55rem', color: colors.text.secondary }}>Go back</Typography>
            </Box>
          );
        }
        if (item.kind !== 'crew') return null;
        const crew = item.crew;
        return (
          <Box
            key={`crew-${crew.id}`}
            data-mention-idx={i}
            onClick={() => selectIndex(i)}
            onMouseEnter={() => setActive(i)}
            sx={{
              px: 0.85, py: 0.3,
              display: 'flex', alignItems: 'center', gap: 0.55,
              cursor: 'pointer',
              bgcolor: i === active ? alphaColor(colors.accent.blue, '15') : 'transparent',
              borderLeft: i === active ? `2px solid ${colors.accent.blue}` : '2px solid transparent',
            }}
          >
            <Box
              sx={{
                width: 16, height: 16, borderRadius: '50%', flexShrink: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                bgcolor: getCrewAccent(crew.color, crew.callsign),
                color: colors.bg.primary,
                fontSize: '0.48rem', fontWeight: 700,
              }}
            >
              {(crew.icon && [...crew.icon].length <= 3)
                ? crew.icon
                : (crew.name?.[0] || crew.callsign[0] || '?').toUpperCase()}
            </Box>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.35 }}>
                <Typography sx={{ fontSize: '0.58rem', fontWeight: 600, color: colors.text.primary }} noWrap>
                  {crew.name}
                </Typography>
                {crewRequiresMedicalDisclaimer({
                  catalogId: crew.catalogId ?? crew.id,
                  categoryId: crew.categoryId,
                  requiresMedicalDisclaimer: crew.requiresMedicalDisclaimer,
                }) && (
                  <Typography sx={{ fontSize: '0.38rem', color: colors.accent.orange, fontWeight: 800 }}>MED</Typography>
                )}
              </Box>
              <Typography sx={{ fontSize: '0.45rem', color: colors.text.secondary }} noWrap>
                {crew.title || 'Crew member'}
              </Typography>
            </Box>
          </Box>
        );
      })}

      {stage === 'files' && items.map((item, i) => {
        if (item.kind === 'back') {
          return (
            <Box
              key="back"
              data-mention-idx={i}
              onClick={() => selectIndex(i)}
              onMouseEnter={() => setActive(i)}
              sx={{
                px: 0.85, py: 0.35,
                display: 'flex', alignItems: 'center', gap: 0.5,
                cursor: 'pointer',
                bgcolor: i === active ? alphaColor(colors.accent.cyan, '12') : 'transparent',
                borderBottom: `1px solid ${colors.border.subtle}`,
              }}
            >
              <ArrowBackIcon sx={{ fontSize: 12, color: colors.text.dim }} />
              <Typography sx={{ fontSize: '0.55rem', color: colors.text.secondary }}>
                {browseRel ? 'Go up' : 'Go back'}
              </Typography>
            </Box>
          );
        }
        if (item.kind === 'select-folder') {
          return (
            <Box
              key="select-folder"
              data-mention-idx={i}
              onClick={() => selectIndex(i)}
              onMouseEnter={() => setActive(i)}
              sx={{
                px: 0.85, py: 0.35,
                display: 'flex', alignItems: 'center', gap: 0.5,
                cursor: browseAbs ? 'pointer' : 'default',
                opacity: browseAbs ? 1 : 0.5,
                bgcolor: i === active ? alphaColor(colors.accent.cyan, '14') : 'transparent',
                borderBottom: `1px solid ${colors.border.subtle}`,
              }}
            >
              <CheckBoxOutlineBlankIcon sx={{ fontSize: 12, color: colors.accent.cyan }} />
              <Box sx={{ minWidth: 0 }}>
                <Typography sx={{ fontSize: '0.55rem', fontWeight: 600, color: colors.text.primary }}>
                  Select this folder
                </Typography>
                <Typography sx={{ fontSize: '0.42rem', color: colors.text.dim }} noWrap>
                  {browseRel || '.'} · attach for this turn
                </Typography>
              </Box>
            </Box>
          );
        }
        if (item.kind === 'dir') {
          const dir = item.dir;
          return (
            <Box
              key={`dir-${dir.path}`}
              data-mention-idx={i}
              onClick={() => selectIndex(i)}
              onMouseEnter={() => setActive(i)}
              sx={{
                px: 0.85, py: 0.3,
                display: 'flex', alignItems: 'center', gap: 0.55,
                cursor: 'pointer',
                bgcolor: i === active ? alphaColor(colors.accent.cyan, '12') : 'transparent',
                borderLeft: i === active ? `2px solid ${colors.accent.cyan}` : '2px solid transparent',
              }}
            >
              <FolderOpenIcon sx={{ fontSize: 12, color: colors.accent.cyan, opacity: 0.9, flexShrink: 0 }} />
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography sx={{ fontSize: '0.55rem', fontWeight: 600, color: colors.text.primary, fontFamily: "'JetBrains Mono', monospace" }} noWrap>
                  {dir.name}/
                </Typography>
                <Typography sx={{ fontSize: '0.42rem', color: colors.text.dim }} noWrap>
                  Open folder
                </Typography>
              </Box>
            </Box>
          );
        }
        if (item.kind !== 'file') return null;
        const file = item.file;
        return (
          <Box
            key={`file-${file.path}`}
            data-mention-idx={i}
            onClick={() => selectIndex(i)}
            onMouseEnter={() => setActive(i)}
            sx={{
              px: 0.85, py: 0.3,
              display: 'flex', alignItems: 'center', gap: 0.55,
              cursor: 'pointer',
              bgcolor: i === active ? alphaColor(colors.accent.cyan, '12') : 'transparent',
              borderLeft: i === active ? `2px solid ${colors.accent.cyan}` : '2px solid transparent',
            }}
          >
            <InsertDriveFileIcon sx={{ fontSize: 12, color: colors.accent.cyan, opacity: 0.85, flexShrink: 0 }} />
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography sx={{ fontSize: '0.55rem', fontWeight: 600, color: colors.text.primary, fontFamily: "'JetBrains Mono', monospace" }} noWrap>
                {file.name}
              </Typography>
              <Typography sx={{ fontSize: '0.42rem', color: colors.text.dim }} noWrap>
                {file.relativePath}
              </Typography>
            </Box>
          </Box>
        );
      })}

      {stage === 'crew' && crewFiltered.length === 0 && (
        <Box sx={{ px: 0.85, py: 0.9, textAlign: 'center' }}>
          <Typography sx={{ fontSize: '0.55rem', color: colors.text.dim }}>
            No crew match “{query || '…'}”
          </Typography>
        </Box>
      )}
      {stage === 'files' && (emptyBrowse || emptySearch) && (
        <Box sx={{ px: 0.85, py: 0.9, textAlign: 'center' }}>
          <Typography sx={{ fontSize: '0.55rem', color: colors.text.dim }}>
            {emptySearch
              ? `No files match “${query || '…'}”`
              : 'This folder is empty'}
          </Typography>
        </Box>
      )}
      </Box>
    </Box>
  );
}
