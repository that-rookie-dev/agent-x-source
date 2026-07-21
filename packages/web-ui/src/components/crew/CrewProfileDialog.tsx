import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Switch from '@mui/material/Switch';
import Dialog from '@mui/material/Dialog';
import DialogContent from '@mui/material/DialogContent';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import ChatIcon from '@mui/icons-material/Chat';
import PhoneInTalkIcon from '@mui/icons-material/PhoneInTalk';
import CloseIcon from '@mui/icons-material/Close';
import AssignmentIndIcon from '@mui/icons-material/AssignmentInd';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import type { PrebuiltCrew } from './hub-types';
import { crewDialogPaperSx, crewHubScanlineSx, crewOverlineSx, crewTheme, getCrewAccent } from '../../styles/crew-theme';
import { MedicalDisclaimerSectorCard, MedicalProfileIdentityFrame, isMedicalCrewDisplay } from './MedicalDisclaimerBanner';
import { crewDisplayFields } from '../../utils/crew-display';

import { colors, alphaColor } from '../../theme';
export interface RosterProfileActions {
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
  onEdit: () => void;
  onDelete: () => void;
  onRegenerate?: () => void;
  regenerating?: boolean;
}

interface CrewProfileDialogProps {
  open: boolean;
  crew: PrebuiltCrew | null;
  imported: boolean;
  importLoading?: boolean;
  onClose: () => void;
  /** Omit to hide Recruit (e.g. chat dossier view-only). */
  onImport?: () => void;
  onRemove?: () => void;
  /** Open private 1:1 crew chat (recruits from hub if needed) */
  onPrivateChat?: () => void;
  privateChatLoading?: boolean;
  /** Start secure voice call with this crew persona */
  onCall?: () => void;
  callLoading?: boolean;
  /** When set, dialog runs in roster mode with edit/delete/toggle actions */
  rosterActions?: RosterProfileActions;
  accentColor?: string;
}

function MetaField({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <Box sx={{
      p: 1,
      borderRadius: '6px',
      bgcolor: crewTheme.bg.inset,
      border: `1px solid ${crewTheme.border.subtle}`,
    }}>
      <Typography sx={{
        fontSize: '0.5rem',
        fontFamily: "'JetBrains Mono', monospace",
        letterSpacing: '1.5px',
        color: crewTheme.text.dim,
        textTransform: 'uppercase',
        mb: 0.35,
      }}>
        {label}
      </Typography>
      <Typography sx={{
        fontSize: '0.68rem',
        fontFamily: "'JetBrains Mono', monospace",
        color: accent ?? crewTheme.text.primary,
        lineHeight: 1.3,
        wordBreak: 'break-word',
      }}>
        {value}
      </Typography>
    </Box>
  );
}

function IdentityBlockContent({ crew, accent }: { crew: PrebuiltCrew; accent: string }) {
  return (
    <>
      <Box sx={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        opacity: 0.06,
        backgroundImage: `repeating-linear-gradient(-24deg, transparent, transparent 8px, ${colors.ink} 8px, ${colors.ink} 9px)`,
      }} />
      <Typography sx={{
        position: 'absolute',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%) rotate(-18deg)',
        fontSize: '1.4rem',
        fontFamily: "'JetBrains Mono', monospace",
        fontWeight: 800,
        letterSpacing: '6px',
        color: crewTheme.accent.alert,
        opacity: 0.12,
        whiteSpace: 'nowrap',
        userSelect: 'none',
      }}>
        CLASSIFIED
      </Typography>

      <Box sx={{ display: 'flex', gap: 1.25, alignItems: 'flex-start', position: 'relative' }}>
        <RedactedAvatar />
        <IdentityText crew={crew} accent={accent} />
      </Box>
    </>
  );
}

