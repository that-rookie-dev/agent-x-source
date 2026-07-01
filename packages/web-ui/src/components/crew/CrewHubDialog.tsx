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
import ForumIcon from '@mui/icons-material/Forum';
import SatelliteAltIcon from '@mui/icons-material/SatelliteAlt';
import type { Crew } from '../../api';
import { searchHubCatalog, resolveHubCrewById } from '../../data/crew-hub/loadHubCatalog';
import { crewDialogPaperSx, crewHubScanlineSx, crewOverlineSx, crewTheme, getCrewAccent } from '../../styles/crew-theme';
import { SkillChips } from './SkillChips';
import { CrewProfileDialog } from './CrewProfileDialog';
import { HubSectorNavItem } from './HubSectorNavItem';
import { MedicalCrewCardStripe, isMedicalCrewDisplay } from './MedicalDisclaimerBanner';
import { crewCallsignsMatch, crewDisplayFields } from '../../utils/crew-display';

export interface PrebuiltCrew {
  catalogId?: string;
  categoryId?: string;
  requiresMedicalDisclaimer?: boolean;
  honorsDoctorate?: boolean;
  name: string;
  title: string;
  callsign: string;
  description?: string;
  systemPrompt: string;
  tone: string;
  expertise: string[];
  traits: string[];
  tools?: string[];
  tags?: string[];
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
  onPrivateChat?: (crew: PrebuiltCrew, rosterCrewId?: string) => void;
  privateChatLoading?: boolean;
}

