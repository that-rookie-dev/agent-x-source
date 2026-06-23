import { useCallback, useEffect, useState, useTransition } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import TextField from '@mui/material/TextField';
import InputAdornment from '@mui/material/InputAdornment';
import CircularProgress from '@mui/material/CircularProgress';
import Tooltip from '@mui/material/Tooltip';
import Chip from '@mui/material/Chip';
import HubIcon from '@mui/icons-material/Hub';
import CloseIcon from '@mui/icons-material/Close';
import SearchIcon from '@mui/icons-material/Search';
import AssignmentIndIcon from '@mui/icons-material/AssignmentInd';
import SatelliteAltIcon from '@mui/icons-material/SatelliteAlt';
import type { Crew } from '../../api';
import { loadCrewSearchIndex, resolveHubCrew, searchCrewHub } from '../../data/crew-hub/loadPrebuiltCategories';
import { crewDialogPaperSx, crewHubScanlineSx, crewOverlineSx, crewTheme, getCrewAccent } from '../../styles/crew-theme';
import { SkillChips } from './SkillChips';
import { CrewProfileDialog } from './CrewProfileDialog';

export interface PrebuiltCrew {
  name: string;
  title: string;
  callsign: string;
  description?: string;
  systemPrompt: string;
  tone: string;
  expertise: string[];
  traits: string[];
  tools?: string[];
}

export interface PrebuiltCategory {
  id: string;
  label: string;
  icon: React.JSX.Element;
  crews: PrebuiltCrew[];
}

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
}

interface HubCardCrew {
  categoryId: string;
  categoryLabel?: string;
  name: string;
  title: string;
  callsign: string;
  description?: string;
  tone: string;
  expertise: string[];
  traits: string[];
  fullCrew?: PrebuiltCrew;
}

