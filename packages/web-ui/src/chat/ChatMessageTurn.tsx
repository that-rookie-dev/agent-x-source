import React, { useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { colors } from '../theme';
import { ReasoningBlock } from '../components/ChatEnhancements';
import { InlineToolCall } from '../components/InlineToolCall';
import type { UIMessage, PartEntry } from './types';
import { displayContent } from './utils';
import { CrewAwareMarkdown, getWebCrewColor } from './ChatMarkdown';
import { ChildSessionInlineCard, type ChildSessionCardProps } from './ChildSessionInlineCard';

function SubAgentChip({ agent }: { agent: NonNullable<PartEntry['agent']> }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <>
      <Box onClick={() => setExpanded((e) => !e)} sx={{
        display: 'inline-flex', alignItems: 'center', gap: 0.5, px: 1, py: 0.35,
        borderRadius: 1, border: `1px solid ${colors.accent.purple}30`, bgcolor: colors.accent.purple + '08',
        cursor: 'pointer', fontSize: '0.55rem', fontFamily: "'JetBrains Mono', monospace",
      }}>
        {agent.status === 'running' ? '◌' : agent.status === 'error' ? '✕' : '✓'} {agent.name}
      </Box>
      {expanded && agent.result && (
        <Box sx={{ mt: 0.5, p: 1, bgcolor: colors.bg.secondary, borderRadius: 1, fontSize: '0.6rem', whiteSpace: 'pre-wrap' }}>
          {agent.result.slice(0, 2000)}
        </Box>
      )}
    </>
  );
}

function renderParts(
  parts: PartEntry[],
  onOpenChildSession?: (props: Omit<ChildSessionCardProps, 'onExpand'>) => void,
) {
  const filtered = parts.filter((p) => {
    if (p.type === 'text') return !!p.content?.trim();
    if (p.type === 'tool') return !!p.tool;
    if (p.type === 'subagent') return !!p.agent;
    return false;
  });

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
      {filtered.map((part) => {
        switch (part.type) {
          case 'text':
            return part.content ? <CrewAwareMarkdown key={part.id} content={part.content} /> : null;
          case 'tool':
            return part.tool ? <InlineToolCall key={part.id} tool={part.tool} /> : null;
          case 'subagent':
            if (!part.agent) return null;
            if (onOpenChildSession && part.agent.id && part.agent.id !== 'subagent') {
              const agent = part.agent;
              return (
                <ChildSessionInlineCard
                  key={part.id}
                  childSessionId={agent.id}
                  label={agent.name}
                  kind={agent.kind ?? 'sub_agent'}
                  status={agent.status}
                  task={agent.task}
                  onExpand={() => onOpenChildSession({
                    childSessionId: agent.id,
                    label: agent.name,
                    kind: agent.kind ?? 'sub_agent',
                    status: agent.status,
                    task: agent.task,
                  })}
                />
              );
            }
            return (
              <Box key={part.id} sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                <SubAgentChip agent={part.agent} />
              </Box>
            );
          default:
            return null;
        }
      })}
    </Box>
  );
}

