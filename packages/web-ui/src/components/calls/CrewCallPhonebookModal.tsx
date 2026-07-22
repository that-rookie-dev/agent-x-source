import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Dialog from '@mui/material/Dialog';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import IconButton from '@mui/material/IconButton';
import InputBase from '@mui/material/InputBase';
import Typography from '@mui/material/Typography';
import CloseIcon from '@mui/icons-material/Close';
import GroupsIcon from '@mui/icons-material/Groups';
import PhoneInTalkIcon from '@mui/icons-material/PhoneInTalk';
import SearchIcon from '@mui/icons-material/Search';
import { crews, type Crew } from '../../api';
import { getCrewAccent } from '../../styles/crew-theme';
import { crewDisplayFields } from '../../utils/crew-display';
import { colors, alphaColor, MONO } from '../../theme';
import { useCrewCall, crewCallTargetFromRoster } from '../crew-call';

/**
 * Phonebook picker for starting a new crew call from the Calls panel.
 * Lists already-recruited roster members; select to preview, Call to connect.
 */
export function CrewCallPhonebookModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const { startCall, isActive } = useCrewCall();
  const [roster, setRoster] = useState<Crew[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [calling, setCalling] = useState(false);

  const browseCrew = useCallback(() => {
    onClose();
    navigate('/console/crews');
  }, [navigate, onClose]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setQuery('');
    setSelectedId(null);
    setCalling(false);
    void crews.list()
      .then((list) => {
        if (!cancelled) setRoster(list.filter((c) => c.enabled !== false));
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load roster');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return roster;
    return roster.filter((c) =>
      c.name.toLowerCase().includes(q)
      || c.callsign.toLowerCase().includes(q)
      || (c.title?.toLowerCase().includes(q) ?? false),
    );
  }, [roster, query]);

  const selected = useMemo(
    () => (selectedId ? roster.find((c) => c.id === selectedId) ?? null : null),
    [roster, selectedId],
  );

  useEffect(() => {
    if (!selectedId) return;
    if (!filtered.some((c) => c.id === selectedId)) setSelectedId(null);
  }, [filtered, selectedId]);

  const handleCall = useCallback(async () => {
    if (!selected || isActive || calling) return;
    setCalling(true);
    try {
      await startCall(crewCallTargetFromRoster(selected, getCrewAccent(selected.color, selected.callsign)));
      onClose();
    } catch {
      /* provider surfaces errors */
    } finally {
      setCalling(false);
    }
  }, [calling, isActive, onClose, selected, startCall]);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="md"
      fullWidth
      PaperProps={{
        sx: {
          bgcolor: colors.bg.secondary,
          color: colors.text.primary,
          border: `1px solid ${colors.border.default}`,
          borderRadius: '8px',
          maxHeight: '78vh',
          height: { xs: 'auto', sm: 'min(560px, 78vh)' },
          backgroundImage: 'none',
        },
      }}
    >
      <DialogTitle sx={{
        px: 2, py: 1.25,
        display: 'flex', alignItems: 'center', gap: 1,
        borderBottom: `1px solid ${colors.border.default}`,
        fontFamily: MONO,
        fontSize: '0.75rem',
        letterSpacing: '1px',
        color: colors.text.primary,
      }}>
        <PhoneInTalkIcon sx={{ fontSize: 16, color: colors.accent.blue }} />
        PHONEBOOK
        <Box sx={{ flex: 1 }} />
        <IconButton size="small" onClick={onClose} sx={{ color: colors.text.dim }}>
          <CloseIcon sx={{ fontSize: 16 }} />
        </IconButton>
      </DialogTitle>

      <DialogContent sx={{
        p: 0,
        display: 'grid',
        gridTemplateColumns: { xs: '1fr', sm: 'minmax(0, 1fr) minmax(0, 1.05fr)' },
        minHeight: 280,
        flex: 1,
        overflow: 'hidden',
      }}>
        {/* Left: roster list */}
        <Box sx={{
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
          borderRight: { sm: `1px solid ${colors.border.default}` },
          borderBottom: { xs: `1px solid ${colors.border.default}`, sm: 'none' },
          maxHeight: { xs: 260, sm: 'none' },
        }}>
          <Box sx={{
            px: 1.5, py: 1,
            borderBottom: `1px solid ${colors.border.default}`,
            display: 'flex', alignItems: 'center', gap: 0.75,
            flexShrink: 0,
          }}>
            <SearchIcon sx={{ fontSize: 14, color: colors.text.dim }} />
            <InputBase
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search recruited crew…"
              sx={{
                flex: 1,
                fontFamily: MONO,
                fontSize: '0.65rem',
                color: colors.text.primary,
                '& input::placeholder': { color: colors.text.dim, opacity: 1 },
              }}
            />
          </Box>

          <Box sx={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
            {loading ? (
              <Box sx={{ py: 5, display: 'flex', justifyContent: 'center' }}>
                <CircularProgress size={20} sx={{ color: colors.text.dim }} />
              </Box>
            ) : error ? (
              <Typography sx={{ p: 2, fontFamily: MONO, fontSize: '0.65rem', color: colors.accent.red }}>
                {error}
              </Typography>
            ) : filtered.length === 0 ? (
              <Box sx={{ p: 3, textAlign: 'center' }}>
                <Typography sx={{ fontFamily: MONO, fontSize: '0.65rem', color: colors.text.dim, mb: 1 }}>
                  {roster.length === 0 ? 'No recruited crew yet' : 'No matches'}
                </Typography>
                {roster.length === 0 && (
                  <>
                    <Typography sx={{ fontFamily: MONO, fontSize: '0.55rem', color: colors.text.dim, mb: 1.75 }}>
                      Recruit specialists from Crews, then start a call here.
                    </Typography>
                    <Button
                      size="small"
                      startIcon={<GroupsIcon sx={{ fontSize: 14 }} />}
                      onClick={browseCrew}
                      sx={{
                        fontFamily: MONO,
                        fontSize: '0.55rem',
                        letterSpacing: '0.08em',
                        color: colors.accent.blue,
                        border: `1px solid ${alphaColor(colors.accent.blue, 0.4)}`,
                        '&:hover': {
                          bgcolor: alphaColor(colors.accent.blue, 0.12),
                          borderColor: alphaColor(colors.accent.blue, 0.65),
                        },
                      }}
                    >
                      BROWSE CREW
                    </Button>
                  </>
                )}
              </Box>
            ) : (
              filtered.map((crew) => {
                const accent = getCrewAccent(crew.color, crew.callsign);
                const active = selectedId === crew.id;
                return (
                  <Box
                    key={crew.id}
                    component="button"
                    type="button"
                    onClick={() => setSelectedId(crew.id)}
                    sx={{
                      all: 'unset',
                      boxSizing: 'border-box',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 1,
                      width: '100%',
                      px: 1.5,
                      py: 1,
                      cursor: 'pointer',
                      borderBottom: `1px solid ${colors.border.subtle}`,
                      borderLeft: active ? `2px solid ${accent}` : '2px solid transparent',
                      bgcolor: active ? alphaColor(accent, 0.1) : 'transparent',
                      '&:hover': { bgcolor: active ? alphaColor(accent, 0.12) : alphaColor(accent, 0.06) },
                    }}
                  >
                    <Box sx={{
                      width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      bgcolor: accent, color: colors.bg.primary,
                      fontFamily: MONO, fontSize: '0.55rem', fontWeight: 700,
                    }}>
                      {(crew.callsign || crew.name || '?').slice(0, 2).toUpperCase()}
                    </Box>
                    <Box sx={{ minWidth: 0, flex: 1 }}>
                      <Typography sx={{
                        fontFamily: MONO, fontSize: '0.7rem', fontWeight: 600,
                        color: colors.text.primary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>
                        {crew.name}
                      </Typography>
                      <Typography sx={{
                        fontFamily: MONO, fontSize: '0.52rem', color: colors.text.dim,
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>
                        @{crew.callsign}{crew.title ? ` · ${crew.title}` : ''}
                      </Typography>
                    </Box>
                  </Box>
                );
              })
            )}
          </Box>
        </Box>

        {/* Right: detail + call */}
        <Box sx={{
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
          bgcolor: alphaColor(colors.bg.primary, '40'),
        }}>
          {!selected ? (
            <Box sx={{
              flex: 1, display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center', gap: 1.5,
              px: 3, py: 4, textAlign: 'center',
            }}>
              <Typography sx={{ fontFamily: MONO, fontSize: '0.62rem', color: colors.text.dim, lineHeight: 1.5 }}>
                {roster.length === 0 && !loading
                  ? 'Recruit a specialist to fill your phonebook'
                  : 'Select a crew member to view details'}
              </Typography>
              {roster.length === 0 && !loading && (
                <Button
                  size="small"
                  startIcon={<GroupsIcon sx={{ fontSize: 14 }} />}
                  onClick={browseCrew}
                  sx={{
                    fontFamily: MONO,
                    fontSize: '0.55rem',
                    letterSpacing: '0.08em',
                    color: colors.accent.blue,
                    border: `1px solid ${alphaColor(colors.accent.blue, 0.4)}`,
                    '&:hover': {
                      bgcolor: alphaColor(colors.accent.blue, 0.12),
                      borderColor: alphaColor(colors.accent.blue, 0.65),
                    },
                  }}
                >
                  BROWSE CREW
                </Button>
              )}
            </Box>
          ) : (
            <PhonebookCrewDetail
              crew={selected}
              calling={calling}
              callBusy={isActive}
              onCall={() => { void handleCall(); }}
            />
          )}
        </Box>
      </DialogContent>
    </Dialog>
  );
}

function PhonebookCrewDetail({
  crew,
  calling,
  callBusy,
  onCall,
}: {
  crew: Crew;
  calling: boolean;
  /** Another call is already active. */
  callBusy: boolean;
  onCall: () => void;
}) {
  const accent = getCrewAccent(crew.color, crew.callsign);
  const { displayName, displayCallsign } = crewDisplayFields({
    name: crew.name,
    callsign: crew.callsign,
    title: crew.title,
    expertise: crew.expertise,
  });
  const expertise = (crew.expertise ?? []).filter(Boolean).slice(0, 8);
  const traits = (crew.traits ?? []).filter(Boolean).slice(0, 8);

  return (
    <>
      <Box sx={{ flex: 1, overflowY: 'auto', minHeight: 0, px: 2, py: 1.75 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, mb: 1.5 }}>
          <Box sx={{
            width: 48, height: 48, borderRadius: '50%', flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            bgcolor: accent, color: colors.bg.primary,
            fontFamily: MONO, fontSize: '0.75rem', fontWeight: 700,
            boxShadow: `0 0 0 3px ${alphaColor(accent, 0.22)}`,
          }}>
            {(displayCallsign || displayName || '?').slice(0, 2).toUpperCase()}
          </Box>
          <Box sx={{ minWidth: 0 }}>
            <Typography sx={{
              fontFamily: MONO, fontSize: '0.85rem', fontWeight: 700,
              color: colors.text.primary, lineHeight: 1.25,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {displayName}
            </Typography>
            <Typography sx={{ fontFamily: MONO, fontSize: '0.58rem', color: accent, mt: 0.2 }}>
              @{displayCallsign}
            </Typography>
            {crew.title && (
              <Typography sx={{
                fontFamily: MONO, fontSize: '0.55rem', color: colors.text.secondary, mt: 0.35,
              }}>
                {crew.title}
              </Typography>
            )}
          </Box>
        </Box>

        {crew.description?.trim() && (
          <DetailBlock label="About">
            <Typography sx={{
              fontFamily: MONO, fontSize: '0.6rem', color: colors.text.secondary,
              lineHeight: 1.55, whiteSpace: 'pre-wrap',
            }}>
              {crew.description.trim()}
            </Typography>
          </DetailBlock>
        )}

        {expertise.length > 0 && (
          <DetailBlock label="Expertise">
            <ChipRow items={expertise} accent={accent} />
          </DetailBlock>
        )}

        {traits.length > 0 && (
          <DetailBlock label="Traits">
            <ChipRow items={traits} accent={colors.text.dim} />
          </DetailBlock>
        )}

        {!crew.description?.trim() && expertise.length === 0 && traits.length === 0 && (
          <Typography sx={{ fontFamily: MONO, fontSize: '0.55rem', color: colors.text.dim }}>
            No additional profile details on file.
          </Typography>
        )}
      </Box>

      <Box sx={{
        px: 2, py: 1.25,
        borderTop: `1px solid ${colors.border.default}`,
        flexShrink: 0,
      }}>
        <Button
          fullWidth
          variant="contained"
          disabled={callBusy || calling}
          onClick={onCall}
          startIcon={calling
            ? <CircularProgress size={14} color="inherit" />
            : <PhoneInTalkIcon sx={{ fontSize: 16 }} />}
          sx={{
            height: 40,
            fontFamily: MONO,
            fontSize: '0.65rem',
            letterSpacing: '0.1em',
            fontWeight: 700,
            bgcolor: alphaColor(accent, 0.22),
            color: accent,
            border: `1px solid ${alphaColor(accent, 0.55)}`,
            boxShadow: 'none',
            '&:hover': { bgcolor: alphaColor(accent, 0.32), boxShadow: 'none' },
            '&.Mui-disabled': {
              bgcolor: alphaColor(colors.text.dim, 0.08),
              color: colors.text.dim,
              borderColor: colors.border.default,
            },
          }}
        >
          {calling ? 'CONNECTING…' : callBusy ? 'CALL IN PROGRESS' : 'CALL'}
        </Button>
      </Box>
    </>
  );
}

function DetailBlock({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Box sx={{ mb: 1.5 }}>
      <Typography sx={{
        fontFamily: MONO, fontSize: '0.48rem', letterSpacing: '0.12em',
        color: colors.text.dim, textTransform: 'uppercase', mb: 0.55,
      }}>
        {label}
      </Typography>
      {children}
    </Box>
  );
}

function ChipRow({ items, accent }: { items: string[]; accent: string }) {
  return (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
      {items.map((item) => (
        <Box
          key={item}
          sx={{
            px: 0.7, py: 0.25, borderRadius: '4px',
            border: `1px solid ${alphaColor(accent, 0.35)}`,
            bgcolor: alphaColor(accent, 0.08),
            fontFamily: MONO, fontSize: '0.5rem', color: colors.text.secondary,
          }}
        >
          {item}
        </Box>
      ))}
    </Box>
  );
}