function RedactedAvatar() {
  return (
    <Box sx={{
      width: 56,
      height: 56,
      flexShrink: 0,
      borderRadius: '6px',
      bgcolor: crewTheme.bg.inset,
      border: `1px dashed ${crewTheme.border.strong}`,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 0.25,
    }}>
      <Box sx={{ width: '70%', height: 3, bgcolor: crewTheme.border.strong, borderRadius: 1 }} />
      <Box sx={{ width: '55%', height: 3, bgcolor: crewTheme.border.default, borderRadius: 1 }} />
      <Box sx={{ width: '65%', height: 3, bgcolor: crewTheme.border.default, borderRadius: 1 }} />
      <Typography sx={{
        fontSize: '0.45rem',
        fontFamily: "'JetBrains Mono', monospace",
        color: crewTheme.text.dim,
        letterSpacing: '0.5px',
        mt: 0.25,
      }}>
        REDACTED
      </Typography>
    </Box>
  );
}

function IdentityText({ crew, accent }: { crew: PrebuiltCrew; accent: string }) {
  const { displayName, displayCallsign } = crewDisplayFields({
    name: crew.name,
    callsign: crew.callsign,
    title: crew.title,
    categoryId: crew.categoryId,
    expertise: crew.expertise,
    requiresMedicalDisclaimer: crew.requiresMedicalDisclaimer,
    honorsDoctorate: crew.honorsDoctorate,
  });
  return (
    <Box sx={{ flex: 1, minWidth: 0 }}>
      <Typography sx={{
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: '0.95rem',
        fontWeight: 700,
        letterSpacing: '0.5px',
        color: crewTheme.text.primary,
        lineHeight: 1.2,
      }}>
        {displayName}
      </Typography>
      <Typography sx={{ fontSize: '0.72rem', color: crewTheme.text.secondary, mt: 0.35 }}>
        {crew.title}
      </Typography>
      <Typography sx={{
        fontSize: '0.62rem',
        color: accent,
        fontFamily: "'JetBrains Mono', monospace",
        mt: 0.5,
      }}>
        @{displayCallsign}
      </Typography>
    </Box>
  );
}

function IdentityBlock({ crew, accent }: { crew: PrebuiltCrew; accent: string }) {
  return (
    <Box sx={{
      position: 'relative',
      mb: 2,
      p: 1.5,
      borderRadius: '8px',
      border: `1px solid ${crewTheme.border.strong}`,
      bgcolor: crewTheme.bg.card,
      overflow: 'hidden',
    }}>
      <IdentityBlockContent crew={crew} accent={accent} />
    </Box>
  );
}

