import React, { useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import Chip from '@mui/material/Chip';
import Tooltip from '@mui/material/Tooltip';
import LinearProgress from '@mui/material/LinearProgress';
import CircularProgress from '@mui/material/CircularProgress';
import ArticleIcon from '@mui/icons-material/Article';
import ReplayIcon from '@mui/icons-material/Replay';
import AutoGraphIcon from '@mui/icons-material/AutoGraph';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import GroupsIcon from '@mui/icons-material/Groups';
import AddIcon from '@mui/icons-material/Add';
import SearchIcon from '@mui/icons-material/Search';
import ChecklistIcon from '@mui/icons-material/Checklist';
import PlayCircleIcon from '@mui/icons-material/PlayCircle';
import RadioButtonUncheckedIcon from '@mui/icons-material/RadioButtonUnchecked';
import { CheckCircle } from '../CheckCircle';
import { colors } from '../../theme';
import { crewTheme } from '../../styles/crew-theme';
import { copyToClipboard } from '../../utils/clipboard';
import { CrewMissionCard } from '../CrewMissionCard';
import type { SxProps } from '@mui/material/styles';
import {
  useChatTokenContext,
  useChatCrewContext,
  useChatSessionIdentityContext,
  useChatSessionPrivacyContext,
  useChatSidebarContext,
  useChatCrewAddContext,
  useChatSessionSettersContext,
  useChatCrewHandlersContext,
  useChatNavigationHandlersContext,
} from './ChatSessionProvider';

export interface ChatRightSidebarProps {
  // Style helpers
  sidebarSectionHeaderSx: (expanded: boolean) => SxProps;
  sidebarSectionHeaderWithDividerSx: (expanded: boolean) => SxProps;
  sidebarSectionContentSx: SxProps;
}

export const ChatRightSidebar = React.memo(function ChatRightSidebar(props: ChatRightSidebarProps) {
  const { sidebarSectionHeaderSx, sidebarSectionHeaderWithDividerSx, sidebarSectionContentSx } = props;

  // Token values — re-renders on token events during streaming.
  const {
    tokenPercent, tokenUsed, tokenTotal, tokenStreaming, tokenReserved,
    tokenInput, tokenOutput, compactionCount,
  } = useChatTokenContext();
  // Crew values — re-renders on crew mission/worker updates.
  const {
    crewMissionActive, crewMissionId, crewWorkers, crewInterMessages,
  } = useChatCrewContext();

  // Session identity and privacy.
  const { currentSessionId, coreSession } = useChatSessionIdentityContext();
  const { isCrewPrivateSession } = useChatSessionPrivacyContext();
  // Sidebar state — does NOT re-render on streaming chunks.
  const {
    contextExpanded, contextData, rebuildingContext,
    tokenExpanded, missionExpanded, tasksExpanded,
    todoItems, cwd,
  } = useChatSidebarContext();
  // Crew add / search state.
  const { crewAddOpen, crewAddQuery, crewAddResults, crewAddLoading } = useChatCrewAddContext();
  // Stable dispatch values.
  const {
    setContextExpanded, setTokenExpanded, setMissionExpanded, setTasksExpanded,
    setCrewAddOpen, setCrewAddQuery, setCrewAddResults,
    pendingFolderActionRef, setFolderConsentOpen,
  } = useChatSessionSettersContext();
  // Crew handlers.
  const { handleCrewAddSearch, handleCrewAddSelect, handleCrewRemove, handleRebuildContext } = useChatCrewHandlersContext();
  // Navigation handlers.
  const { openChildSession } = useChatNavigationHandlersContext();

  return (
    <Box sx={{
      width: '15%', minWidth: 220, flexShrink: 0, borderLeft: `1px solid ${colors.border.default}`,
      display: 'flex', flexDirection: 'column', overflow: 'auto',
    }}>
      {/* ─── Context ─── */}
      <Box>
        <Box
          onClick={() => setContextExpanded(!contextExpanded)}
          sx={sidebarSectionHeaderSx(contextExpanded)}
        >
          <ArticleIcon sx={{ fontSize: 12, color: colors.accent.cyan }} />
          <Typography sx={{ fontSize: '0.5rem', fontFamily: "'JetBrains Mono', monospace", color: colors.text.dim, letterSpacing: '1px', flex: 1 }}>
            {contextExpanded ? '▾' : '▸'} CONTEXT
          </Typography>
          {contextData && (
            <Typography sx={{ fontSize: '0.45rem', color: colors.text.dim }}>{contextData.length} chars</Typography>
          )}
          <IconButton
            size="small"
            onClick={(e) => { e.stopPropagation(); handleRebuildContext(); }}
            disabled={rebuildingContext}
            sx={{ p: 0.25, width: 20, height: 20, color: rebuildingContext ? colors.accent.blue : colors.text.dim, '&:hover': { color: colors.accent.cyan } }}
          >
            <ReplayIcon sx={{ fontSize: 12, animation: rebuildingContext ? 'agentx-spin 1s linear infinite' : 'none' }} />
          </IconButton>
        </Box>
        {contextExpanded && (
          <Box sx={sidebarSectionContentSx}>
            {contextData ? (
              <Box sx={{ bgcolor: colors.bg.tertiary, borderRadius: 0.75, p: 1, maxHeight: 300, overflow: 'auto' }}>
                <Typography sx={{ fontSize: '0.5rem', fontFamily: "'JetBrains Mono', monospace", color: colors.text.secondary, whiteSpace: 'pre-wrap', lineHeight: 1.5, wordBreak: 'break-word' }}>
                  {contextData}
                </Typography>
              </Box>
            ) : (
              <Typography sx={{ fontSize: '0.5rem', color: colors.text.dim, fontStyle: 'italic' }}>No context yet</Typography>
            )}
          </Box>
        )}
      </Box>

      {/* ─── Token usage ─── */}
      <Box>
        <Box
          onClick={() => setTokenExpanded(!tokenExpanded)}
          sx={sidebarSectionHeaderWithDividerSx(tokenExpanded)}
        >
          <AutoGraphIcon sx={{ fontSize: 12, color: colors.accent.green }} />
          <Typography sx={{ fontSize: '0.5rem', fontFamily: "'JetBrains Mono', monospace", color: colors.text.dim, letterSpacing: '1px', flex: 1 }}>
            {tokenExpanded ? '▾' : '▸'} TOKEN USAGE
          </Typography>
          <Typography sx={{ fontSize: '0.5rem', fontFamily: "'JetBrains Mono', monospace", color: tokenPercent > 80 ? colors.accent.red : colors.text.secondary }}>
            {Math.round(tokenPercent)}%
          </Typography>
          <Typography sx={{ fontSize: '0.45rem', fontFamily: "'JetBrains Mono', monospace", color: colors.text.dim }}>
            · {compactionCount} compact
          </Typography>
        </Box>
        {tokenExpanded && (
        <Box sx={sidebarSectionContentSx}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.5 }}>
          <Typography sx={{ fontSize: '0.65rem', fontFamily: "'JetBrains Mono', monospace", color: colors.text.primary }}>
            {tokenUsed.toLocaleString()}
          </Typography>
          <Typography sx={{ fontSize: '0.5rem', fontFamily: "'JetBrains Mono', monospace", color: colors.text.dim }}>
            / {tokenTotal.toLocaleString()}
          </Typography>
        </Box>
        <LinearProgress
          variant="determinate"
          value={tokenPercent}
          sx={{
            height: 4, borderRadius: 2, bgcolor: colors.bg.tertiary,
            '& .MuiLinearProgress-bar': {
              transition: 'transform 0.12s linear',
              bgcolor: tokenPercent > 80 ? colors.accent.red : tokenPercent > 50 ? colors.accent.orange : colors.accent.blue,
            },
          }}
        />
        <Box sx={{ mt: 0.5, display: 'flex', justifyContent: 'space-between' }}>
          <Typography sx={{ fontSize: '0.45rem', color: colors.text.dim }}>Context limit</Typography>
          <Typography sx={{ fontSize: '0.45rem', fontFamily: "'JetBrains Mono', monospace", color: colors.text.secondary }}>
            {tokenTotal.toLocaleString()}
          </Typography>
        </Box>
        {(tokenStreaming > 0 || tokenReserved > 0) && (
        <Box sx={{ mt: 0.25, display: 'flex', justifyContent: 'space-between' }}>
          <Typography sx={{ fontSize: '0.45rem', color: colors.text.dim }}>Stream / Reserved</Typography>
          <Typography sx={{ fontSize: '0.45rem', fontFamily: "'JetBrains Mono', monospace", color: colors.text.secondary }}>
            {tokenStreaming.toLocaleString()} / {tokenReserved.toLocaleString()}
          </Typography>
        </Box>
        )}
        <Box sx={{ mt: 0.75, display: 'flex', justifyContent: 'space-between' }}>
          <Typography sx={{ fontSize: '0.5rem', color: colors.text.dim }}>In / Out</Typography>
          <Typography sx={{ fontSize: '0.5rem', fontFamily: "'JetBrains Mono', monospace", color: colors.text.secondary }}>
            {tokenInput.toLocaleString()} / {tokenOutput.toLocaleString()}
          </Typography>
        </Box>
        <Box sx={{ mt: 0.25, display: 'flex', justifyContent: 'space-between' }}>
          <Typography sx={{ fontSize: '0.5rem', color: colors.text.dim }}>Compactions</Typography>
          <Typography sx={{ fontSize: '0.5rem', fontFamily: "'JetBrains Mono', monospace", color: compactionCount > 0 ? colors.accent.orange : colors.text.secondary }}>
            {compactionCount}
          </Typography>
        </Box>

        {currentSessionId && (
          <Box sx={{ mt: 1, pt: 0.75, borderTop: `1px solid ${colors.border.subtle}` }}>
            <Typography sx={{ fontSize: '0.45rem', color: colors.text.dim, letterSpacing: '0.5px' }}>SCOPE</Typography>
            <Typography sx={{ fontSize: '0.5rem', fontFamily: "'JetBrains Mono', monospace", color: colors.text.secondary, mt: 0.25, wordBreak: 'break-all', cursor: 'pointer', '&:hover': { color: colors.accent.blue } }}
              onClick={() => { pendingFolderActionRef.current = 'changeCwd'; setFolderConsentOpen(true); }}>
              {cwd.split('/').slice(-3).join('/') || cwd}
            </Typography>
          </Box>
        )}
        {currentSessionId && (
          <Box sx={{ mt: 0.5, pt: 0.5, borderTop: `1px solid ${colors.border.subtle}` }}>
            <Typography sx={{ fontSize: '0.45rem', color: colors.text.dim, letterSpacing: '0.5px' }}>SESSION</Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.25 }}>
              <CopySessionId sessionId={currentSessionId} />
            </Box>
          </Box>
        )}
        </Box>
        )}
      </Box>

      {/* ─── Crew Mission (not shown for Agent-X super-session) ─── */}
      {!isCrewPrivateSession && !coreSession && currentSessionId && (
      <Box>
        <Box
          onClick={() => setMissionExpanded(!missionExpanded)}
          sx={sidebarSectionHeaderWithDividerSx(missionExpanded)}
        >
          <GroupsIcon sx={{ fontSize: 12, color: crewTheme.accent.tactical }} />
          <Typography sx={{ fontSize: '0.5rem', fontFamily: "'JetBrains Mono', monospace", color: colors.text.dim, letterSpacing: '1px', flex: 1, display: 'flex', alignItems: 'center', gap: 0.5 }}>
            {missionExpanded ? '▾' : '▸'} CREW MISSION
            {crewMissionActive && (
              <Box component="span" sx={{ width: 4, height: 4, borderRadius: '50%', bgcolor: crewTheme.accent.signal, boxShadow: `0 0 5px ${crewTheme.accent.signal}` }} />
            )}
          </Typography>
          {crewWorkers.length > 0 && (
            <Chip size="small" label={crewWorkers.length} sx={{ fontSize: '0.45rem', height: 15 }} />
          )}
          <Tooltip title="Add crew member" arrow>
            <IconButton
              size="small"
              onClick={(e) => { e.stopPropagation(); setCrewAddOpen(!crewAddOpen); setCrewAddQuery(''); setCrewAddResults([]); }}
              sx={{ p: 0.25, width: 20, height: 20, color: crewAddOpen ? crewTheme.accent.tactical : colors.text.dim, '&:hover': { color: crewTheme.accent.tactical } }}
            >
              <AddIcon sx={{ fontSize: 12 }} />
            </IconButton>
          </Tooltip>
        </Box>

        {missionExpanded && (
        <Box sx={sidebarSectionContentSx}>
          {/* Manual add-crew search */}
          {crewAddOpen && (
            <Box sx={{ mb: 1, position: 'relative' }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, bgcolor: colors.bg.tertiary, borderRadius: 0.75, px: 0.75, py: 0.4 }}>
                <SearchIcon sx={{ fontSize: 11, color: colors.text.dim }} />
                <input
                  autoFocus
                  value={crewAddQuery}
                  onChange={(e) => handleCrewAddSearch(e.target.value)}
                  placeholder="Search crew hub…"
                  style={{
                    flex: 1, border: 'none', outline: 'none', background: 'transparent',
                    fontSize: '0.55rem', fontFamily: "'JetBrains Mono', monospace",
                    color: colors.text.secondary,
                  }}
                />
                {crewAddLoading && <CircularProgress size={9} sx={{ color: colors.text.dim }} />}
              </Box>
              {crewAddResults.length > 0 && (
                <Box sx={{
                  mt: 0.25, maxHeight: 160, overflowY: 'auto',
                  border: `1px solid ${colors.border.default}`, borderRadius: 0.75,
                  bgcolor: colors.bg.secondary,
                }}>
                  {crewAddResults.map((entry) => (
                    <Box
                      key={entry.id}
                      onClick={() => handleCrewAddSelect(entry)}
                      sx={{
                        px: 0.75, py: 0.5, cursor: 'pointer',
                        borderBottom: `1px solid ${colors.border.subtle}`,
                        '&:last-child': { borderBottom: 'none' },
                        '&:hover': { bgcolor: colors.bg.tertiary },
                      }}
                    >
                      <Typography sx={{ fontSize: '0.55rem', fontFamily: "'JetBrains Mono', monospace", color: colors.text.secondary }}>
                        @{entry.callsign}
                      </Typography>
                      <Typography sx={{ fontSize: '0.48rem', color: colors.text.dim, mt: 0.15 }}>
                        {entry.title}
                      </Typography>
                    </Box>
                  ))}
                </Box>
              )}
              {crewAddQuery.trim().length >= 2 && !crewAddLoading && crewAddResults.length === 0 && (
                <Typography sx={{ fontSize: '0.48rem', color: colors.text.dim, fontStyle: 'italic', px: 0.75, py: 0.5 }}>
                  No matches
                </Typography>
              )}
            </Box>
          )}

          {/* Worker list + comms (embedded, header-less) */}
          <CrewMissionCard
            workers={crewWorkers}
            missionActive={crewMissionActive}
            missionId={crewMissionId}
            interMessages={crewInterMessages}
            placement="embedded"
            showHeader={false}
            onViewWorker={(workerId, crewName) => openChildSession({
              childSessionId: workerId,
              label: crewName,
              kind: 'crew_worker',
            })}
            onRemoveWorker={handleCrewRemove}
          />

          {/* Empty state */}
          {crewWorkers.length === 0 && !crewMissionActive && (
            <Typography sx={{ fontSize: '0.52rem', color: colors.text.dim, fontStyle: 'italic', textAlign: 'center', py: 1, fontFamily: "'JetBrains Mono', monospace" }}>
              No crew assigned — use + to add a specialist
            </Typography>
          )}
        </Box>
        )}
      </Box>
      )}

      {/* ─── Tasks ─── */}
      <Box sx={{ flex: 1, overflow: 'auto' }}>
        <Box
          onClick={() => setTasksExpanded(!tasksExpanded)}
          sx={sidebarSectionHeaderWithDividerSx(tasksExpanded)}
        >
          <ChecklistIcon sx={{ fontSize: 12, color: colors.accent.blue }} />
          <Typography sx={{ fontSize: '0.5rem', fontFamily: "'JetBrains Mono', monospace", color: colors.text.dim, letterSpacing: '1px', flex: 1 }}>
            {tasksExpanded ? '▾' : '▸'} TASKS
          </Typography>
          {todoItems.length > 0 && (
            <Chip size="small" label={`${todoItems.filter(t => t.status === 'completed').length}/${todoItems.length}`} sx={{ fontSize: '0.45rem', height: 15 }} />
          )}
        </Box>
        {tasksExpanded && (
        <Box sx={sidebarSectionContentSx}>

        {todoItems.map((item) => (
          <Box key={item.id} sx={{ display: 'flex', alignItems: 'center', gap: 0.5, py: 0.3 }}>
            {item.status === 'completed' && <CheckCircle size={10} color={colors.accent.green} />}
            {item.status === 'in-progress' && <PlayCircleIcon sx={{ fontSize: 10, color: colors.accent.orange }} />}
            {item.status === 'not-started' && <RadioButtonUncheckedIcon sx={{ fontSize: 10, color: colors.text.dim }} />}
            <Typography sx={{
              fontSize: '0.55rem', color: item.status === 'completed' ? colors.text.dim : colors.text.secondary,
              textDecoration: item.status === 'completed' ? 'line-through' : 'none',
              lineHeight: 1.3,
            }}>
              {item.title}
            </Typography>
          </Box>
        ))}

        {todoItems.length === 0 && (
          <Typography sx={{ color: colors.text.dim, fontSize: '0.55rem', textAlign: 'center', mt: 3 }}>
            No active tasks
          </Typography>
        )}
      </Box>
      )}
    </Box>
    </Box>
  );
});

function CopySessionId({ sessionId }: { sessionId: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <>
      <Typography sx={{ fontSize: '0.5rem', fontFamily: "'JetBrains Mono', monospace", color: colors.text.secondary, wordBreak: 'break-all', flex: 1, opacity: copied ? 0 : 1, transition: 'opacity 0.15s' }}>
        {copied ? '' : sessionId}
      </Typography>
      <Tooltip title="Copy session ID">
        <Box onClick={() => {
          void copyToClipboard(sessionId);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        }} sx={{ cursor: 'pointer', display: 'flex', alignItems: 'center', color: copied ? colors.accent.green : colors.text.dim, '&:hover': { color: copied ? colors.accent.green : colors.text.primary } }}>
          {copied ? (
            <span style={{ fontSize: '0.5rem', fontFamily: "'JetBrains Mono', monospace", fontWeight: 600 }}>copied</span>
          ) : (
            <ContentCopyIcon sx={{ fontSize: 11 }} />
          )}
        </Box>
      </Tooltip>
    </>
  );
}
