import { type FC, useEffect, useRef } from 'react';
import { Box, Text } from 'ink';
import { COLORS } from '../theme/colors.js';
import type { Message, MessageRole } from '@agentx/shared';

interface ToolExecInfo {
  id: string;
  name: string;
  status: 'running' | 'complete' | 'error';
  elapsed?: number;
  output?: string;
}

interface SubAgentInfo {
  id: string;
  action: 'spawned' | 'complete' | 'failed';
  instruction?: string;
  elapsed?: number;
}

interface MessageAreaProps {
  messages: Message[];
  streamingContent?: string;
  pendingDiff?: { tool: string; filePath: string; diff: string };
  toolExecutions?: ToolExecInfo[];
  reasoningContent?: string;
  subAgentEvents?: SubAgentInfo[];
  agentStatus?: { intent?: string; ragCount?: number };
}

export const MessageArea: FC<MessageAreaProps> = ({
  messages, streamingContent, pendingDiff,
  toolExecutions, reasoningContent, subAgentEvents, agentStatus,
}) => {
  const bottomRef = useRef<any>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView?.({ behavior: 'smooth' });
  }, [messages, streamingContent]);

  return (
    <Box flexDirection="column" flexGrow={1}>
      {/* Agent status bar */}
      {agentStatus && (agentStatus.intent || (agentStatus.ragCount ?? 0) > 0) && (
        <Box paddingX={1} marginBottom={1}>
          <Text color={COLORS.textDim} dimColor>
            ───
            {agentStatus.intent && <Text color={COLORS.accent}> ◆ INTENT: {agentStatus.intent} </Text>}
            {(agentStatus.ragCount ?? 0) > 0 && <Text color={COLORS.success}> ◆ RAG: {agentStatus.ragCount} docs </Text>}
            {(toolExecutions?.length ?? 0) > 0 && <Text color={COLORS.warning}> ◆ PROCESSING </Text>}
            ───
          </Text>
        </Box>
      )}

      {messages.map((message) => (
        <Box key={message.id} flexDirection="column" paddingX={1} marginBottom={1}>
          <MessageHeader role={message.role} timestamp={message.createdAt} elapsed={message.elapsed} tokenCost={message.tokenCost} />
          <Box paddingLeft={2}>
            {renderMessageContent(message)}
          </Box>
          {message.toolCalls && message.toolCalls.length > 0 && (
            <Box paddingLeft={2} marginTop={0}>
              <Text color={COLORS.warning}>
                ⚡ [{message.toolCalls.length} tool call{message.toolCalls.length > 1 ? 's' : ''}]
              </Text>
            </Box>
          )}
        </Box>
      ))}

      {/* Reasoning panel */}
      {reasoningContent && (
        <Box flexDirection="column" paddingX={1} marginBottom={1} borderStyle="single" borderColor={COLORS.accent}>
          <Box paddingX={1} paddingY={0}>
            <Text color={COLORS.accent} bold>🧠 REASONING</Text>
          </Box>
          <Box paddingX={1}>
            <Text color={COLORS.textDim} wrap="wrap">{reasoningContent}</Text>
          </Box>
        </Box>
      )}

      {/* Tool execution cards */}
      {toolExecutions && toolExecutions.length > 0 && (
        <Box flexDirection="column" paddingX={1} marginBottom={1}>
          {toolExecutions.map((t) => (
            <Box key={t.id} paddingLeft={2}>
              <Text color={
                t.status === 'running' ? COLORS.warning :
                t.status === 'complete' ? COLORS.success : COLORS.error
              }>
                {t.status === 'running' ? '◌' : t.status === 'complete' ? '●' : '✗'}
              </Text>
              <Text color={COLORS.primaryDim}> {t.name}</Text>
              {t.status === 'running' && <Text color={COLORS.textDim}> running...</Text>}
              {t.elapsed != null && (
                <Text color={COLORS.textDim}> ({formatElapsed(t.elapsed)})</Text>
              )}
            </Box>
          ))}
        </Box>
      )}

      {/* Sub-agent events */}
      {subAgentEvents && subAgentEvents.length > 0 && (
        <Box flexDirection="column" paddingX={1} marginBottom={1}>
          {subAgentEvents.map((s) => (
            <Box key={s.id + '-' + s.action} paddingLeft={2}>
              <Text color={COLORS.info}>
                {s.action === 'spawned' ? '◆' : s.action === 'complete' ? '✓' : '✗'}
              </Text>
              <Text color={COLORS.info}> Sub-Agent {s.id?.slice(0, 12)} </Text>
              <Text color={
                s.action === 'spawned' ? COLORS.warning :
                s.action === 'complete' ? COLORS.success : COLORS.error
              }>
                {s.action.toUpperCase()}
              </Text>
              {s.instruction && <Text color={COLORS.textDim}> — {s.instruction.slice(0, 50)}</Text>}
              {s.elapsed != null && (
                <Text color={COLORS.textDim}> ({formatElapsed(s.elapsed)})</Text>
              )}
            </Box>
          ))}
        </Box>
      )}

      {pendingDiff && (
        <Box flexDirection="column" paddingX={1} marginBottom={1}>
          <Text color={COLORS.accent} bold>📝 Diff preview ({pendingDiff.filePath})</Text>
          <Box paddingLeft={2}>
            <Text color={COLORS.textDim} wrap="wrap" dimColor>
              {pendingDiff.diff.split('\n').slice(0, 20).map((line, i) => {
                const color = line.startsWith('+') ? COLORS.success
                  : line.startsWith('-') ? COLORS.error
                  : COLORS.textDim;
                return <Text key={i} color={color}>{line}{'\n'}</Text>;
              })}
            </Text>
            {pendingDiff.diff.split('\n').length > 20 && (
              <Text color={COLORS.textMuted}>... ({pendingDiff.diff.split('\n').length - 20} more lines)</Text>
            )}
          </Box>
        </Box>
      )}

      {streamingContent && (
        <Box flexDirection="column" paddingX={1}>
          <MessageHeader role="assistant" />
          <Box paddingLeft={2}>
            <Text color={COLORS.text} wrap="wrap">
              {streamingContent}
              <Text color={COLORS.primary}>▊</Text>
            </Text>
          </Box>
        </Box>
      )}

      <Box ref={bottomRef} />
    </Box>
  );
};