interface HubCardCrew {
  catalogId: string;
  categoryId: string;
  categoryLabel?: string;
  requiresMedicalDisclaimer?: boolean;
  honorsDoctorate?: boolean;
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
  onPrivateChat,
  privateChatLoading,
}: CrewHubDialogProps) {
  const activeCategory = categories[categoryIndex];
  const [profileCrew, setProfileCrew] = useState<PrebuiltCrew | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [searchLoading, setSearchLoading] = useState(false);
  const [, startSearchTransition] = useTransition();
  const [displayCrews, setDisplayCrews] = useState<HubCardCrew[]>([]);

  useEffect(() => {
    const handle = window.setTimeout(() => setDebouncedSearch(searchQuery), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [searchQuery]);

  const isSearching = debouncedSearch.trim().length > 0;
  const searchPending = searchQuery.trim() !== debouncedSearch.trim() || searchLoading;

  useEffect(() => {
    if (isSearching) {
      let cancelled = false;
      setSearchLoading(true);
      searchHubCatalog(debouncedSearch)
        .then((hits) => {
          if (cancelled) return;
          startSearchTransition(() => {
            setDisplayCrews(hits.map((hit) => ({
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
            })));
          });
        })
        .catch(() => {
          if (!cancelled) setDisplayCrews([]);
        })
        .finally(() => {
          if (!cancelled) setSearchLoading(false);
        });
      return () => { cancelled = true; };
    }
    if (!activeCategory) {
      setDisplayCrews([]);
      setSearchLoading(false);
      return;
    }
    setDisplayCrews(activeCategory.crews.map((crew) => ({
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
    })));
  }, [activeCategory, debouncedSearch, isSearching]);

  const searchStatusText = (() => {
    if (!isSearching) return '\u00a0';
    if (searchPending && displayCrews.length === 0) return 'Searching…';
    if (searchPending) return `${displayCrews.length} match${displayCrews.length === 1 ? '' : 'es'}…`;
    return `${displayCrews.length} match${displayCrews.length === 1 ? '' : 'es'} across all sectors`;
  })();

  const profileExisting = profileCrew
    ? crews.find((c) => crewCallsignsMatch(c.callsign, profileCrew.callsign))
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
    const existing = crews.find((c) => crewCallsignsMatch(c.callsign, item.callsign));
    if (existing) {
      onPrivateChat(crew, existing.id);
    } else {
      onPrivateChat(crew);
    }
  }, [crews, onPrivateChat, resolveCardCrew]);

  const chatIconButtonSx = (accentColor: string) => ({
    width: 28, height: 28, flexShrink: 0,
    borderRadius: '6px',
    border: `1px solid ${accentColor}50`,
    color: accentColor,
    '&:hover': { borderColor: accentColor, bgcolor: `${accentColor}12` },
  });

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

      <DialogContent sx={{
        px: 0,
        pt: '0 !important',
        pb: 0,
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'row',
        minHeight: 420,
      }}>
        {categoriesError ? (
          <Typography sx={{ fontSize: '0.72rem', color: crewTheme.accent.alert, py: 4, textAlign: 'center', width: '100%', px: 2.5 }}>
            {categoriesError}
          </Typography>
        ) : categoriesLoading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', py: 8, width: '100%' }}>
            <CircularProgress size={28} sx={{ color: crewTheme.text.secondary }} />
          </Box>
        ) : (
        <>
        {!isSearching && (
          <Box sx={{
            width: 232,
            flexShrink: 0,
            borderRight: `1px solid ${crewTheme.border.subtle}`,
            overflowY: 'auto',
            py: 1.25,
            px: 0.75,
            bgcolor: crewTheme.bg.inset,
          }}>
            <Typography sx={{
              fontSize: '0.5rem',
              fontFamily: "'JetBrains Mono', monospace",
              letterSpacing: '1px',
              color: crewTheme.text.dim,
              px: 0.75,
              mb: 0.75,
              textTransform: 'uppercase',
            }}>
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

        <Box sx={{
          flex: 1,
          minWidth: 0,
          overflowY: 'auto',
          px: 2.5,
          py: 1.5,
          display: 'flex',
          flexDirection: 'column',
        }}>
        <Box sx={{ minHeight: isSearching ? 20 : 0, mb: isSearching ? 1.5 : 0, flexShrink: 0 }}>
          <Typography sx={{
            fontSize: '0.62rem',
            color: crewTheme.text.secondary,
            fontFamily: "'JetBrains Mono', monospace",
            visibility: isSearching ? 'visible' : 'hidden',
          }}>
            {searchStatusText}
          </Typography>
        </Box>

        {!isSearching && activeCategory && (
          <Box sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 0.85,
            mb: 1.25,
            pb: 1,
            flexShrink: 0,
            borderBottom: `1px solid ${crewTheme.border.subtle}`,
          }}>
            <Box sx={{ display: 'flex', alignItems: 'center', color: crewTheme.text.secondary }}>
              {activeCategory.icon}
            </Box>
            <Typography sx={{
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
            }}>
              {activeCategory.label}
            </Typography>
            <Typography sx={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: '0.52rem',
              color: crewTheme.text.dim,
              flexShrink: 0,
            }}>
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
        <Box sx={{
          display: 'grid',
          gridTemplateColumns: `repeat(auto-fill, minmax(${crewTheme.grid.hubMinCard}px, 1fr))`,
          gap: `${crewTheme.grid.gap}px`,
        }}>
          {displayCrews.map((pc) => {
            const categoryLabel = pc.categoryLabel;
            const existing = crews.find((c) => crewCallsignsMatch(c.callsign, pc.callsign));
            const imported = !!existing;
            const { displayName, displayCallsign } = crewDisplayFields({
              name: pc.name,
              callsign: pc.callsign,
              title: pc.title,
              categoryId: pc.categoryId,
              expertise: pc.expertise,
              requiresMedicalDisclaimer: pc.requiresMedicalDisclaimer,
              honorsDoctorate: pc.honorsDoctorate,
            });
            const accent = getCrewAccent(undefined, displayCallsign);
            const isLoading = importLoading === pc.callsign;
            const isMedical = isMedicalCrewDisplay({
              categoryId: pc.categoryId,
              requiresMedicalDisclaimer: pc.requiresMedicalDisclaimer,
              catalogId: pc.catalogId,
              callsign: pc.callsign,
            });

            return (
              <Box key={pc.callsign} sx={{
                borderRadius: '8px',
                bgcolor: crewTheme.bg.card,
                border: `1px solid ${imported ? crewTheme.border.strong : crewTheme.border.default}`,
                minHeight: crewTheme.grid.hubCardHeight,
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden',
                transition: 'border-color 0.15s ease',
                '&:hover': { borderColor: crewTheme.border.strong },
              }}>
                {isMedical && <MedicalCrewCardStripe />}
                <Box sx={{
                  p: 1.5,
                  flex: 1,
                  display: 'flex',
                  flexDirection: 'column',
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
                    {displayCallsign.slice(0, 2).toUpperCase()}
                  </Box>
                  <Box sx={{ minWidth: 0, flex: 1 }}>
                    <Typography sx={{ fontWeight: 600, fontSize: '0.8rem', color: crewTheme.text.primary, lineHeight: 1.2 }}>
                      {displayName}
                    </Typography>
                    <Typography sx={{ fontSize: '0.65rem', color: crewTheme.text.secondary, mt: 0.15 }}>
                      {pc.title}
                    </Typography>
                    <Typography sx={{ fontSize: '0.58rem', color: accent, fontFamily: "'JetBrains Mono', monospace", mt: 0.15 }}>
                      @{displayCallsign}
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
                    {onPrivateChat && (
                      <Tooltip title="Private chat" arrow>
                        <IconButton
                          size="small"
                          onClick={() => { void handleQuickChat(pc); }}
                          disabled={privateChatLoading}
                          sx={chatIconButtonSx(accent)}
                        >
                          <ForumIcon sx={{ fontSize: 14 }} />
                        </IconButton>
                      </Tooltip>
                    )}
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
                    {onPrivateChat && (
                      <Tooltip title="Private chat" arrow>
                        <IconButton
                          size="small"
                          onClick={() => { void handleQuickChat(pc); }}
                          disabled={privateChatLoading}
                          sx={chatIconButtonSx(accent)}
                        >
                          <ForumIcon sx={{ fontSize: 14 }} />
                        </IconButton>
                      </Tooltip>
                    )}
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
              </Box>
            );
          })}
        </Box>
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
      onPrivateChat={profileCrew && onPrivateChat
        ? () => onPrivateChat(profileCrew, profileExisting?.id)
        : undefined}
      privateChatLoading={privateChatLoading}
    />
    </>
  );
}