export function CrewProfileDialog({
  open,
  crew,
  imported,
  importLoading,
  onClose,
  onImport,
  onRemove,
  onPrivateChat,
  privateChatLoading,
  onCall,
  callLoading,
  rosterActions,
  accentColor,
}: CrewProfileDialogProps) {
  if (!crew) return null;

  const accent = accentColor ?? getCrewAccent(undefined, crew.callsign);
  const isRoster = !!rosterActions;
  const rosterActive = rosterActions?.enabled !== false;
  const showMedicalDisclaimer = isMedicalCrewDisplay({
    categoryId: crew.categoryId,
    requiresMedicalDisclaimer: crew.requiresMedicalDisclaimer,
    catalogId: crew.catalogId,
    callsign: crew.callsign,
  });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      PaperProps={{ sx: { ...crewDialogPaperSx, maxHeight: '90vh', position: 'relative' } }}
    >
      <Box sx={crewHubScanlineSx} />

      {/* Classified header strip */}
      <Box sx={{
        px: 2, py: 1,
        borderBottom: `1px solid ${crewTheme.border.default}`,
        bgcolor: crewTheme.bg.inset,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
          <AssignmentIndIcon sx={{ fontSize: 14, color: crewTheme.accent.amber }} />
          <Typography sx={crewOverlineSx}>Classified Personnel File</Typography>
        </Box>
        <Box sx={{
          px: 0.75, py: 0.2,
          border: `1px solid ${alphaColor(crewTheme.accent.alert, '55')}`,
          borderRadius: '4px',
          bgcolor: alphaColor(crewTheme.accent.alert, 0.08),
        }}>
          <Typography sx={{
            fontSize: '0.5rem',
            fontFamily: "'JetBrains Mono', monospace",
            fontWeight: 700,
            letterSpacing: '2px',
            color: crewTheme.accent.alert,
          }}>
            TOP SECRET
          </Typography>
        </Box>
      </Box>

      <DialogContent sx={{ px: 2, pt: '16px !important', pb: 2 }}>
        {showMedicalDisclaimer && (
          <MedicalDisclaimerSectorCard sx={{ mb: 1.5 }} />
        )}
        {/* Redacted identity block — no photo */}
        {showMedicalDisclaimer ? (
          <MedicalProfileIdentityFrame>
            <IdentityBlockContent crew={crew} accent={accent} />
          </MedicalProfileIdentityFrame>
        ) : (
          <IdentityBlock crew={crew} accent={accent} />
        )}

        {/* Metadata grid */}
        <Box sx={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 0.75,
          mb: 2,
        }}>
          <MetaField label="Operative ID" value={crew.callsign.toUpperCase()} accent={accent} />
          <MetaField label="Comms Protocol" value={crew.tone} />
          <MetaField
            label="Roster Status"
            value={isRoster ? (rosterActive ? 'ACTIVE' : 'STANDBY') : (imported ? 'DEPLOYED' : 'AVAILABLE')}
            accent={isRoster
              ? (rosterActive ? crewTheme.accent.signal : crewTheme.text.dim)
              : (imported ? crewTheme.accent.signal : crewTheme.accent.amber)}
          />
          <MetaField label="Clearance" value="LEVEL 4 — NEED TO KNOW" />
        </Box>

        {/* Mission brief */}
        {crew.description && (
          <Box sx={{ mb: 2 }}>
            <Typography sx={{ ...crewOverlineSx, mb: 0.75 }}>Mission Brief</Typography>
            <Typography sx={{
              fontSize: '0.72rem',
              color: crewTheme.text.secondary,
              lineHeight: 1.65,
              p: 1.25,
              borderRadius: '6px',
              border: `1px solid ${crewTheme.border.subtle}`,
              bgcolor: crewTheme.bg.inset,
            }}>
              {crew.description}
            </Typography>
          </Box>
        )}

        {/* Capabilities */}
        <Box sx={{ mb: 2 }}>
          <Typography sx={{ ...crewOverlineSx, mb: 0.75 }}>Capabilities</Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
            {crew.expertise.map((skill) => (
              <Chip
                key={skill}
                size="small"
                label={skill}
                sx={{
                  height: 22,
                  fontSize: '0.58rem',
                  fontFamily: "'JetBrains Mono', monospace",
                  bgcolor: `${alphaColor(accent, '12')}`,
                  color: accent,
                  border: `1px solid ${alphaColor(accent, '35')}`,
                  borderRadius: '4px',
                  '& .MuiChip-label': { px: 0.85 },
                }}
              />
            ))}
          </Box>
        </Box>

        {/* Tools & Software */}
        {crew.tools && crew.tools.length > 0 && (
          <Box sx={{ mb: 2 }}>
            <Typography sx={{ ...crewOverlineSx, mb: 0.75 }}>Tools & Software</Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
              {crew.tools.map((tool) => (
                <Chip
                  key={tool}
                  size="small"
                  label={tool}
                  sx={{
                    height: 22,
                    fontSize: '0.58rem',
                    fontFamily: "'JetBrains Mono', monospace",
                    bgcolor: crewTheme.bg.inset,
                    color: crewTheme.text.secondary,
                    border: `1px solid ${crewTheme.border.default}`,
                    borderRadius: '4px',
                    '& .MuiChip-label': { px: 0.85 },
                  }}
                />
              ))}
            </Box>
          </Box>
        )}

        {/* Traits */}
        <Box sx={{ mb: 2 }}>
          <Typography sx={{ ...crewOverlineSx, mb: 0.75 }}>Psychological Profile</Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
            {crew.traits.map((trait) => (
              <Chip
                key={trait}
                size="small"
                label={trait}
                sx={{
                  height: 22,
                  fontSize: '0.58rem',
                  fontFamily: "'JetBrains Mono', monospace",
                  bgcolor: crewTheme.bg.inset,
                  color: crewTheme.text.secondary,
                  border: `1px solid ${crewTheme.border.default}`,
                  borderRadius: '4px',
                  textTransform: 'uppercase',
                  letterSpacing: '0.3px',
                  '& .MuiChip-label': { px: 0.85 },
                }}
              />
            ))}
          </Box>
        </Box>

        {/* Operational directive */}
        <Box sx={{ mb: 2 }}>
          <Typography sx={{ ...crewOverlineSx, mb: 0.75 }}>Operational Directive</Typography>
          <Box sx={{
            p: 1.25,
            borderRadius: '6px',
            border: `1px solid ${crewTheme.border.default}`,
            bgcolor: crewTheme.bg.inset,
            maxHeight: 160,
            overflow: 'auto',
            scrollbarWidth: 'none',
            '&::-webkit-scrollbar': { display: 'none' },
          }}>
            <Typography sx={{
              fontSize: '0.62rem',
              fontFamily: "'JetBrains Mono', monospace",
              color: crewTheme.text.mono,
              lineHeight: 1.6,
              whiteSpace: 'pre-wrap',
            }}>
              {crew.systemPrompt}
            </Typography>
          </Box>
        </Box>

        {/* Actions */}
        <Box sx={{ display: 'flex', gap: 0.75, pt: 0.5, alignItems: 'center' }}>
          <IconButton
            size="small"
            onClick={onClose}
            sx={{
              width: 32, height: 32, flexShrink: 0,
              borderRadius: '6px',
              border: `1px solid ${crewTheme.border.strong}`,
              color: crewTheme.text.secondary,
              '&:hover': { borderColor: crewTheme.text.primary, color: crewTheme.text.primary, bgcolor: crewTheme.bg.cardHover },
            }}
          >
            <CloseIcon sx={{ fontSize: 14 }} />
          </IconButton>

          {isRoster && rosterActions ? (
            <>
              {onPrivateChat && (
                <Button
                  size="small"
                  variant="contained"
                  startIcon={privateChatLoading ? <CircularProgress size={12} color="inherit" /> : <ChatIcon sx={{ fontSize: 14 }} />}
                  disabled={privateChatLoading}
                  onClick={onPrivateChat}
                  sx={{
                    fontSize: '0.62rem',
                    fontFamily: "'JetBrains Mono', monospace",
                    letterSpacing: '0.5px',
                    py: 0.6,
                    bgcolor: accent,
                    color: colors.bg.primary,
                    '&:hover': { bgcolor: accent, filter: 'brightness(1.08)' },
                  }}
                >
                  PRIVATE CHAT
                </Button>
              )}
              {onCall && (
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={callLoading ? <CircularProgress size={12} color="inherit" /> : <PhoneInTalkIcon sx={{ fontSize: 14 }} />}
                  disabled={callLoading}
                  onClick={onCall}
                  sx={{
                    fontSize: '0.62rem',
                    fontFamily: "'JetBrains Mono', monospace",
                    letterSpacing: '0.5px',
                    py: 0.6,
                    borderColor: alphaColor(accent, 0.55),
                    color: accent,
                    '&:hover': { borderColor: accent, bgcolor: alphaColor(accent, 0.1) },
                  }}
                >
                  CALL
                </Button>
              )}
              <Box sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 0.5,
                px: 1,
                py: 0.35,
                borderRadius: '6px',
                border: `1px solid ${crewTheme.border.subtle}`,
                bgcolor: crewTheme.bg.inset,
              }}>
                <Switch
                  size="small"
                  checked={rosterActive}
                  onChange={() => rosterActions.onToggle(!rosterActive)}
                  sx={{ '& .MuiSwitch-switchBase.Mui-checked': { color: crewTheme.accent.signal } }}
                />
                <Typography sx={{
                  fontSize: '0.5rem',
                  color: rosterActive ? crewTheme.accent.signal : crewTheme.text.dim,
                  fontFamily: "'JetBrains Mono', monospace",
                  letterSpacing: '0.5px',
                }}>
                  {rosterActive ? 'ACTIVE' : 'STANDBY'}
                </Typography>
              </Box>
              <Box sx={{ flex: 1 }} />
              {rosterActions.onRegenerate && (
                <IconButton
                  size="small"
                  disabled={rosterActions.regenerating}
                  onClick={rosterActions.onRegenerate}
                  sx={{
                    width: 32, height: 32,
                    borderRadius: '6px',
                    border: `1px solid ${crewTheme.border.strong}`,
                    color: crewTheme.text.secondary,
                    '&:hover': { borderColor: crewTheme.text.primary, color: crewTheme.text.primary, bgcolor: crewTheme.bg.cardHover },
                  }}
                >
                  {rosterActions.regenerating
                    ? <CircularProgress size={12} />
                    : <AutoAwesomeIcon sx={{ fontSize: 14 }} />}
                </IconButton>
              )}
              <Button
                size="small"
                variant="outlined"
                startIcon={<EditIcon sx={{ fontSize: 14 }} />}
                onClick={rosterActions.onEdit}
                sx={{
                  fontSize: '0.62rem',
                  fontFamily: "'JetBrains Mono', monospace",
                  letterSpacing: '0.5px',
                  py: 0.6,
                  borderColor: crewTheme.border.strong,
                  color: crewTheme.text.primary,
                  '&:hover': { borderColor: crewTheme.text.primary, bgcolor: crewTheme.bg.cardHover },
                }}
              >
                MODIFY
              </Button>
              <Button
                size="small"
                variant="outlined"
                startIcon={<DeleteIcon sx={{ fontSize: 14 }} />}
                onClick={rosterActions.onDelete}
                sx={{
                  fontSize: '0.62rem',
                  fontFamily: "'JetBrains Mono', monospace",
                  letterSpacing: '0.5px',
                  py: 0.6,
                  borderColor: crewTheme.border.danger,
                  color: crewTheme.accent.alert,
                  '&:hover': { borderColor: crewTheme.accent.alert, bgcolor: alphaColor(crewTheme.accent.alert, 0.08) },
                }}
              >
                PURGE
              </Button>
            </>
          ) : imported ? (
            <>
              {onPrivateChat && (
                <Button
                  size="small"
                  variant="contained"
                  startIcon={privateChatLoading ? <CircularProgress size={12} color="inherit" /> : <ChatIcon sx={{ fontSize: 14 }} />}
                  disabled={privateChatLoading}
                  onClick={onPrivateChat}
                  sx={{
                    flex: 1,
                    fontSize: '0.62rem',
                    fontFamily: "'JetBrains Mono', monospace",
                    letterSpacing: '0.5px',
                    py: 0.6,
                    bgcolor: accent,
                    color: colors.bg.primary,
                    '&:hover': { bgcolor: accent, filter: 'brightness(1.08)' },
                  }}
                >
                  PRIVATE CHAT
                </Button>
              )}
              {onCall && (
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={callLoading ? <CircularProgress size={12} color="inherit" /> : <PhoneInTalkIcon sx={{ fontSize: 14 }} />}
                  disabled={callLoading}
                  onClick={onCall}
                  sx={{
                    fontSize: '0.62rem',
                    fontFamily: "'JetBrains Mono', monospace",
                    letterSpacing: '0.5px',
                    py: 0.6,
                    borderColor: alphaColor(accent, 0.55),
                    color: accent,
                    '&:hover': { borderColor: accent, bgcolor: alphaColor(accent, 0.1) },
                  }}
                >
                  CALL
                </Button>
              )}
              <Button
                fullWidth={!onPrivateChat && !onCall}
                size="small"
                variant="outlined"
                onClick={onRemove}
              sx={{
                fontSize: '0.62rem',
                fontFamily: "'JetBrains Mono', monospace",
                letterSpacing: '0.5px',
                py: 0.6,
                borderColor: crewTheme.border.danger,
                color: crewTheme.accent.alert,
                '&:hover': { borderColor: crewTheme.accent.alert, bgcolor: alphaColor(crewTheme.accent.alert, 0.08) },
              }}
            >
              DEACTIVATE OPERATIVE
            </Button>
            </>
          ) : onImport ? (
            <>
              <Box sx={{ display: 'flex', gap: 0.5, width: '100%' }}>
                <Button
                  size="small"
                  variant="outlined"
                  fullWidth
                  onClick={onImport}
                  disabled={importLoading}
                  sx={{
                    fontSize: '0.62rem',
                    fontFamily: "'JetBrains Mono', monospace",
                    letterSpacing: '0.5px',
                    py: 0.6,
                    borderColor: crewTheme.border.strong,
                    color: crewTheme.text.primary,
                    '&:hover': { borderColor: crewTheme.text.primary, bgcolor: crewTheme.bg.cardHover },
                  }}
                >
                  {importLoading ? <CircularProgress size={12} sx={{ mr: 0.5 }} /> : null}
                  RECRUIT
                </Button>
                {onPrivateChat && (
                  <Button
                    size="small"
                    variant="contained"
                    fullWidth
                    startIcon={privateChatLoading ? <CircularProgress size={12} color="inherit" /> : <ChatIcon sx={{ fontSize: 14 }} />}
                    disabled={privateChatLoading}
                    onClick={onPrivateChat}
                    sx={{
                      fontSize: '0.62rem',
                      fontFamily: "'JetBrains Mono', monospace",
                      letterSpacing: '0.5px',
                      py: 0.6,
                      bgcolor: accent,
                      color: colors.bg.primary,
                      '&:hover': { bgcolor: accent, filter: 'brightness(1.08)' },
                    }}
                  >
                    CHAT
                  </Button>
                )}
                {onCall && (
                  <Button
                    size="small"
                    variant="outlined"
                    fullWidth
                    startIcon={callLoading ? <CircularProgress size={12} color="inherit" /> : <PhoneInTalkIcon sx={{ fontSize: 14 }} />}
                    disabled={callLoading}
                    onClick={onCall}
                    sx={{
                      fontSize: '0.62rem',
                      fontFamily: "'JetBrains Mono', monospace",
                      letterSpacing: '0.5px',
                      py: 0.6,
                      borderColor: alphaColor(accent, 0.55),
                      color: accent,
                      '&:hover': { borderColor: accent, bgcolor: alphaColor(accent, 0.1) },
                    }}
                  >
                    CALL
                  </Button>
                )}
              </Box>
            </>
          ) : (
            <Button
              fullWidth
              size="small"
              variant="outlined"
              onClick={onClose}
              sx={{
                fontSize: '0.62rem',
                fontFamily: "'JetBrains Mono', monospace",
                letterSpacing: '0.5px',
                py: 0.75,
                borderColor: crewTheme.border.strong,
                color: crewTheme.text.primary,
                '&:hover': { borderColor: crewTheme.text.primary, bgcolor: crewTheme.bg.cardHover },
              }}
            >
              CLOSE
            </Button>
          )}
        </Box>
      </DialogContent>
    </Dialog>
  );
}
