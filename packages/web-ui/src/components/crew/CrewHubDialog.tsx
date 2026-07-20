import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import TextField from '@mui/material/TextField';
import InputAdornment from '@mui/material/InputAdornment';
import CircularProgress from '@mui/material/CircularProgress';
import HubIcon from '@mui/icons-material/Hub';
import CloseIcon from '@mui/icons-material/Close';
import SearchIcon from '@mui/icons-material/Search';
import SatelliteAltIcon from '@mui/icons-material/SatelliteAlt';
import type { Crew } from '../../api';
import { searchHubCatalog, resolveHubCrewById } from '../../data/crew-hub/loadHubCatalog';
import { crewDialogPaperSx, crewHubScanlineSx, crewOverlineSx, crewTheme } from '../../styles/crew-theme';
import { CrewProfileDialog } from './CrewProfileDialog';
import { HubSectorNavItem } from './HubSectorNavItem';
import { CrewHubCard } from './CrewHubCard';
import { useVirtualGrid } from '../../perf/useVirtualGrid';
import type { HubCardCrew, PrebuiltCategory, PrebuiltCrew } from './hub-types';

export type { PrebuiltCategory, PrebuiltCrew, HubCardCrew } from './hub-types';

interface CrewHubDialogProps {
  open: boolean;
  onClose: () => void;
  categories: PrebuiltCategory[];
  categoriesLoading?: boolean;
  sectorCrewsLoading?: boolean;
  categoriesError?: string;
  categoryIndex: number;
  onCategoryChange: (index: number) => void;
  crews: Crew[];
  importLoading: string | null;
  onImport: (crew: PrebuiltCrew) => void;
  onRemove: (id: string) => void;
  onPrivateChat?: (crew: PrebuiltCrew, rosterCrewId?: string) => void;
  privateChatLoading?: boolean;
  onCall?: (crew: PrebuiltCrew, rosterCrewId?: string) => void;
  callLoading?: boolean;
}

const SEARCH_DEBOUNCE_MS = 320;
const SEARCH_MIN_CHARS = 2;
const SEARCH_RESULT_CAP = 60;

function normalizeCallsign(c: string): string {
  return c.trim().toLowerCase().replace(/^dr_/, '');
}