const CREW_COLORS = [
  '#5B9BD5', // blue
  '#70AD47', // green
  '#ED7D31', // orange
  '#9B59B6', // purple
  '#E74C3C', // red
  '#1ABC9C', // teal
  '#F39C12', // amber
  '#3498DB', // sky
];

function getCrewColor(callsign: string): string {
  let hash = 0;
  for (let i = 0; i < callsign.length; i++) {
    hash = ((hash << 5) - hash) + callsign.charCodeAt(i);
    hash |= 0;
  }
  return CREW_COLORS[Math.abs(hash) % CREW_COLORS.length]!;
}

function renderMessageContent(message: Message) {
  const content = message.content;

  if (message.role === 'tool') {
    const isError = content.startsWith('✗');
    const trimmed = content.length > 30000 ? content.slice(0, 30000) + '\n… [truncated]' : content;
    if (isError) return <Text color={COLORS.error}>{trimmed}</Text>;

    const lines = trimmed.split('\n');
    if (lines.length > 200) {
      const visible = lines.slice(0, 200).join('\n');
      return (
        <Box flexDirection="column">
          <Text color={COLORS.text} wrap="wrap">{visible}</Text>
          <Text color={COLORS.textDim} dimColor>
            … [{lines.length - 200} more lines]
          </Text>
        </Box>
      );
    }
    return <Text color={COLORS.text} wrap="wrap">{trimmed}</Text>;
  }

  // Parse crew sections: **Name** (@callsign): content
  const segmentPattern = /\n\n---\n\n(\*\*([^*]+)\*\*\s*\(@(\w+)\):\s*)/;
  const segments: Array<{ type: 'normal' | 'crew'; text: string; name?: string; callsign?: string }> = [];
  let cursor = 0;
  let match;

  while ((match = segmentPattern.exec(content.slice(cursor))) !== null) {
    const matchStart = cursor + match.index;
    // Add text before the match
    if (matchStart > cursor) {
      segments.push({ type: 'normal', text: content.slice(cursor, matchStart) });
    }
    // Determine the content after the header — find the next separator or end
    const headerEnd = matchStart + match[0].length;
    const nextSep = content.indexOf('\n\n---\n\n', headerEnd);
    const crewContent = nextSep >= 0 ? content.slice(headerEnd, nextSep) : content.slice(headerEnd);
    segments.push({
      type: 'crew',
      text: crewContent,
      name: match[2],
      callsign: match[3],
    });
    cursor = nextSep >= 0 ? nextSep : headerEnd + crewContent.length;
  }

  // If no crew segments detected, render as normal text
  if (segments.length === 0) {
    const trimmed = content.length > 50000 ? content.slice(0, 50000) + '\n… [truncated]' : content;
    return <Text color={COLORS.text} wrap="wrap">{trimmed}</Text>;
  }

  // Add trailing normal text
  if (cursor < content.length) {
    segments.push({ type: 'normal', text: content.slice(cursor) });
  }

  return (
    <Box flexDirection="column">
      {segments.map((seg, i) => {
        if (seg.type === 'crew' && seg.name && seg.callsign) {
          const color = getCrewColor(seg.callsign);
          return (
            <Box key={i} flexDirection="column">
              <Text color={color} bold>◆ {seg.name} (@{seg.callsign})</Text>
              <Text color={color} wrap="wrap">{seg.text}</Text>
            </Box>
          );
        }
        const trimmed = seg.text.length > 50000 ? seg.text.slice(0, 50000) + '\n… [truncated]' : seg.text;
        return <Text key={i} color={COLORS.text} wrap="wrap">{trimmed}</Text>;
      })}
    </Box>
  );
}

