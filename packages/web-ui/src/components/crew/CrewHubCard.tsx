import { memo, useMemo } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import CircularProgress from '@mui/material/CircularProgress';
import Tooltip from '@mui/material/Tooltip';
import Chip from '@mui/material/Chip';
import AssignmentIndIcon from '@mui/icons-material/AssignmentInd';
import ForumIcon from '@mui/icons-material/Forum';
import PhoneInTalkIcon from '@mui/icons-material/PhoneInTalk';
import { crewTheme, getCrewAccent } from '../../styles/crew-theme';
import { SkillChips } from './SkillChips';
import { MedicalCrewCardStripe, isMedicalCrewDisplay } from './MedicalDisclaimerBanner';
import { crewDisplayFields } from '../../utils/crew-display';
import { alphaColor } from '../../theme';
import type { HubCardCrew } from './hub-types';

const cardBaseSx = {
  borderRadius: '8px',
  bgcolor: crewTheme.bg.card,
  minHeight: crewTheme.grid.hubCardHeight,
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
  transition: 'border-color 0.15s ease',
  '&:hover': { borderColor: crewTheme.border.strong },
} as const;

const bodySx = {
  p: 1.5,
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
} as const;

const categoryChipSx = {
  alignSelf: 'flex-start',
  mb: 0.5,
  height: 18,
  fontSize: '0.5rem',
  fontFamily: "'JetBrains Mono', monospace",
  letterSpacing: '0.3px',
  bgcolor: crewTheme.bg.inset,
  color: crewTheme.text.secondary,
  border: `1px solid ${crewTheme.border.default}`,
} as const;

const dossierBtnSx = {
  width: 28,
  height: 28,
  flexShrink: 0,
  borderRadius: '6px',
  border: `1px solid ${crewTheme.border.strong}`,
  color: crewTheme.text.secondary,
  '&:hover': {
    borderColor: crewTheme.text.primary,
    color: crewTheme.text.primary,
    bgcolor: crewTheme.bg.cardHover,
  },
} as const;

const recruitBtnSx = {
  fontSize: '0.62rem',
  fontFamily: "'JetBrains Mono', monospace",
  letterSpacing: '0.5px',
  py: 0.4,
  minHeight: 28,
  borderColor: crewTheme.border.strong,
  color: crewTheme.text.primary,
  '&:hover': { borderColor: crewTheme.text.primary, bgcolor: crewTheme.bg.cardHover },
} as const;

const deactivateBtnSx = {
  fontSize: '0.62rem',
  fontFamily: "'JetBrains Mono', monospace",
  letterSpacing: '0.5px',
  py: 0.4,
  minHeight: 28,
  borderColor: crewTheme.border.danger,
  color: crewTheme.accent.alert,
  '&:hover': { borderColor: crewTheme.accent.alert, bgcolor: alphaColor(crewTheme.accent.alert, 0.08) },
} as const;

export interface CrewHubCardProps {
  item: HubCardCrew;
  imported: boolean;
  rosterId?: string;
  importLoading: boolean;
  privateChatLoading?: boolean;
  showPrivateChat?: boolean;
  callLoading?: boolean;
  showCall?: boolean;
  onOpenProfile: (item: HubCardCrew) => void;
  onRecruit: (item: HubCardCrew) => void;
  onDeactivate: (rosterId: string) => void;
  onPrivateChat?: (item: HubCardCrew) => void;
  onCall?: (item: HubCardCrew) => void;
}