function ChatMessageTurnComponent({ message, loadingSteps, onOpenChildSession }: {
  message: UIMessage;
  loadingSteps?: Array<{ id: string; label: string; status: string }> | null;
  onOpenChildSession?: (props: Omit<ChildSessionCardProps, 'onExpand'>) => void;
}) {
  const crewInfo = message.crew;
  const displayColor = crewInfo ? (crewInfo.color || getWebCrewColor(crewInfo.callsign)) : colors.accent.blue;
  const [whyOpen, setWhyOpen] = useState(false);
  const cleanContent = displayContent(message);
  const hasParts = !!(message.parts && message.parts.length > 0);

  const subAgentCards = (message.subAgents ?? []).filter((a) => a.id && a.id !== 'subagent');

  return (
    <Box sx={{ mb: 3, animation: 'agentx-fadeIn 0.25s ease-out' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.75 }}>
        <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: displayColor, boxShadow: crewInfo ? `0 0 6px ${displayColor}80` : 'none', flexShrink: 0 }} />
        <Typography sx={{ fontSize: '0.6rem', fontWeight: 600, color: displayColor, fontFamily: "'JetBrains Mono', monospace", letterSpacing: '0.5px' }}>
          {crewInfo ? crewInfo.name : 'Agent-X'}
        </Typography>
        {crewInfo?.callsign && (
          <Typography sx={{ fontSize: '0.5rem', color: colors.text.dim, fontFamily: "'JetBrains Mono', monospace", opacity: 0.7 }}>
            @{crewInfo.callsign}
          </Typography>
        )}
        {crewInfo && (crewInfo.confidence || crewInfo.reasons) && (
          <Typography component="span" onClick={() => setWhyOpen(!whyOpen)} sx={{ fontSize: '0.5rem', cursor: 'pointer', color: colors.text.dim, opacity: 0.5 }}>Why?</Typography>
        )}
      </Box>

      {message.thinking && (
        <ReasoningBlock text={message.thinking} streaming={message.streaming && !message.thinkingDoneAt}
          durationMs={message.thinkingDoneAt && message.thinkingStartedAt ? (message.thinkingDoneAt - message.thinkingStartedAt) : undefined} />
      )}

      {subAgentCards.length > 0 && onOpenChildSession && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, mb: hasParts || cleanContent ? 1.25 : 0 }}>
          {subAgentCards.map((agent) => (
            <ChildSessionInlineCard
              key={agent.id}
              childSessionId={agent.id}
              label={agent.name}
              kind={agent.kind ?? 'sub_agent'}
              status={agent.status}
              task={agent.task}
              onExpand={() => onOpenChildSession({
                childSessionId: agent.id,
                label: agent.name,
                kind: agent.kind ?? 'sub_agent',
                status: agent.status,
                task: agent.task,
              })}
            />
          ))}
        </Box>
      )}

      {hasParts ? renderParts(message.parts!, onOpenChildSession) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
          {cleanContent && <CrewAwareMarkdown content={cleanContent} />}
          {message.toolCalls?.map((t) => <InlineToolCall key={t.id} tool={t} />)}
        </Box>
      )}

      {message.streaming && !cleanContent && !hasParts && (
        <Box sx={{ display: 'flex', gap: 0.4, py: 0.5 }}>
          {[0, 1, 2].map((i) => (
            <Box key={i} sx={{ width: 5, height: 5, borderRadius: '50%', bgcolor: colors.accent.purple, animation: 'agentx-pulse 1.4s ease-in-out infinite', animationDelay: `${i * 0.2}s` }} />
          ))}
          {loadingSteps?.[0]?.label && (
            <Typography sx={{ fontSize: '0.6rem', color: colors.text.dim, fontStyle: 'italic', ml: 0.5 }}>{loadingSteps[0].label}</Typography>
          )}
        </Box>
      )}

      {!message.streaming && (
        <Box sx={{ mt: 0.5, display: 'flex', alignItems: 'center', gap: 0.75, opacity: 0.45 }}>
          {message.timestamp && (
            <Typography sx={{ fontSize: '0.5rem', color: colors.text.dim, fontFamily: "'JetBrains Mono', monospace" }}>
              {new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </Typography>
          )}
          {message.turnTokens != null && (
            <Typography sx={{ fontSize: '0.5rem', color: colors.text.dim, fontFamily: "'JetBrains Mono', monospace" }}>
              {message.turnTokens.toLocaleString()} tok
            </Typography>
          )}
        </Box>
      )}
    </Box>
  );
}

function propsEqual(prev: { message: UIMessage; loadingSteps?: Array<{ id: string; label: string; status: string }> | null; onOpenChildSession?: unknown },
  next: { message: UIMessage; loadingSteps?: Array<{ id: string; label: string; status: string }> | null; onOpenChildSession?: unknown }) {
  if (prev.loadingSteps !== next.loadingSteps) return false;
  if (prev.onOpenChildSession !== next.onOpenChildSession) return false;
  const pm = prev.message;
  const nm = next.message;
  return pm.id === nm.id && pm.content === nm.content && pm.streaming === nm.streaming
    && pm.thinking === nm.thinking && pm.parts === nm.parts && pm.toolCalls === nm.toolCalls
    && pm.crew?.crewId === nm.crew?.crewId && pm.crew?.name === nm.crew?.name
    && pm.subAgents === nm.subAgents;
}

export const ChatMessageTurn = React.memo(ChatMessageTurnComponent, propsEqual);
