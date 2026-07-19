import React from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import Chip from '@mui/material/Chip';
import Tooltip from '@mui/material/Tooltip';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import SearchIcon from '@mui/icons-material/Search';
import HistoryIcon from '@mui/icons-material/History';
import DownloadIcon from '@mui/icons-material/Download';
import DeleteSweepIcon from '@mui/icons-material/DeleteSweep';
import PhoneInTalkIcon from '@mui/icons-material/PhoneInTalk';
import { colors, alphaColor } from '../../theme';
import { ConnectionHealthDot } from '../ChatEnhancements';
import { sessions } from '../../api';
import type { SxProps } from '@mui/material/styles';
import {
  useChatConnectionContext,
  useChatSessionIdentityContext,
  useChatBypassPermissionsContext,
  useChatSessionSettersContext,
  useChatNavigationHandlersContext,
  useChatSessionPrivacyContext,
} from './ChatSessionProvider';
import { useCrewCallOptional, crewCallTargetFromPrivateHost } from '../crew-call';
import { getCrewAccent } from '../../styles/crew-theme';

export interface ChatHeaderProps {
  panelHeaderRowSx: SxProps;
}

export const ChatHeader = React.memo(function ChatHeader({ panelHeaderRowSx }: ChatHeaderProps) {
  // Connection — re-renders on connection state / lastEventAt changes (rare during streaming)
  const { connState, lastEventAt } = useChatConnectionContext();
  // Session identity.
  const {
    currentSessionTitle, currentSessionId, coreSession, parentSessionId,
  } = useChatSessionIdentityContext();
  const {
    isCrewPrivateSession, crewPrivateHost, privateHostCrewId,
  } = useChatSessionPrivacyContext();
  const crewCall = useCrewCallOptional();
  // Bypass permissions.
  const { bypassPermissions } = useChatBypassPermissionsContext();
  // Stable dispatch values.
  const {
    navigate, setSearchOpen, setCheckpointsOpen, setClearSessionModalOpen,
  } = useChatSessionSettersContext();
  // Navigation handlers.
  const { handleShowSessions } = useChatNavigationHandlersContext();

  const handleCrewCall = () => {
    if (!crewCall || !currentSessionId || !crewPrivateHost) return;
    void crewCall.startCall(crewCallTargetFromPrivateHost({
      sessionId: currentSessionId,
      crewId: privateHostCrewId,
      host: crewPrivateHost,
      accent: getCrewAccent(undefined, crewPrivateHost.callsign),
    }));
  };

  return (
    <Box sx={{
      ...panelHeaderRowSx,
      borderBottom: `1px solid ${bypassPermissions ? alphaColor(colors.accent.orange, '20') : colors.border.default}`,
      position: 'relative',
      zIndex: 1,
      transition: 'border-color 0.6s ease',
    }}>
      {!coreSession && (
        <IconButton size="small" onClick={handleShowSessions} sx={{ color: colors.text.dim, p: 0.5 }}>
          <ArrowBackIcon sx={{ fontSize: 16 }} />
        </IconButton>
      )}
      {parentSessionId && (
        <Chip size="small"
          icon={<ArrowBackIcon sx={{ fontSize: 10 }} />}
          label="Parent"
          onClick={() => navigate(`/console/chat/${parentSessionId}`)}
          sx={{
            fontSize: '0.50rem', fontFamily: "'JetBrains Mono', monospace", height: 18,
            bgcolor: alphaColor(colors.accent.blue, '10'),
            border: `1px solid ${alphaColor(colors.accent.blue, '20')}`,
            color: colors.accent.blue,
            cursor: 'pointer',
            '&:hover': { filter: 'brightness(1.2)' },
            mr: 0.5,
          }}
        />
      )}
      <Typography sx={{ fontSize: '0.7rem', color: colors.text.secondary, fontFamily: "'JetBrains Mono', monospace", flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {currentSessionTitle ?? 'New Session'}
      </Typography>
      <ConnectionHealthDot state={connState} lastEventAt={lastEventAt} />
      {isCrewPrivateSession && crewPrivateHost && crewCall && (
        <Tooltip title="Secure call" arrow>
          <IconButton
            size="small"
            onClick={handleCrewCall}
            disabled={crewCall.isActive}
            sx={{ color: colors.accent.green, p: 0.5, '&:hover': { color: colors.text.primary } }}
          >
            <PhoneInTalkIcon sx={{ fontSize: 15 }} />
          </IconButton>
        </Tooltip>
      )}
      <Tooltip title="Search all sessions (⌘F)" arrow>
        <IconButton size="small" onClick={() => setSearchOpen(true)} sx={{ color: colors.text.dim, p: 0.5, '&:hover': { color: colors.accent.blue } }}>
          <SearchIcon sx={{ fontSize: 14 }} />
        </IconButton>
      </Tooltip>
      <Tooltip title="Checkpoints (rollback)" arrow>
        <IconButton size="small" onClick={() => setCheckpointsOpen(true)} sx={{ color: colors.text.dim, p: 0.5, '&:hover': { color: colors.accent.blue } }}>
          <HistoryIcon sx={{ fontSize: 14 }} />
        </IconButton>
      </Tooltip>
      <Tooltip title="Export trajectory (JSON)" arrow>
        <IconButton
          size="small"
          onClick={() => { if (currentSessionId) sessions.exportTrajectory(currentSessionId); }}
          disabled={!currentSessionId}
          sx={{ color: colors.text.dim, p: 0.5, '&:hover': { color: colors.accent.green } }}
        >
          <DownloadIcon sx={{ fontSize: 14 }} />
        </IconButton>
      </Tooltip>
      {coreSession && (
        <Tooltip title="Clear session view" arrow>
          <IconButton
            size="small"
            onClick={() => setClearSessionModalOpen(true)}
            sx={{
              color: colors.text.dim,
              p: 0.5,
              '&:hover': { color: colors.accent.red },
            }}
          >
            <DeleteSweepIcon sx={{ fontSize: 15 }} />
          </IconButton>
        </Tooltip>
      )}
    </Box>
  );
});
