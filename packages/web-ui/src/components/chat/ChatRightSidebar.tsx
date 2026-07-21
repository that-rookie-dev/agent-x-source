import React, { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Chip from '@mui/material/Chip';
import Tooltip from '@mui/material/Tooltip';
import LinearProgress from '@mui/material/LinearProgress';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import AutoGraphIcon from '@mui/icons-material/AutoGraph';
import GroupsIcon from '@mui/icons-material/Groups';
import ChecklistIcon from '@mui/icons-material/Checklist';
import PlayCircleIcon from '@mui/icons-material/PlayCircle';
import RadioButtonUncheckedIcon from '@mui/icons-material/RadioButtonUnchecked';
import SmartToyIcon from '@mui/icons-material/SmartToy';
import BadgeIcon from '@mui/icons-material/Badge';
import { CheckCircle } from '../CheckCircle';
import { colors, alphaColor } from '../../theme';
import { crewTheme } from '../../styles/crew-theme';
import { copyToClipboard } from '../../utils/clipboard';
import { subagents, type SubAgentTaskInfo } from '../../api';
import type { SxProps } from '@mui/material/styles';
import {
  useChatTokenContext,
  useChatCrewContext,
  useChatSessionIdentityContext,
  useChatSessionPrivacyContext,
  useChatSidebarContext,
  useChatSessionSettersContext,
  useChatNavigationHandlersContext,
} from './ChatSessionProvider';

export interface ChatRightSidebarProps {
  // Style helpers
  sidebarSectionHeaderSx: (expanded: boolean) => SxProps;
  sidebarSectionHeaderWithDividerSx: (expanded: boolean) => SxProps;
  sidebarSectionContentSx: SxProps;
}

function isActiveCrewStatus(status: string): boolean {
  return status === 'running' || status === 'verifying' || status === 'retrying' || status === 'blocked';
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
    crewMissionActive, crewWorkers,
  } = useChatCrewContext();

  // Session identity and privacy.
  const { currentSessionId, coreSession } = useChatSessionIdentityContext();
  const { isCrewPrivateSession } = useChatSessionPrivacyContext();
  // Sidebar state — does NOT re-render on streaming chunks.
  const {
    tokenExpanded, missionExpanded, tasksExpanded,
    todoItems,
  } = useChatSidebarContext();
  // Stable dispatch values.
  const {
    setTokenExpanded, setMissionExpanded, setTasksExpanded,
  } = useChatSessionSettersContext();
  // Navigation handlers.
  const { openChildSession } = useChatNavigationHandlersContext();

  // Background sub-agents for the active session.
  const [subAgents, setSubAgents] = useState<SubAgentTaskInfo[]>([]);
  const [subAgentsExpanded, setSubAgentsExpanded] = useState(false);

  useEffect(() => {
    if (!currentSessionId) { setSubAgents([]); return; }
    let cancelled = false;
    const load = async () => {
      try {
        const list = await subagents.bySession(currentSessionId);
        // Only keep in-flight agents — completed/failed/cancelled drop out of the sidebar.
        if (!cancelled) setSubAgents(list.filter((a) => a.status === 'running'));
      } catch {
        if (!cancelled) setSubAgents([]);
      }
    };
    load();
    const id = setInterval(load, 2500);
    return () => { cancelled = true; clearInterval(id); };
  }, [currentSessionId]);

  const activeCrewWorkers = crewWorkers.filter((w) => isActiveCrewStatus(w.status));

  return (
    <Box sx={{
      width: '15%', minWidth: 220, flexShrink: 0, borderLeft: `1px solid ${colors.border.default}`,
      display: 'flex', flexDirection: 'column', overflow: 'auto',
    }}>
      {/* ─── Session ID ─── */}
      <Box>
        <Box sx={sidebarSectionHeaderSx(true)}>
          <BadgeIcon sx={{ fontSize: 12, color: colors.accent.cyan }} />
          <Typography sx={{ fontSize: '0.5rem', fontFamily: "'JetBrains Mono', monospace", color: colors.text.dim, letterSpacing: '1px', flex: 1 }}>
            SESSION
          </Typography>
        </Box>
        <Box sx={sidebarSectionContentSx}>
          {currentSessionId ? (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <CopySessionId sessionId={currentSessionId} />
            </Box>
          ) : (
            <Typography sx={{ fontSize: '0.5rem', color: colors.text.dim, fontStyle: 'italic' }}>
              No active session
            </Typography>
          )}
        </Box>
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
        </Box>
        )}
      </Box>

      {/* ─── Crew Mission (not shown for Agent-X session) ─── */}
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
          {activeCrewWorkers.length > 0 && (
            <Chip size="small" label={String(activeCrewWorkers.length)} sx={{ fontSize: '0.45rem', height: 15 }} />
          )}
        </Box>
        {missionExpanded && (
        <Box sx={sidebarSectionContentSx}>
          {activeCrewWorkers.length === 0 ? (
            <Typography sx={{ fontSize: '0.55rem', color: colors.text.tertiary, py: 1 }}>
              No running crew members for this session.
            </Typography>
          ) : (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
              {activeCrewWorkers.map((w) => {
                const label = w.callsign
                  ? `@${w.callsign}${w.crewName ? ` · ${w.crewName}` : ''}`
                  : (w.crewName || w.workerId.slice(0, 8));
                const subtask = (w.message || '').trim();
                const tip = subtask || label;
                return (
                  <Tooltip
                    key={w.workerId}
                    title={tip.slice(0, 72) + (tip.length > 72 ? '…' : '')}
                    placement="left"
                    arrow
                    enterDelay={400}
                  >
                    <Box
                      onClick={() => openChildSession?.({
                        childSessionId: w.workerId,
                        label: label.slice(0, 40),
                        kind: 'crew_worker',
                      })}
                      sx={{
                        display: 'flex', alignItems: 'center', gap: 0.5, py: 0.4, px: 0.5, borderRadius: '4px',
                        cursor: 'pointer',
                        '&:hover': { bgcolor: alphaColor(colors.bg.primary, 0.5) },
                      }}
                    >
                      <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: colors.accent.green, flexShrink: 0 }} />
                      <Typography sx={{ fontSize: '0.55rem', fontFamily: "'JetBrains Mono', monospace", color: colors.text.secondary, flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {subtask ? `${label.slice(0, 18)}${label.length > 18 ? '…' : ''} — ${subtask.slice(0, 28)}` : label.slice(0, 40)}
                      </Typography>
                      <Typography sx={{ fontSize: '0.5rem', fontFamily: "'JetBrains Mono', monospace", color: colors.text.dim, textTransform: 'uppercase' }}>
                        running
                      </Typography>
                    </Box>
                  </Tooltip>
                );
              })}
            </Box>
          )}
        </Box>
        )}
      </Box>
      )}

      {/* ─── Sub-agents ─── */}
      {currentSessionId && (
      <Box>
        <Box
          onClick={() => setSubAgentsExpanded(!subAgentsExpanded)}
          sx={sidebarSectionHeaderWithDividerSx(subAgentsExpanded)}
        >
          <SmartToyIcon sx={{ fontSize: 12, color: colors.accent.blue }} />
          <Typography sx={{ fontSize: '0.5rem', fontFamily: "'JetBrains Mono', monospace", color: colors.text.dim, letterSpacing: '1px', flex: 1 }}>
            {subAgentsExpanded ? '▾' : '▸'} SUB-AGENTS
          </Typography>
          {subAgents.length > 0 && (
            <Chip size="small" label={String(subAgents.length)} sx={{ fontSize: '0.45rem', height: 15 }} />
          )}
        </Box>
        {subAgentsExpanded && (
        <Box sx={sidebarSectionContentSx}>
          {subAgents.length === 0 ? (
            <Typography sx={{ fontSize: '0.55rem', color: colors.text.tertiary, py: 1 }}>
              No running sub-agents for this session.
            </Typography>
          ) : (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
              {subAgents.map((a) => (
                  <Tooltip
                    key={a.id}
                    title={(a.instruction || a.id).slice(0, 72) + ((a.instruction?.length ?? 0) > 72 ? '…' : '')}
                    placement="left"
                    arrow
                    enterDelay={400}
                  >
                    <Box
                      onClick={() => {
                        const sid = a.childSessionId || a.id;
                        if (!sid) return;
                        openChildSession?.({
                          childSessionId: sid,
                          label: a.instruction?.slice(0, 40) || a.id.slice(0, 8),
                          kind: 'sub_agent',
                        });
                      }}
                      sx={{
                        display: 'flex', alignItems: 'center', gap: 0.5, py: 0.4, px: 0.5, borderRadius: '4px',
                        cursor: 'pointer',
                        '&:hover': { bgcolor: alphaColor(colors.bg.primary, 0.5) },
                      }}
                    >
                      <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: colors.accent.green, flexShrink: 0 }} />
                      <Typography sx={{ fontSize: '0.55rem', fontFamily: "'JetBrains Mono', monospace", color: colors.text.secondary, flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {a.instruction?.slice(0, 40) || a.id.slice(0, 8)}
                      </Typography>
                      <Typography sx={{ fontSize: '0.5rem', fontFamily: "'JetBrains Mono', monospace", color: colors.text.dim, textTransform: 'uppercase' }}>
                        running
                      </Typography>
                    </Box>
                  </Tooltip>
              ))}
            </Box>
          )}
        </Box>
        )}
      </Box>
      )}

      {/* ─── Tasks (live todo_write checklist) ─── */}
      <Box sx={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
        <Box
          onClick={() => setTasksExpanded(!tasksExpanded)}
          sx={sidebarSectionHeaderWithDividerSx(tasksExpanded)}
        >
          <ChecklistIcon sx={{ fontSize: 12, color: colors.accent.blue }} />
          <Typography sx={{ fontSize: '0.5rem', fontFamily: "'JetBrains Mono', monospace", color: colors.text.dim, letterSpacing: '1px', flex: 1 }}>
            {tasksExpanded ? '▾' : '▸'} TASKS
          </Typography>
          {todoItems.length > 0 && (
            <Chip
              size="small"
              label={`${todoItems.filter((t) => t.status === 'completed').length}/${todoItems.length}`}
              sx={{ fontSize: '0.45rem', height: 15 }}
            />
          )}
        </Box>
        {tasksExpanded && (
          <Box sx={sidebarSectionContentSx}>
            {todoItems.length === 0 ? (
              <Typography sx={{ color: colors.text.dim, fontSize: '0.55rem', textAlign: 'center', mt: 2, px: 0.5 }}>
                Task list appears when the agent starts a plan.
              </Typography>
            ) : (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.35 }}>
                {todoItems.map((item) => {
                  const ongoing = item.status === 'in-progress';
                  const done = item.status === 'completed';
                  return (
                    <Box
                      key={item.id}
                      sx={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 0.6,
                        py: 0.35,
                        px: 0.4,
                        borderRadius: '4px',
                        bgcolor: ongoing ? alphaColor(colors.accent.orange, 0.12) : 'transparent',
                        minWidth: 0,
                      }}
                    >
                      <Box sx={{ flexShrink: 0, display: 'flex', alignItems: 'center' }}>
                        {done && <CheckCircle size={11} color={colors.accent.green} />}
                        {ongoing && <PlayCircleIcon sx={{ fontSize: 12, color: colors.accent.orange }} />}
                        {!done && !ongoing && <RadioButtonUncheckedIcon sx={{ fontSize: 12, color: colors.text.dim }} />}
                      </Box>
                      <TaskHeading title={item.title} done={done} ongoing={ongoing} />
                    </Box>
                  );
                })}
              </Box>
            )}
          </Box>
        )}
      </Box>
    </Box>
  );
});

function TaskHeading({ title, done, ongoing }: { title: string; done: boolean; ongoing: boolean }) {
  const [hover, setHover] = useState(false);
  return (
    <Box
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      sx={{
        flex: 1,
        minWidth: 0,
        overflow: 'hidden',
        whiteSpace: 'nowrap',
        '@keyframes agentx-task-marquee': {
          '0%': { transform: 'translateX(0)' },
          '100%': { transform: 'translateX(-50%)' },
        },
      }}
    >
      <Typography
        component="span"
        sx={{
          display: 'inline-block',
          fontSize: '0.55rem',
          lineHeight: 1.3,
          color: done ? colors.text.dim : colors.text.secondary,
          fontWeight: ongoing ? 600 : 400,
          textDecoration: done ? 'line-through' : 'none',
          whiteSpace: 'nowrap',
          ...(hover
            ? {
                animation: 'agentx-task-marquee 7s linear infinite',
                paddingRight: '2em',
              }
            : {
                maxWidth: '100%',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }),
        }}
      >
        {hover ? `${title}\u00A0\u00A0\u00A0${title}` : title}
      </Typography>
    </Box>
  );
}

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
