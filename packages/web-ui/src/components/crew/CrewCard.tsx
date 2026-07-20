import { memo } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Switch from '@mui/material/Switch';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import CircularProgress from '@mui/material/CircularProgress';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import ForumIcon from '@mui/icons-material/Forum';
import PhoneInTalkIcon from '@mui/icons-material/PhoneInTalk';
import type { Crew } from '../../api';
import { crewCardSx, crewTheme, getCrewAccent } from '../../styles/crew-theme';
import { SkillChips } from './SkillChips';
import { MedicalCrewCardStripe, isMedicalCrewDisplay } from './MedicalDisclaimerBanner';
import { crewDisplayFields } from '../../utils/crew-display';

import { alphaColor } from '../../theme';
interface CrewCardProps {
  crew: Crew;
  regenerating: boolean;
  onOpen: (crew: Crew) => void;
  onPrivateChat?: (crew: Crew) => void;
  privateChatLoading?: boolean;
  onCall?: (crew: Crew) => void;
  callLoading?: boolean;
  onToggle: (id: string, enabled: boolean) => void;
  onEdit: (crew: Crew) => void;
  onDelete: (id: string) => void;
  onRegenerate: (e: React.MouseEvent, crew: Crew) => void;
}

function CrewCardComponent({
  crew,
  regenerating,
  onOpen,
  onPrivateChat,
  privateChatLoading,
  onCall,
  callLoading,
  onToggle,
  onEdit,
  onDelete,
  onRegenerate,
}: CrewCardProps) {
  const enabled = crew.enabled !== false;
  const { displayName, displayCallsign } = crewDisplayFields({
    name: crew.name,
    callsign: crew.callsign,
    title: crew.title,
    categoryId: crew.categoryId,
    expertise: crew.expertise,
    requiresMedicalDisclaimer: crew.requiresMedicalDisclaimer,
    honorsDoctorate: crew.honorsDoctorate,
  });
  const accent = getCrewAccent(crew.color, displayCallsign);
  const isMedical = isMedicalCrewDisplay({
    categoryId: crew.categoryId,
    requiresMedicalDisclaimer: crew.requiresMedicalDisclaimer,
    catalogId: crew.catalogId,
    callsign: crew.callsign,
    crewId: crew.id,
  });

  return (
    <Box onClick={() => onOpen(crew)} sx={crewCardSx(accent, enabled)}>
      {isMedical && <MedicalCrewCardStripe />}
      <Box sx={{ p: 1.75 }}>
        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, mb: 0.85 }}>
          <Box sx={{
            width: 30, height: 30, borderRadius: '6px', flexShrink: 0,
            bgcolor: crewTheme.bg.inset,
            border: `1px solid ${crewTheme.border.default}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: '0.6rem', fontWeight: 700, color: accent,
          }}>
            {(displayCallsign.slice(0, 2) || 'CX').toUpperCase()}
          </Box>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography sx={{
              fontWeight: 700, fontSize: '0.85rem', color: crewTheme.text.primary,
              lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>
              {displayName}
            </Typography>
            {crew.title && (
              <Typography sx={{
                fontSize: '0.65rem', color: crewTheme.text.secondary, mt: 0.2,
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}>
                {crew.title}
              </Typography>
            )}
            <Typography sx={{
              fontSize: '0.58rem', color: accent, fontFamily: "'JetBrains Mono', monospace", mt: 0.25,
            }}>
              @{displayCallsign}
            </Typography>
          </Box>
          {crew.tone && (
            <Box sx={{
              px: 0.75, py: 0.25, borderRadius: '999px', flexShrink: 0,
              fontSize: '0.5rem', fontFamily: "'JetBrains Mono', monospace",
              letterSpacing: '0.5px', textTransform: 'uppercase',
              color: crewTheme.text.secondary, bgcolor: crewTheme.bg.inset,
              border: `1px solid ${crewTheme.border.default}`,
            }}>
              {crew.tone.slice(0, 4)}
            </Box>
          )}
        </Box>

        <Typography sx={{
          fontSize: '0.65rem', color: crewTheme.text.mono, lineHeight: 1.45, mb: 0.85,
          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
          overflow: 'hidden', fontFamily: "'JetBrains Mono', monospace",
        }}>
          {crew.systemPrompt}
        </Typography>

        <Box sx={{ mb: 0.85 }}>
          <SkillChips items={crew.expertise ?? []} maxVisible={2} variant="grid" />
        </Box>

        <Box sx={{
          display: 'flex', alignItems: 'center', gap: 0.5,
          pt: 0.85, borderTop: `1px solid ${crewTheme.border.subtle}`,
        }}>
          <Box sx={{
            width: 5, height: 5, borderRadius: '50%', flexShrink: 0,
            bgcolor: enabled ? crewTheme.accent.signal : crewTheme.text.dim,
          }} />
          <Typography sx={{
            fontSize: '0.52rem', fontFamily: "'JetBrains Mono', monospace",
            letterSpacing: '1px', color: enabled ? crewTheme.accent.signal : crewTheme.text.dim,
          }}>
            {enabled ? 'ACTIVE' : 'STANDBY'}
          </Typography>
          <Box sx={{ flex: 1 }} />
          {onPrivateChat && (
            <Tooltip title="Private chat">
              <IconButton
                size="small"
                disabled={privateChatLoading}
                onClick={(e) => { e.stopPropagation(); onPrivateChat(crew); }}
                sx={{ p: 0.35, color: accent, '&:hover': { color: crewTheme.text.primary, bgcolor: alphaColor(accent, '15') } }}
              >
                {privateChatLoading ? <CircularProgress size={12} /> : <ForumIcon sx={{ fontSize: 14 }} />}
              </IconButton>
            </Tooltip>
          )}
          {onCall && (
            <Tooltip title="Secure call">
              <IconButton
                size="small"
                disabled={callLoading}
                onClick={(e) => { e.stopPropagation(); onCall(crew); }}
                sx={{ p: 0.35, color: accent, '&:hover': { color: crewTheme.text.primary, bgcolor: alphaColor(accent, '15') } }}
              >
                {callLoading ? <CircularProgress size={12} /> : <PhoneInTalkIcon sx={{ fontSize: 14 }} />}
              </IconButton>
            </Tooltip>
          )}
          <Switch
            size="small"
            checked={enabled}
            onChange={(e) => { e.stopPropagation(); onToggle(crew.id, !enabled); }}
            onClick={(e) => e.stopPropagation()}
            sx={{ transform: 'scale(0.75)', mr: -0.5 }}
          />
          <Tooltip title="Regenerate skills">
            <IconButton size="small" disabled={regenerating}
              onClick={(e) => onRegenerate(e, crew)}
              sx={{ p: 0.35, color: crewTheme.text.dim, '&:hover': { color: crewTheme.text.primary } }}>
              {regenerating ? <CircularProgress size={12} /> : <AutoAwesomeIcon sx={{ fontSize: 14 }} />}
            </IconButton>
          </Tooltip>
          <Tooltip title="Edit">
            <IconButton size="small" onClick={(e) => { e.stopPropagation(); onEdit(crew); }}
              sx={{ p: 0.35, color: crewTheme.text.dim, '&:hover': { color: crewTheme.text.primary } }}>
              <EditIcon sx={{ fontSize: 14 }} />
            </IconButton>
          </Tooltip>
          <Tooltip title="Delete">
            <IconButton size="small" onClick={(e) => { e.stopPropagation(); onDelete(crew.id); }}
              sx={{ p: 0.35, color: crewTheme.text.dim, '&:hover': { color: crewTheme.accent.alert } }}>
              <DeleteIcon sx={{ fontSize: 14 }} />
            </IconButton>
          </Tooltip>
        </Box>
      </Box>
    </Box>
  );
}

export const CrewCard = memo(CrewCardComponent);