function CrewHubCardComponent({
  item,
  imported,
  rosterId,
  importLoading,
  privateChatLoading,
  showPrivateChat,
  callLoading,
  showCall,
  onOpenProfile,
  onRecruit,
  onDeactivate,
  onPrivateChat,
  onCall,
}: CrewHubCardProps) {
  const { displayName, displayCallsign } = useMemo(
    () =>
      crewDisplayFields({
        name: item.name,
        callsign: item.callsign,
        title: item.title,
        categoryId: item.categoryId,
        expertise: item.expertise,
        requiresMedicalDisclaimer: item.requiresMedicalDisclaimer,
        honorsDoctorate: item.honorsDoctorate,
      }),
    [item],
  );

  const accent = useMemo(() => getCrewAccent(undefined, displayCallsign), [displayCallsign]);
  const isMedical = isMedicalCrewDisplay({
    categoryId: item.categoryId,
    requiresMedicalDisclaimer: item.requiresMedicalDisclaimer,
    catalogId: item.catalogId,
    callsign: item.callsign,
  });

  const borderSx = useMemo(
    () => ({
      ...cardBaseSx,
      border: `1px solid ${imported ? crewTheme.border.strong : crewTheme.border.default}`,
    }),
    [imported],
  );

  const chatBtnSx = useMemo(
    () => ({
      width: 28,
      height: 28,
      flexShrink: 0,
      borderRadius: '6px',
      border: `1px solid ${alphaColor(accent, '50')}`,
      color: accent,
      '&:hover': { borderColor: accent, bgcolor: `${alphaColor(accent, '12')}` },
    }),
    [accent],
  );

  const avatarSx = useMemo(
    () => ({
      width: 28,
      height: 28,
      borderRadius: '6px',
      flexShrink: 0,
      bgcolor: crewTheme.bg.inset,
      border: `1px solid ${crewTheme.border.default}`,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontSize: '0.55rem',
      fontWeight: 700,
      color: accent,
      fontFamily: "'JetBrains Mono', monospace",
    }),
    [accent],
  );

  return (
    <Box sx={borderSx}>
      {isMedical && <MedicalCrewCardStripe />}
      <Box sx={bodySx}>
        {item.categoryLabel && <Chip label={item.categoryLabel} size="small" sx={categoryChipSx} />}
        <Box sx={{ display: 'flex', gap: 0.85, mb: 0.65, flex: 1 }}>
          <Box sx={avatarSx}>{displayCallsign.slice(0, 2).toUpperCase()}</Box>
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography sx={{ fontWeight: 600, fontSize: '0.8rem', color: crewTheme.text.primary, lineHeight: 1.2 }}>
              {displayName}
            </Typography>
            <Typography sx={{ fontSize: '0.65rem', color: crewTheme.text.secondary, mt: 0.15 }}>
              {item.title}
            </Typography>
            <Typography sx={{ fontSize: '0.58rem', color: accent, fontFamily: "'JetBrains Mono', monospace", mt: 0.15 }}>
              @{displayCallsign}
            </Typography>
          </Box>
          {imported && (
            <Box
              sx={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                flexShrink: 0,
                mt: 0.5,
                bgcolor: crewTheme.accent.signal,
              }}
            />
          )}
        </Box>

        <Box sx={{ mb: 0.85 }}>
          <SkillChips items={item.expertise} variant="hub" />
        </Box>

        <Box sx={{ display: 'flex', gap: 0.5, mt: 'auto' }}>
          <Tooltip title="View dossier" arrow>
            <IconButton size="small" onClick={() => onOpenProfile(item)} sx={dossierBtnSx}>
              <AssignmentIndIcon sx={{ fontSize: 14 }} />
            </IconButton>
          </Tooltip>
          {showPrivateChat && onPrivateChat && (
            <Tooltip title="Private chat" arrow>
              <IconButton
                size="small"
                onClick={() => onPrivateChat(item)}
                disabled={privateChatLoading}
                sx={chatBtnSx}
              >
                <ForumIcon sx={{ fontSize: 14 }} />
              </IconButton>
            </Tooltip>
          )}
          {showCall && onCall && (
            <Tooltip title="Secure call" arrow>
              <IconButton
                size="small"
                onClick={() => onCall(item)}
                disabled={callLoading}
                sx={chatBtnSx}
              >
                {callLoading
                  ? <CircularProgress size={12} />
                  : <PhoneInTalkIcon sx={{ fontSize: 14 }} />}
              </IconButton>
            </Tooltip>
          )}
          {imported ? (
            <Button
              size="small"
              variant="outlined"
              fullWidth
              onClick={() => rosterId && onDeactivate(rosterId)}
              sx={deactivateBtnSx}
            >
              DEACTIVATE
            </Button>
          ) : (
            <Button
              size="small"
              variant="outlined"
              fullWidth
              onClick={() => onRecruit(item)}
              disabled={importLoading}
              sx={recruitBtnSx}
            >
              {importLoading ? <CircularProgress size={12} sx={{ mr: 0.5 }} /> : null}
              RECRUIT
            </Button>
          )}
        </Box>
      </Box>
    </Box>
  );
}

export const CrewHubCard = memo(CrewHubCardComponent);