export function CrewHubDialog({
  open,
  onClose,
  categories,
  categoriesLoading = false,
  sectorCrewsLoading = false,
  categoriesError,
  categoryIndex,
  onCategoryChange,
  crews,
  importLoading,
  onImport,
  onRemove,
  onPrivateChat,
  privateChatLoading,
  onCall,
  callLoading,
}: CrewHubDialogProps) {
  const activeCategory = categories[categoryIndex];
  const [profileCrew, setProfileCrew] = useState<PrebuiltCrew | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [searchLoading, setSearchLoading] = useState(false);
  const [, startSearchTransition] = useTransition();
  const [displayCrews, setDisplayCrews] = useState<HubCardCrew[]>([]);
  const gridScrollRef = useRef<HTMLDivElement>(null);

  const rosterByCallsign = useMemo(() => {
    const map = new Map<string, Crew>();
    for (const c of crews) map.set(normalizeCallsign(c.callsign), c);
    return map;
  }, [crews]);

  useEffect(() => {
    const handle = window.setTimeout(() => setDebouncedSearch(searchQuery), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [searchQuery]);

  const trimmedSearch = debouncedSearch.trim();
  const isSearching = trimmedSearch.length >= SEARCH_MIN_CHARS;
  const searchPending =
    searchQuery.trim() !== debouncedSearch.trim() ||
    (trimmedSearch.length >= SEARCH_MIN_CHARS && searchLoading);

  useEffect(() => {
    if (isSearching) {
      const controller = new AbortController();
      setSearchLoading(true);
      searchHubCatalog(trimmedSearch, controller.signal)
        .then((hits) => {
          startSearchTransition(() => {
            setDisplayCrews(
              hits.slice(0, SEARCH_RESULT_CAP).map((hit) => ({
                catalogId: hit.catalogId,
                categoryId: hit.categoryId,
                categoryLabel: hit.categoryLabel,
                requiresMedicalDisclaimer: hit.requiresMedicalDisclaimer,
                honorsDoctorate: hit.honorsDoctorate,
                name: hit.name,
                title: hit.title,
                callsign: hit.callsign,
                description: hit.description,
                tone: hit.tone,
                expertise: hit.expertise,
                traits: hit.traits,
              })),
            );
          });
        })
        .catch((err: unknown) => {
          if (err instanceof DOMException && err.name === 'AbortError') return;
          if ((err as Error)?.name === 'AbortError') return;
          setDisplayCrews([]);
        })
        .finally(() => {
          if (!controller.signal.aborted) setSearchLoading(false);
        });
      return () => controller.abort();
    }

    if (trimmedSearch.length > 0 && trimmedSearch.length < SEARCH_MIN_CHARS) {
      setDisplayCrews([]);
      setSearchLoading(false);
      return;
    }

    if (!activeCategory) {
      setDisplayCrews([]);
      setSearchLoading(false);
      return;
    }
    setDisplayCrews(
      activeCategory.crews.map((crew) => ({
        catalogId: crew.catalogId ?? crew.callsign,
        categoryId: activeCategory.id,
        requiresMedicalDisclaimer: crew.requiresMedicalDisclaimer,
        honorsDoctorate: crew.honorsDoctorate,
        name: crew.name,
        title: crew.title,
        callsign: crew.callsign,
        description: crew.description,
        tone: crew.tone,
        expertise: crew.expertise,
        traits: crew.traits,
        fullCrew: crew,
      })),
    );
  }, [activeCategory, trimmedSearch, isSearching]);

  const searchStatusText = (() => {
    if (!searchQuery.trim()) return '\u00a0';
    if (searchQuery.trim().length < SEARCH_MIN_CHARS) return `Type ${SEARCH_MIN_CHARS}+ characters to search`;
    if (!isSearching) return '\u00a0';
    if (searchPending && displayCrews.length === 0) return 'Searching…';
    if (searchPending) return `${displayCrews.length} match${displayCrews.length === 1 ? '' : 'es'}…`;
    const capped = displayCrews.length >= SEARCH_RESULT_CAP ? ` (showing first ${SEARCH_RESULT_CAP})` : '';
    return `${displayCrews.length} match${displayCrews.length === 1 ? '' : 'es'} across all sectors${capped}`;
  })();

  const profileExisting = profileCrew
    ? rosterByCallsign.get(normalizeCallsign(profileCrew.callsign))
    : undefined;

  const resolveCardCrew = useCallback(async (item: HubCardCrew): Promise<PrebuiltCrew | undefined> => {
    if (item.fullCrew?.systemPrompt) return item.fullCrew;
    return resolveHubCrewById(item.catalogId);
  }, []);

  const handleOpenProfile = useCallback(async (item: HubCardCrew) => {
    const crew = await resolveCardCrew(item);
    if (crew) setProfileCrew(crew);
  }, [resolveCardCrew]);

  const handleRecruit = useCallback(async (item: HubCardCrew) => {
    const crew = await resolveCardCrew(item);
    if (crew) onImport(crew);
  }, [onImport, resolveCardCrew]);

  const handleQuickChat = useCallback(async (item: HubCardCrew) => {
    if (!onPrivateChat) return;
    const crew = await resolveCardCrew(item);
    if (!crew) return;
    const existing = rosterByCallsign.get(normalizeCallsign(item.callsign));
    if (existing) onPrivateChat(crew, existing.id);
    else onPrivateChat(crew);
  }, [onPrivateChat, resolveCardCrew, rosterByCallsign]);

  const handleQuickCall = useCallback(async (item: HubCardCrew) => {
    if (!onCall) return;
    const crew = await resolveCardCrew(item);
    if (!crew) return;
    const existing = rosterByCallsign.get(normalizeCallsign(item.callsign));
    onCall(crew, existing?.id);
  }, [onCall, resolveCardCrew, rosterByCallsign]);

  const handleClose = () => {
    setSearchQuery('');
    setDebouncedSearch('');
    setProfileCrew(null);
    onClose();
  };

  const rowHeight = crewTheme.grid.hubCardHeight + crewTheme.grid.gap;
  const { visibleIndices, topSpacerPx, bottomSpacerPx } = useVirtualGrid(gridScrollRef, {
    itemCount: displayCrews.length,
    rowHeight,
    minColWidth: crewTheme.grid.hubMinCard,
    gap: crewTheme.grid.gap,
    threshold: 24,
  });

  return (
    <>
      <Dialog
        open={open}
        onClose={handleClose}
        maxWidth="lg"
        fullWidth
        PaperProps={{ sx: { ...crewDialogPaperSx, maxHeight: '88vh', position: 'relative' } }}
      >
        <Box sx={crewHubScanlineSx} />

        <DialogTitle
          sx={{
            px: 2.5,
            pt: 2,
            pb: 1.25,
            borderBottom: `1px solid ${crewTheme.border.subtle}`,
            flexShrink: 0,
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 1.5 }}>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.5 }}>
                <SatelliteAltIcon sx={{ fontSize: 15, color: crewTheme.text.secondary }} />
                <Typography sx={crewOverlineSx}>Personnel Acquisition</Typography>
              </Box>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <HubIcon sx={{ color: crewTheme.text.primary, fontSize: 14 }} />
                <Typography
                  sx={{
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: '0.95rem',
                    fontWeight: 700,
                    letterSpacing: '2px',
                    color: crewTheme.text.primary,
                  }}
                >
                  CREW HUB
                </Typography>
              </Box>
              <Typography sx={{ fontSize: '0.68rem', color: crewTheme.text.secondary, mt: 0.5, maxWidth: 520 }}>
                Deploy pre-trained specialists from the command database. Select a sector, then recruit personnel to your roster.
              </Typography>
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexShrink: 0, pt: 0.25 }}>
              {!categoriesLoading && !categoriesError && (
                <TextField
                  size="small"
                  placeholder="Search crews..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  InputProps={{
                    startAdornment: (
                      <InputAdornment position="start">
                        <SearchIcon sx={{ fontSize: 14, color: crewTheme.text.dim }} />
                      </InputAdornment>
                    ),
                    sx: {
                      fontSize: '0.62rem',
                      fontFamily: "'JetBrains Mono', monospace",
                      bgcolor: crewTheme.bg.card,
                      borderRadius: '4px',
                      height: 32,
                    },
                  }}
                  sx={{
                    width: 200,
                    '& .MuiOutlinedInput-root': {
                      '& fieldset': { borderColor: crewTheme.border.default },
                      '&:hover fieldset': { borderColor: crewTheme.border.strong },
                      '&.Mui-focused fieldset': { borderColor: crewTheme.accent.tactical },
                    },
                  }}
                />
              )}
              <IconButton
                size="small"
                onClick={handleClose}
                sx={{
                  color: crewTheme.text.dim,
                  border: `1px solid ${crewTheme.border.default}`,
                  borderRadius: '6px',
                  p: 0.5,
                }}
              >
                <CloseIcon sx={{ fontSize: 16 }} />
              </IconButton>
            </Box>
          </Box>
        </DialogTitle>

        <DialogContent
          sx={{
            px: 0,
            pt: '0 !important',
            pb: 0,
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'row',
            minHeight: 420,
          }}
        >
          {categoriesError ? (
            <Typography
              sx={{
                fontSize: '0.72rem',
                color: crewTheme.accent.alert,
                py: 4,
                textAlign: 'center',
                width: '100%',
                px: 2.5,
              }}
            >
              {categoriesError}
            </Typography>
          ) : categoriesLoading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', py: 8, width: '100%' }}>
              <CircularProgress size={28} sx={{ color: crewTheme.text.secondary }} />
            </Box>
          ) : (
            <>
              {!isSearching && (
                <Box
                  sx={{
                    width: 232,
                    flexShrink: 0,
                    borderRight: `1px solid ${crewTheme.border.subtle}`,
                    overflowY: 'auto',
                    py: 1.25,
                    px: 0.75,
                    bgcolor: crewTheme.bg.inset,
                  }}
                >
                  <Typography
                    sx={{
                      fontSize: '0.5rem',
                      fontFamily: "'JetBrains Mono', monospace",
                      letterSpacing: '1px',
                      color: crewTheme.text.dim,
                      px: 0.75,
                      mb: 0.75,
                      textTransform: 'uppercase',
                    }}
                  >
                    Sectors
                  </Typography>
                  {categories.map((cat, idx) => (
                    <HubSectorNavItem
                      key={cat.id}
                      label={cat.label}
                      icon={cat.icon}
                      selected={categoryIndex === idx}
                      onClick={() => onCategoryChange(idx)}
                    />
                  ))}
                </Box>
              )}

              <Box
                ref={gridScrollRef}
                sx={{
                  flex: 1,
                  minWidth: 0,
                  overflowY: 'auto',
                  px: 2.5,
                  py: 1.5,
                  display: 'flex',
                  flexDirection: 'column',
                }}
              >
                <Box sx={{ minHeight: searchQuery.trim() ? 20 : 0, mb: searchQuery.trim() ? 1.5 : 0, flexShrink: 0 }}>
                  <Typography
                    sx={{
                      fontSize: '0.62rem',
                      color: crewTheme.text.secondary,
                      fontFamily: "'JetBrains Mono', monospace",
                      visibility: searchQuery.trim() ? 'visible' : 'hidden',
                    }}
                  >
                    {searchStatusText}
                  </Typography>
                </Box>

                {!isSearching && activeCategory && (
                  <Box
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 0.85,
                      mb: 1.25,
                      pb: 1,
                      flexShrink: 0,
                      borderBottom: `1px solid ${crewTheme.border.subtle}`,
                    }}
                  >
                    <Box sx={{ display: 'flex', alignItems: 'center', color: crewTheme.text.secondary }}>
                      {activeCategory.icon}
                    </Box>
                    <Typography
                      sx={{
                        fontFamily: "'JetBrains Mono', monospace",
                        fontSize: '0.72rem',
                        fontWeight: 700,
                        letterSpacing: '0.5px',
                        color: crewTheme.text.primary,
                        flex: 1,
                        minWidth: 0,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {activeCategory.label}
                    </Typography>
                    <Typography
                      sx={{
                        fontFamily: "'JetBrains Mono', monospace",
                        fontSize: '0.52rem',
                        color: crewTheme.text.dim,
                        flexShrink: 0,
                      }}
                    >
                      {sectorCrewsLoading ? '…' : `${displayCrews.length} crew`}
                    </Typography>
                  </Box>
                )}

                {displayCrews.length === 0 && (sectorCrewsLoading || searchPending) ? (
                  <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', py: 8 }}>
                    <CircularProgress size={28} sx={{ color: crewTheme.text.secondary }} />
                  </Box>
                ) : displayCrews.length === 0 ? (
                  <Box sx={{ py: 6, textAlign: 'center' }}>
                    <Typography sx={{ fontSize: '0.72rem', color: crewTheme.text.dim, fontFamily: "'JetBrains Mono', monospace" }}>
                      {isSearching ? 'No crew match your search' : 'No crew in this sector'}
                    </Typography>
                  </Box>
                ) : (
                  <>
                    {topSpacerPx > 0 && <Box sx={{ height: topSpacerPx, flexShrink: 0 }} />}
                    <Box
                      sx={{
                        display: 'grid',
                        gridTemplateColumns: `repeat(auto-fill, minmax(${crewTheme.grid.hubMinCard}px, 1fr))`,
                        gap: `${crewTheme.grid.gap}px`,
                      }}
                    >
                      {visibleIndices.map((idx) => {
                        const pc = displayCrews[idx];
                        if (!pc) return null;
                        const existing = rosterByCallsign.get(normalizeCallsign(pc.callsign));
                        return (
                          <CrewHubCard
                            key={pc.catalogId || pc.callsign}
                            item={pc}
                            imported={!!existing}
                            rosterId={existing?.id}
                            importLoading={importLoading === pc.callsign}
                            privateChatLoading={privateChatLoading}
                            showPrivateChat={!!onPrivateChat}
                            callLoading={callLoading}
                            showCall={!!onCall}
                            onOpenProfile={(item) => { void handleOpenProfile(item); }}
                            onRecruit={(item) => { void handleRecruit(item); }}
                            onDeactivate={onRemove}
                            onPrivateChat={(item) => { void handleQuickChat(item); }}
                            onCall={(item) => { void handleQuickCall(item); }}
                          />
                        );
                      })}
                    </Box>
                    {bottomSpacerPx > 0 && <Box sx={{ height: bottomSpacerPx, flexShrink: 0 }} />}
                  </>
                )}
              </Box>
            </>
          )}
        </DialogContent>
      </Dialog>

      <CrewProfileDialog
        open={!!profileCrew}
        crew={profileCrew}
        imported={!!profileExisting}
        importLoading={importLoading === profileCrew?.callsign}
        onClose={() => setProfileCrew(null)}
        onImport={() => profileCrew && onImport(profileCrew)}
        onRemove={() => profileExisting && onRemove(profileExisting.id)}
        onPrivateChat={
          profileCrew && onPrivateChat
            ? () => onPrivateChat(profileCrew, profileExisting?.id)
            : undefined
        }
        privateChatLoading={privateChatLoading}
        onCall={
          profileCrew && onCall
            ? () => onCall(profileCrew, profileExisting?.id)
            : undefined
        }
        callLoading={callLoading}
      />
    </>
  );
}
