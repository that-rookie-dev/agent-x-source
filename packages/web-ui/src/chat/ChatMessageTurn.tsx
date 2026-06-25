import React, { useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { colors } from '../theme';
import { ReasoningBlock } from '../components/ChatEnhancements';
import { InlineToolCall } from '../components/InlineToolCall';
import { normalizeMessageForUi } from '@agentx/shared/browser';
import type { UIMessage, PartEntry } from './types';
import { displayContent } from './utils';
import { CrewAwareMarkdown, getWebCrewColor } from './ChatMarkdown';
import { ChildSessionInlineCard, type ChildSessionCardProps } from './ChildSessionInlineCard';
import { QuestionnaireMessage } from '../components/questionnaire/QuestionnaireMessage';
import { TurnFeedbackBar } from './TurnFeedbackBar';
import type { TurnFeedbackRating } from '@agentx/shared/browser';

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
  onQuestionnaireRespond?: (messageId: string, response: string) => void,
  messageId?: string,
) {
  const filtered = parts.filter((p) => {
    if (p.type === 'text') return !!p.content?.trim();
    if (p.type === 'tool') return !!p.tool;
    if (p.type === 'subagent') return !!p.agent;
    if (p.type === 'questionnaire') return !!p.questionnaire;
    return false;
  });

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
      {filtered.map((part) => {
        switch (part.type) {
          case 'text':
            return part.content ? <CrewAwareMarkdown key={part.id} content={part.content} /> : null;
          case 'questionnaire':
            if (!part.questionnaire) return null;
            return (
              <QuestionnaireMessage
                key={part.id}
                record={part.questionnaire}
                onRespond={
                  part.questionnaire.status === 'pending' && onQuestionnaireRespond && messageId
                    ? (response) => onQuestionnaireRespond(messageId, response)
                    : undefined
                }
              />
            );
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

function ChatMessageTurnComponent({ message, loadingSteps, onOpenChildSession, onQuestionnaireRespond, showFeedback, onTurnFeedback, feedbackSubmitting }: {
  message: UIMessage;
  loadingSteps?: Array<{ id: string; label: string; status: string }> | null;
  onOpenChildSession?: (props: Omit<ChildSessionCardProps, 'onExpand'>) => void;
  onQuestionnaireRespond?: (messageId: string, response: string) => void;
  showFeedback?: boolean;
  onTurnFeedback?: (messageId: string, rating: TurnFeedbackRating) => void;
  feedbackSubmitting?: boolean;
}) {
  const crewInfo = message.crew;
  const displayColor = crewInfo ? (crewInfo.color || getWebCrewColor(crewInfo.callsign)) : colors.accent.blue;
  const [whyOpen, setWhyOpen] = useState(false);
  const normalized = normalizeMessageForUi({
    content: message.content,
    parts: message.parts,
    toolCalls: message.toolCalls,
  }, []);
  const displayMessage = {
    ...message,
    content: normalized.content || message.content,
    parts: normalized.parts?.map((p) => (
      p.type === 'tool' && p.tool
        ? { ...p, tool: { ...p.tool, status: p.tool.status || 'done' as const } }
        : p
    )) as PartEntry[] | undefined ?? message.parts,
    toolCalls: (normalized.toolCalls ?? message.toolCalls)?.map((t) => ({
      ...t,
      status: t.status || 'done' as const,
    })),
  };
  const cleanContent = displayContent(displayMessage);
  const hasParts = !!(displayMessage.parts && displayMessage.parts.length > 0);
  const hasQuestionnaire = !!(displayMessage.parts?.some((p) => p.type === 'questionnaire'));
  const contentBlock = hasParts ? renderParts(displayMessage.parts!, onOpenChildSession, onQuestionnaireRespond, message.id) : (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
      {cleanContent && <CrewAwareMarkdown content={cleanContent} />}
      {displayMessage.toolCalls?.map((t) => <InlineToolCall key={t.id} tool={t} />)}
    </Box>
  );

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

      {hasParts || cleanContent || hasQuestionnaire ? contentBlock : null}

      {message.streaming && !cleanContent && !hasParts && !hasQuestionnaire && (
        <Box sx={{ display: 'flex', gap: 0.4, py: 0.5 }}>
          {[0, 1, 2].map((i) => (
            <Box key={i} sx={{ width: 5, height: 5, borderRadius: '50%', bgcolor: colors.accent.purple, animation: 'agentx-pulse 1.4s ease-in-out infinite', animationDelay: `${i * 0.2}s` }} />
          ))}
          {loadingSteps?.[0]?.label && (
            <Typography sx={{ fontSize: '0.6rem', color: colors.text.dim, fontStyle: 'italic', ml: 0.5 }}>{loadingSteps[0].label}</Typography>
          )}
        </Box>
      )}

      {!message.streaming && showFeedback && !message.turnFeedback && onTurnFeedback && message.role === 'assistant' && (
        <TurnFeedbackBar
          disabled={feedbackSubmitting}
          onRate={(rating) => onTurnFeedback(message.id, rating)}
        />
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

function propsEqual(prev: { message: UIMessage; loadingSteps?: Array<{ id: string; label: string; status: string }> | null; onOpenChildSession?: unknown; onQuestionnaireRespond?: unknown; showFeedback?: boolean; onTurnFeedback?: unknown; feedbackSubmitting?: boolean },
  next: { message: UIMessage; loadingSteps?: Array<{ id: string; label: string; status: string }> | null; onOpenChildSession?: unknown; onQuestionnaireRespond?: unknown; showFeedback?: boolean; onTurnFeedback?: unknown; feedbackSubmitting?: boolean }) {
  if (prev.loadingSteps !== next.loadingSteps) return false;
  if (prev.onOpenChildSession !== next.onOpenChildSession) return false;
  if (prev.onQuestionnaireRespond !== next.onQuestionnaireRespond) return false;
  if (prev.showFeedback !== next.showFeedback) return false;
  if (prev.onTurnFeedback !== next.onTurnFeedback) return false;
  if (prev.feedbackSubmitting !== next.feedbackSubmitting) return false;
  const pm = prev.message;
  const nm = next.message;
  return pm.id === nm.id && pm.content === nm.content && pm.streaming === nm.streaming
    && pm.thinking === nm.thinking && pm.parts === nm.parts && pm.toolCalls === nm.toolCalls
    && pm.crew?.crewId === nm.crew?.crewId && pm.crew?.name === nm.crew?.name
    && pm.subAgents === nm.subAgents
    && pm.turnFeedback?.rating === nm.turnFeedback?.rating;
}

export const ChatMessageTurn = React.memo(ChatMessageTurnComponent, propsEqual);