const MessageHeader: FC<{ role: MessageRole; timestamp?: string; elapsed?: number; tokenCost?: number }> = ({ role, timestamp, elapsed, tokenCost }) => {
  const roleConfig = getRoleConfig(role);
  return (
    <Box>
      <Text color={roleConfig.color} bold>{roleConfig.icon} {roleConfig.label}</Text>
      {timestamp && <Text color={COLORS.textDim} dimColor> ({formatTime(timestamp)})</Text>}
      {elapsed != null && role === 'assistant' && (
        <Text color={COLORS.textDim} dimColor> • {formatElapsed(elapsed)}</Text>
      )}
      {tokenCost != null && tokenCost > 0 && role === 'assistant' && (
        <Text color={COLORS.warning}>
          {' '}[{tokenCost < 0.01 ? `${(tokenCost * 100).toFixed(2)}¢` : `$${tokenCost.toFixed(4)}`}]
        </Text>
      )}
    </Box>
  );
};

function getRoleConfig(role: MessageRole): { icon: string; label: string; color: string } {
  switch (role) {
    case 'user': return { icon: '▸', label: 'You', color: COLORS.info };
    case 'assistant': return { icon: '◆', label: 'Agent-X', color: COLORS.primary };
    case 'system': return { icon: '⚙', label: 'System', color: COLORS.textDim };
    case 'tool': return { icon: '⚡', label: 'Tool', color: COLORS.success };
    default: return { icon: '•', label: role, color: COLORS.textDim };
  }
}

function formatTime(iso: string): string {
  try { return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }); } catch { return ''; }
}

function formatElapsed(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}