const SEARCH_DEBOUNCE_MS = 180;

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
}: CrewHubDialogProps) {
  const activeCategory = categories[categoryIndex];
  const [profileCrew, setProfileCrew] = useState<PrebuiltCrew | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [searchReady, setSearchReady] = useState(false);
  const [, startSearchTransition] = useTransition();
  const [displayCrews, setDisplayCrews] = useState<HubCardCrew[]>([]);

  useEffect(() => {
    if (!open) {
      setSearchReady(false);
      return;
    }
    let cancelled = false;
    loadCrewSearchIndex().then(() => {
      if (!cancelled) setSearchReady(true);
    });
    return () => { cancelled = true; };
  }, [open]);

  useEffect(() => {
    const handle = window.setTimeout(() => setDebouncedSearch(searchQuery), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [searchQuery]);

  const isSearching = debouncedSearch.trim().length > 0;
  const searchPending = searchQuery.trim() !== debouncedSearch.trim()
    || (searchQuery.trim().length > 0 && !searchReady);

  useEffect(() => {
    if (isSearching) {
      if (!searchReady) {
        setDisplayCrews([]);
        return;
      }
      startSearchTransition(() => {
        setDisplayCrews(searchCrewHub(debouncedSearch).map((hit) => ({
          categoryId: hit.categoryId,
          categoryLabel: hit.categoryLabel,
          name: hit.name,
          title: hit.title,
          callsign: hit.callsign,
          tone: 'professional',
          expertise: hit.expertise,
          traits: [],
        })));
      });
      return;
    }
    if (!activeCategory) {
      setDisplayCrews([]);
      return;
    }
    setDisplayCrews(activeCategory.crews.map((crew) => ({
      categoryId: activeCategory.id,
      name: crew.name,
      title: crew.title,
      callsign: crew.callsign,
      description: crew.description,
      tone: crew.tone,
      expertise: crew.expertise,
      traits: crew.traits,
      fullCrew: crew,
    })));
  }, [activeCategory, debouncedSearch, isSearching, searchReady]);

  const profileExisting = profileCrew
    ? crews.find((c) => c.callsign.toLowerCase() === profileCrew.callsign.toLowerCase())
    : undefined;

  const resolveCardCrew = useCallback(async (item: HubCardCrew): Promise<PrebuiltCrew | undefined> => {
    if (item.fullCrew) return item.fullCrew;
    return resolveHubCrew(item.categoryId, item.callsign);
  }, []);

  const handleOpenProfile = useCallback(async (item: HubCardCrew) => {
    const crew = await resolveCardCrew(item);
    if (crew) setProfileCrew(crew);
  }, [resolveCardCrew]);

  const handleRecruit = useCallback(async (item: HubCardCrew) => {
    const crew = await resolveCardCrew(item);
    if (crew) onImport(crew);
  }, [onImport, resolveCardCrew]);

  const handleClose = () => {
    setSearchQuery('');
    setDebouncedSearch('');
    setProfileCrew(null);
    onClose();
  };

  return (
    <>
    <Dialog open={open} onClose={handleClose} maxWidth="lg" fullWidth
      PaperProps={{ sx: { ...crewDialogPaperSx, maxHeight: '88vh', position: 'relative' } }}>
      <Box sx={crewHubScanlineSx} />

      <DialogTitle sx={{
        px: 2.5, pt: 2, pb: 1.25,
        borderBottom: `1px solid ${crewTheme.border.subtle}`,
        flexShrink: 0,
      }}>
        <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 1.5 }}>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.5 }}>
              <SatelliteAltIcon sx={{ fontSize: 15, color: crewTheme.text.secondary }} />
              <Typography sx={crewOverlineSx}>Personnel Acquisition</Typography>
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <HubIcon sx={{ color: crewTheme.text.primary, fontSize: 14 }} />
              <Typography sx={{
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: '0.95rem', fontWeight: 700, letterSpacing: '2px',
                color: crewTheme.text.primary,
              }}>
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
            <IconButton size="small" onClick={handleClose}
              sx={{ color: crewTheme.text.dim, border: `1px solid ${crewTheme.border.default}`, borderRadius: '6px', p: 0.5 }}>
              <CloseIcon sx={{ fontSize: 16 }} />
            </IconButton>
          </Box>
        </Box>
      </DialogTitle>

      <DialogContent sx={{ px: 2.5, pt: '14px !important', pb: 2.5, overflow: 'auto' }}>
        {categoriesError ? (
          <Typography sx={{ fontSize: '0.72rem', color: crewTheme.accent.alert, py: 4, textAlign: 'center' }}>
            {categoriesError}
          </Typography>
        ) : categoriesLoading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', py: 8 }}>
            <CircularProgress size={28} sx={{ color: crewTheme.text.secondary }} />
          </Box>
        ) : (
        <>
        {!searchQuery.trim() && (
          <Box sx={{
            display: 'flex',
            flexWrap: 'nowrap',
            gap: 0.5,
            mb: 1.5,
            overflowX: 'auto',
            overflowY: 'hidden',
            pb: 0.5,
            scrollbarWidth: 'none',
            msOverflowStyle: 'none',
            '&::-webkit-scrollbar': { display: 'none' },
          }}>
            {categories.map((cat, idx) => {
              const selected = categoryIndex === idx;
              return (
                <Button
                  key={cat.id}
                  size="small"
                  variant={selected ? 'contained' : 'outlined'}
                  startIcon={cat.icon}
                  onClick={() => onCategoryChange(idx)}
                  sx={{
                    flexShrink: 0,
                    fontSize: '0.62rem',
                    fontFamily: "'JetBrains Mono', monospace",
                    letterSpacing: '0.3px',
                    textTransform: 'uppercase',
                    minHeight: 30,
                    px: 1,
                    py: 0.25,
                    whiteSpace: 'nowrap',
                    borderColor: selected ? crewTheme.text.primary : crewTheme.border.default,
                    color: selected ? crewTheme.bg.void : crewTheme.text.dim,
                    bgcolor: selected ? crewTheme.text.primary : 'transparent',
                    '&:hover': {
                      borderColor: crewTheme.text.primary,
                      bgcolor: selected ? '#e0e0e0' : crewTheme.bg.cardHover,
                    },
                    '& .MuiButton-startIcon': { mr: 0.5, ml: 0 },
                    '& .MuiButton-startIcon > *:nth-of-type(1)': { fontSize: 14 },
                  }}
                >
                  {cat.label}
                </Button>
              );
            })}
          </Box>
        )}

        {isSearching && !searchPending && (
          <Typography sx={{ fontSize: '0.62rem', color: crewTheme.text.secondary, mb: 1.5, fontFamily: "'JetBrains Mono', monospace" }}>
            {displayCrews.length} match{displayCrews.length === 1 ? '' : 'es'} across all sectors
          </Typography>
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
        <Box sx={{
          display: 'grid',
          gridTemplateColumns: `repeat(auto-fill, minmax(${crewTheme.grid.hubMinCard}px, 1fr))`,
          gap: `${crewTheme.grid.gap}px`,
        }}>
          {displayCrews.map((pc) => {
            const categoryLabel = pc.categoryLabel;
            const existing = crews.find((c) => c.callsign.toLowerCase() === pc.callsign.toLowerCase());
            const imported = !!existing;
            const accent = getCrewAccent(undefined, pc.callsign);
            const isLoading = importLoading === pc.callsign;

            return (
              <Box key={pc.callsign} sx={{
                p: 1.5,
                borderRadius: '8px',
                bgcolor: crewTheme.bg.card,
                border: `1px solid ${imported ? crewTheme.border.strong : crewTheme.border.default}`,
                minHeight: crewTheme.grid.hubCardHeight,
                display: 'flex',
                flexDirection: 'column',
                transition: 'border-color 0.15s ease',
                '&:hover': { borderColor: crewTheme.border.strong },
              }}>
                {categoryLabel && (
                  <Chip
                    label={categoryLabel}
                    size="small"
                    sx={{
                      alignSelf: 'flex-start',
                      mb: 0.5,
                      height: 18,
                      fontSize: '0.5rem',
                      fontFamily: "'JetBrains Mono', monospace",
                      letterSpacing: '0.3px',
                      bgcolor: crewTheme.bg.inset,
                      color: crewTheme.text.secondary,
                      border: `1px solid ${crewTheme.border.default}`,
                    }}
                  />
                )}
                <Box sx={{ display: 'flex', gap: 0.85, mb: 0.65, flex: 1 }}>
                  <Box sx={{
                    width: 28, height: 28, borderRadius: '6px', flexShrink: 0,
                    bgcolor: crewTheme.bg.inset,
                    border: `1px solid ${crewTheme.border.default}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '0.55rem', fontWeight: 700, color: accent,
                    fontFamily: "'JetBrains Mono', monospace",
                  }}>
                    {pc.callsign.slice(0, 2).toUpperCase()}
                  </Box>
                  <Box sx={{ minWidth: 0, flex: 1 }}>
                    <Typography sx={{ fontWeight: 600, fontSize: '0.8rem', color: crewTheme.text.primary, lineHeight: 1.2 }}>
                      {pc.name}
                    </Typography>
                    <Typography sx={{ fontSize: '0.65rem', color: crewTheme.text.secondary, mt: 0.15 }}>
                      {pc.title}
                    </Typography>
                    <Typography sx={{ fontSize: '0.58rem', color: accent, fontFamily: "'JetBrains Mono', monospace", mt: 0.15 }}>
                      @{pc.callsign}
                    </Typography>
                  </Box>
                  {imported && (
                    <Box sx={{
                      width: 6, height: 6, borderRadius: '50%', flexShrink: 0, mt: 0.5,
                      bgcolor: crewTheme.accent.signal,
                    }} />
                  )}
                </Box>

                <Box sx={{ mb: 0.85 }}>
                  <SkillChips items={pc.expertise} variant="hub" />
                </Box>

                {imported ? (
                  <Box sx={{ display: 'flex', gap: 0.5, mt: 'auto' }}>
                    <Tooltip title="View dossier" arrow>
                      <IconButton
                        size="small"
                        onClick={() => { void handleOpenProfile(pc); }}
                        sx={{
                          width: 28, height: 28, flexShrink: 0,
                          borderRadius: '6px',
                          border: `1px solid ${crewTheme.border.strong}`,
                          color: crewTheme.text.secondary,
                          '&:hover': { borderColor: crewTheme.text.primary, color: crewTheme.text.primary, bgcolor: crewTheme.bg.cardHover },
                        }}
                      >
                        <AssignmentIndIcon sx={{ fontSize: 14 }} />
                      </IconButton>
                    </Tooltip>
                    <Button size="small" variant="outlined" fullWidth
                      onClick={() => existing && onRemove(existing.id)}
                      sx={{
                        fontSize: '0.62rem', fontFamily: "'JetBrains Mono', monospace",
                        letterSpacing: '0.5px', py: 0.4, minHeight: 28,
                        borderColor: crewTheme.border.danger, color: crewTheme.accent.alert,
                        '&:hover': { borderColor: crewTheme.accent.alert, bgcolor: 'rgba(248,81,73,0.08)' },
                      }}>
                      DEACTIVATE
                    </Button>
                  </Box>
                ) : (
                  <Box sx={{ display: 'flex', gap: 0.5, mt: 'auto' }}>
                    <Tooltip title="View dossier" arrow>
                      <IconButton
                        size="small"
                        onClick={() => { void handleOpenProfile(pc); }}
                        sx={{
                          width: 28, height: 28, flexShrink: 0,
                          borderRadius: '6px',
                          border: `1px solid ${crewTheme.border.strong}`,
                          color: crewTheme.text.secondary,
                          '&:hover': { borderColor: crewTheme.text.primary, color: crewTheme.text.primary, bgcolor: crewTheme.bg.cardHover },
                        }}
                      >
                        <AssignmentIndIcon sx={{ fontSize: 14 }} />
                      </IconButton>
                    </Tooltip>
                    <Button size="small" variant="outlined" fullWidth
                      onClick={() => { void handleRecruit(pc); }}
                      disabled={isLoading || imported}
                      sx={{
                        fontSize: '0.62rem', fontFamily: "'JetBrains Mono', monospace",
                        letterSpacing: '0.5px', py: 0.4, minHeight: 28,
                        borderColor: crewTheme.border.strong, color: crewTheme.text.primary,
                        '&:hover': { borderColor: crewTheme.text.primary, bgcolor: crewTheme.bg.cardHover },
                      }}>
                      {isLoading ? <CircularProgress size={12} sx={{ mr: 0.5 }} /> : null}
                      RECRUIT
                    </Button>
                  </Box>
                )}
              </Box>
            );
          })}
        </Box>
        )}
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
    />
    </>
  );
}
