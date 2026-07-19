import React from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import AddIcon from '@mui/icons-material/Add';
import SmartToyIcon from '@mui/icons-material/SmartToy';
import ForumIcon from '@mui/icons-material/Forum';
import { colors, alphaColor } from '../../theme';
import { SessionGridCard } from '../SessionGridCard';
import {
  useChatSessionListContext,
  useChatSessionSettersContext,
  useChatNavigationHandlersContext,
} from './ChatSessionProvider';

export const SessionListView = React.memo(function SessionListView() {
  // Session list state — does NOT re-render on streaming chunks
  const {
    sessionListTab,
    agentSessionCount, crewPrivateSessionCount,
    filteredSessionList,
  } = useChatSessionListContext();
  // Stable dispatch values
  const { setSessionListTab, navigate } = useChatSessionSettersContext();
  // Navigation handlers
  const { handleNewSession, handleSelectSession, handleDeleteSession } = useChatNavigationHandlersContext();

  return (
    <Box sx={{ height: '100%', flex: 1, display: 'flex', flexDirection: 'column', bgcolor: colors.bg.primary, position: 'relative', overflow: 'hidden' }}>
      {/* Header — HUD style */}
      <Box sx={{
        px: 3, py: 2, borderBottom: `1px solid ${alphaColor(colors.accent.blue, '20')}`,
        display: 'flex', alignItems: 'center', gap: 1.5, position: 'relative', zIndex: 1,
        background: `linear-gradient(180deg, ${alphaColor(colors.accent.blue, '05')} 0%, transparent 100%)`,
      }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: colors.accent.green, boxShadow: `0 0 8px ${alphaColor(colors.accent.green, '80')}` }} />
          <Typography sx={{
            fontFamily: "'JetBrains Mono', monospace", fontSize: '0.7rem', fontWeight: 700,
            color: colors.accent.green, letterSpacing: '3px',
          }}>
            SESSIONS
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 0.5, ml: 1 }}>
          {([
            { id: 'agent_x' as const, label: 'GROUP CHAT', count: agentSessionCount },
            { id: 'crew_private' as const, label: 'PRIVATE CHAT', count: crewPrivateSessionCount },
          ]).map((tab) => (
            <Button
              key={tab.id}
              size="small"
              onClick={() => setSessionListTab(tab.id)}
              sx={{
                minWidth: 0,
                px: 1.25,
                py: 0.35,
                fontSize: '0.55rem',
                fontFamily: "'JetBrains Mono', monospace",
                letterSpacing: '1px',
                color: sessionListTab === tab.id ? colors.accent.blue : colors.text.dim,
                bgcolor: sessionListTab === tab.id ? alphaColor(colors.accent.blue, '12') : 'transparent',
                border: `1px solid ${sessionListTab === tab.id ? alphaColor(colors.accent.blue, '40') : colors.border.subtle}`,
                borderRadius: '4px',
                '&:hover': { bgcolor: alphaColor(colors.accent.blue, '18'), borderColor: alphaColor(colors.accent.blue, '50') },
              }}
            >
              {tab.label}
              <Box component="span" sx={{ ml: 0.75, opacity: 0.7 }}>({tab.count})</Box>
            </Button>
          ))}
        </Box>
        <Box sx={{ flex: 1 }} />
        <Typography sx={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.5rem', color: colors.text.dim }}>
          {filteredSessionList.length} SHOWN
        </Typography>
        {sessionListTab === 'agent_x' && (
        <Button
          size="small"
          startIcon={<AddIcon sx={{ fontSize: 12 }} />}
          onClick={handleNewSession}
          sx={{
            color: colors.accent.blue, fontSize: '0.6rem', textTransform: 'none', fontFamily: "'JetBrains Mono', monospace",
            border: `1px solid ${alphaColor(colors.accent.blue, '30')}`, px: 1.5, py: 0.4, borderRadius: '4px',
            '&:hover': { bgcolor: alphaColor(colors.accent.blue, '15'), borderColor: alphaColor(colors.accent.blue, '60') },
          }}
        >
          NEW GROUP CHAT
        </Button>
        )}
        {sessionListTab === 'crew_private' && (
        <Button
          size="small"
          startIcon={<ForumIcon sx={{ fontSize: 12 }} />}
          onClick={() => navigate("/console/crews")}
          sx={{
            color: colors.accent.blue, fontSize: '0.6rem', textTransform: 'none', fontFamily: "'JetBrains Mono', monospace",
            border: `1px solid ${alphaColor(colors.accent.blue, '30')}`, px: 1.5, py: 0.4, borderRadius: '4px',
            '&:hover': { bgcolor: alphaColor(colors.accent.blue, '15'), borderColor: alphaColor(colors.accent.blue, '60') },
          }}
        >
          OPEN CREWS
        </Button>
        )}
      </Box>

      {/* Session list */}
      <Box sx={{ flex: 1, overflow: 'auto', p: 2, position: 'relative', zIndex: 1 }}>
        {filteredSessionList.length === 0 ? (
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 2 }}>
            <Box sx={{
              width: 64, height: 64, borderRadius: '50%',
              border: `1px solid ${alphaColor(colors.border.strong, '30')}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              bgcolor: colors.bg.tertiary,
            }}>
              {sessionListTab === 'crew_private' ? (
                <ForumIcon sx={{ fontSize: 28, color: colors.text.dim, opacity: 0.5 }} />
              ) : (
                <SmartToyIcon sx={{ fontSize: 28, color: colors.text.dim, opacity: 0.5 }} />
              )}
            </Box>
            <Box sx={{ textAlign: 'center' }}>
              <Typography sx={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.7rem', color: colors.text.dim, letterSpacing: '2px', mb: 0.5 }}>
                {sessionListTab === 'crew_private' ? 'NO PRIVATE CHATS' : 'NO GROUP CHATS'}
              </Typography>
              <Typography sx={{ fontSize: '0.6rem', color: colors.text.dim, opacity: 0.6 }}>
                {sessionListTab === 'crew_private'
                  ? 'Start a private 1:1 chat from the crew roster or Crew Hub'
                  : 'Send a message to start a group chat with Agent-X and crew'}
              </Typography>
            </Box>
            {sessionListTab === 'crew_private' ? (
              <Button
                size="small"
                onClick={() => navigate("/console/crews")}
                sx={{
                  mt: 1, color: colors.accent.blue, textTransform: 'none', fontSize: '0.65rem',
                  fontFamily: "'JetBrains Mono', monospace",
                }}
              >
                GO TO CREWS
              </Button>
            ) : (
              <Button
                size="small"
                onClick={handleNewSession}
                sx={{
                  mt: 1, color: colors.accent.blue, textTransform: 'none', fontSize: '0.65rem',
                  fontFamily: "'JetBrains Mono', monospace",
                }}
              >
                NEW SESSION
              </Button>
            )}
          </Box>
        ) : (
          <Box sx={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
            gap: 1.25,
          }}>
            {filteredSessionList.map((s) => (
              <SessionGridCard
                key={s.id}
                session={s}
                onOpen={handleSelectSession}
                onDelete={handleDeleteSession}
              />
            ))}
          </Box>
        )}
      </Box>
    </Box>
  );
});
