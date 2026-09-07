import React, { useState, useMemo, lazy, Suspense } from 'react';
import Box from '@mui/material/Box';
import Collapse from '@mui/material/Collapse';
import ArticleOutlinedIcon from '@mui/icons-material/ArticleOutlined';
import InsertDriveFileIcon from '@mui/icons-material/InsertDriveFile';
import Tooltip from '@mui/material/Tooltip';
import IconButton from '@mui/material/IconButton';
import Chip from '@mui/material/Chip';
import Typography from '@mui/material/Typography';
import TextFieldsIcon from '@mui/icons-material/TextFields';
import { colors, alphaColor } from '../theme';
import { AttachmentModal } from './AttachmentModal';
import { collapseOverlappingTextParts, normalizeMessageForUi, orderPartsForChatRender, parseResponseDocument, repairStreamTextGlitches } from '@agentx/shared/browser';
import type { UIMessage, PartEntry, ToolCall } from './types';
import { displayContent, stripToolNoise, stripVoiceChannelBlock, extractVoiceChannelBlock } from './utils';
import { CrewAwareMarkdown, getWebCrewColor, StreamingMarkdown } from './ChatMarkdown';
import { collectWebSourceUrls } from './web-source-urls';
import { ChildSessionInlineCard, type ChildSessionCardProps } from './ChildSessionInlineCard';
import { ThoughtCollapse } from './ThoughtCollapse';
import { QuestionnaireMessage } from '../components/questionnaire/QuestionnaireMessage';
import { PermissionOutcomeChip } from '../components/chat/PermissionOutcomeChip';
import { CrewRosterPickerMessage } from '../components/crew/CrewRosterPickerMessage';
import type { CrewMatchCandidate } from '@agentx/shared/browser';
import { TurnFeedbackBar } from './TurnFeedbackBar';
import type { TurnFeedbackRating } from '@agentx/shared/browser';
import { DeepSearchMessageBlock } from './DeepSearchMessageBlock';
import { DownloadMessageBlock } from './DownloadMessageBlock';
import { formatVoiceTimingMs } from '../voice/timing';
import { ChartBlock } from './ChartBlock';
import { VisualInlineBlock } from '../visual/VisualInlineBlock';
import { WorkflowEntryCard } from './WorkflowEntryCard';
import { usePersonaName } from '../hooks/usePersonaName';
import { InlineToolCall, type InlineToolData } from '../components/InlineToolCall';
import { FileEditCard, isFileEditTool } from '../components/chat/FileEditCard';
import { ShellExecutionCard, isShellTool } from '../components/chat/ShellExecutionCard';
import { CodeSearchCard, isCodeSearchTool } from '../components/chat/CodeSearchCard';
import { WebSearchCard, isWebSearchTool } from '../components/chat/WebSearchCard';
import { GitOperationCard, isGitTool } from '../components/chat/GitOperationCard';
import { FileReadCard, isFileReadTool } from '../components/chat/FileReadCard';
import { DirectoryListingCard, isDirectoryListTool } from '../components/chat/DirectoryListingCard';
import { PlanRoadmapCard } from '../components/chat/PlanRoadmapCard';
import { TodoChecklistCard } from '../components/chat/TodoChecklistCard';
import { ResponseUnit } from './response-unit/ResponseUnit';

// Loaded only when the user opens a turn's workflow — chunk stays out of the
// chat path and the modal DOM is destroyed on close.
const WorkflowModal = lazy(() => import('./WorkflowModal').then((m) => ({ default: m.WorkflowModal })));

/** True when the tool result is empty or meaningless — these cards are hidden to reduce clutter. */
function isEmptyToolResult(tool: ToolCall): boolean {
  if (tool.status === 'running') return false; // always show running tools
  const result = (tool.result ?? '').trim();
  return !result || result === '(no output)' || result === '""' || result === '{}';
}

/**
 * Collapsed tools summary — shows a single line "N tools used" that expands
 * to reveal all completed tool calls. Uses the same visual theme as
 * ThoughtCollapse: monospace label, dim color, › chevron, collapsible body.
 */
function CollapsedToolsSummaryImpl({ tools }: { tools: InlineToolData[] }) {
  const [open, setOpen] = useState(false);
  // Filter out tools with empty results — they add clutter without value.
  const visibleTools = tools.filter((t) => t.status === 'running' || (t.result && t.result.trim() && t.result.trim() !== '(no output)'));
  if (visibleTools.length === 0) return null;
  const errorCount = visibleTools.filter((t) => t.status === 'error').length;
  const label = `${visibleTools.length} tool${visibleTools.length === 1 ? '' : 's'} used${errorCount > 0 ? ` (${errorCount} error${errorCount === 1 ? '' : 's'})` : ''}`;

  return (
    <Box sx={{ mb: 0.25 }}>
      <Box
        onClick={() => setOpen((v) => !v)}
        sx={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 0.5,
          cursor: 'pointer',
          userSelect: 'none',
          py: 0.1,
          '&:hover .tools-label': { color: colors.text.secondary },
        }}
      >
        <Typography
          className="tools-label"
          sx={{
            fontSize: '0.6rem',
            fontFamily: "'JetBrains Mono', monospace",
            color: colors.text.dim,
            letterSpacing: '0.02em',
            fontWeight: 400,
            opacity: 0.8,
          }}
        >
          {label}
        </Typography>
        <Typography
          sx={{
            fontSize: '0.55rem',
            color: colors.text.dim,
            opacity: 0.6,
            transform: open ? 'rotate(90deg)' : 'none',
            transition: 'transform 0.28s ease',
            lineHeight: 1,
          }}
        >
          ›
        </Typography>
      </Box>
      <Collapse in={open} unmountOnExit>
        <Box sx={{ mt: 0.25 }}>
          {visibleTools.map((tool) => (
            <InlineToolCall key={tool.id} tool={tool} compactTop />
          ))}
        </Box>
      </Collapse>
    </Box>
  );
}
const CollapsedToolsSummary = React.memo(CollapsedToolsSummaryImpl, (prev, next) => {
  if (prev.tools.length !== next.tools.length) return false;
  for (let i = 0; i < prev.tools.length; i++) {
    const a = prev.tools[i]!;
    const b = next.tools[i]!;
    if (a.id !== b.id || a.status !== b.status || a.result !== b.result) return false;
  }
  return true;
});

function SubAgentChipImpl({ agent }: { agent: NonNullable<PartEntry['agent']> }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <>
      <Box onClick={() => setExpanded((e) => !e)} sx={{
        display: 'inline-flex', alignItems: 'center', gap: 0.5, px: 1, py: 0.35,
        borderRadius: 1, border: `1px solid ${alphaColor(colors.accent.purple, '30')}`, bgcolor: alphaColor(colors.accent.purple, '08'),
        cursor: 'pointer', fontSize: '0.55rem', fontFamily: "'JetBrains Mono', monospace",
      }}>
        {agent.status === 'running' ? '◌' : agent.status === 'error' ? '✕' : '✓'} {agent.name}
      </Box>
      {agent.result && (
        <Collapse in={expanded} unmountOnExit>
          <Box sx={{ mt: 0.5, p: 1, bgcolor: colors.bg.secondary, borderRadius: 1, fontSize: '0.6rem', whiteSpace: 'pre-wrap' }}>
            {agent.result.slice(0, 2000)}
          </Box>
        </Collapse>
      )}
    </>
  );
}
const SubAgentChip = React.memo(SubAgentChipImpl, (prev, next) =>
  prev.agent.status === next.agent.status
  && prev.agent.result === next.agent.result
  && prev.agent.name === next.agent.name,
);

function VoiceSummaryCard({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <Box sx={{
      mb: 1.25,
      borderRadius: 1,
      overflow: 'hidden',
      border: `1px solid ${alphaColor(colors.border.strong, '70')}`,
      bgcolor: colors.bg.secondary,
    }}>
      <Box
        onClick={() => setExpanded((open) => !open)}
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 0.75,
          px: 1,
          py: 0.75,
          cursor: 'pointer',
          '&:hover': { bgcolor: `${alphaColor(colors.text.primary, '06')}` },
        }}
      >
        <Typography sx={{
          fontSize: '0.65rem',
          fontFamily: "'JetBrains Mono', monospace",
          color: colors.accent.green,
          lineHeight: 1,
        }}>
          ◌
        </Typography>
        <Typography sx={{
          fontSize: '0.6rem',
          fontFamily: "'JetBrains Mono', monospace",
          fontWeight: 600,
          color: colors.text.primary,
          flexShrink: 0,
        }}>
          Voice summary
        </Typography>
        <Typography sx={{
          fontSize: '0.55rem',
          fontFamily: "'JetBrains Mono', monospace",
          color: colors.text.dim,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          minWidth: 0,
          flex: 1,
        }}>
          {expanded ? 'spoken response' : text}
        </Typography>
        <Typography sx={{
          fontSize: '0.55rem',
          fontFamily: "'JetBrains Mono', monospace",
          color: colors.text.dim,
          flexShrink: 0,
          transition: 'transform 0.28s ease',
          transform: expanded ? 'rotate(180deg)' : 'none',
        }}>
          ▾
        </Typography>
      </Box>
      <Collapse in={expanded} unmountOnExit>
        <Box sx={{ px: 1.25, pb: 1, pt: 0.25, borderTop: `1px solid ${alphaColor(colors.border.strong, '55')}` }}>
          <Typography sx={{
            fontSize: '0.62rem',
            color: colors.text.secondary,
            fontFamily: "'JetBrains Mono', monospace",
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            lineHeight: 1.55,
          }}>
            {text}
          </Typography>
        </Box>
      </Collapse>
    </Box>
  );
}

function renderParts(
  parts: PartEntry[],
  onOpenChildSession?: (props: Omit<ChildSessionCardProps, 'onExpand'>) => void,
  onQuestionnaireRespond?: (messageId: string, response: string) => void,
  messageId?: string,
  onCrewRosterPickerSubmit?: (messageId: string, selected: CrewMatchCandidate[]) => void,
  onCrewRosterPickerSkip?: (messageId: string, dismissForSession?: boolean) => void,
  onViewCrewDossier?: (candidate: CrewMatchCandidate) => void,
  voiceSummary?: string | null,
  streaming = false,
  onQuestionnaireCancel?: (messageId: string) => void,
) {
  const filtered = collapseOverlappingTextParts(parts).filter((p) => {
    if (p.type === 'deep_search') {
      return !!(p.deepSearch?.bundle || p.deepSearch?.progress || p.deepSearch?.running);
    }
    if (p.type === 'text') return !!p.content?.trim();
    if (p.type === 'thinking') return !!p.content?.trim();
    if (p.type === 'tool') return !!p.tool;
    if (p.type === 'chart') return !!p.chartJson;
    if (p.type === 'visual') return !!p.visual;
    if (p.type === 'subagent') return !!p.agent;
    if (p.type === 'questionnaire') return !!p.questionnaire;
    if (p.type === 'permission') return !!p.permission;
    if (p.type === 'crew_roster_picker') return !!p.crewRosterPicker;
    if (p.type === 'response_document') return parseResponseDocument(p.responseDocument).ok;
    return false;
  });

  // Web-source chips are derived from tool/deep-search data. Tool steps still
  // render only in the Workflow modal, but deep_search parts also have an inline
  // fallback card so users see a research summary without opening the workflow.
  const orderedAll = orderPartsForChatRender(filtered);
  const webSources = collectWebSourceUrls(orderedAll);
  const hasValidResponseDocument = orderedAll.some((part) => (
    part.type === 'response_document'
    && parseResponseDocument(part.responseDocument).ok
  ));
  // A completed rich document is the final presentation for the canonical
  // answer — suppress Markdown text whether or not streaming has flipped off yet.
  const ordered = hasValidResponseDocument
    ? orderedAll.filter((part) => part.type !== 'text')
    : orderedAll;

  // A thinking block is "live" (expanded) only when it is the very last element
  // in the ordered list AND we are streaming. As soon as any other element
  // (tool call, text response, deep search, etc.) arrives after it, the
  // thinking collapses — matching the user's mental model that thinking is
  // provisional and gets replaced by the actual output.
  const lastPartId = ordered.length > 0 ? ordered[ordered.length - 1].id : undefined;
  const lastTextId = [...ordered].reverse().find((p) => p.type === 'text' && p.content?.trim())?.id;

  // Collect tool parts for collapsed display. Tools are hidden from the inline
  // message flow and shown as a single collapsible "Tools" summary, similar to
  // the thinking collapse theme. Running tools are always visible.
  // Hide tools with "(no output)" or empty results to reduce clutter.
  const toolParts = ordered.filter((p) => p.type === 'tool' && p.tool && !isEmptyToolResult(p.tool));
  const runningTools = toolParts.filter((p) => p.tool!.status === 'running');
  // Show tools inline only when streaming and there are running tools; otherwise collapse all.
  const showToolsInline = streaming && runningTools.length > 0;

  const renderMainPart = (part: PartEntry, defaultExpanded = false) => {
    switch (part.type) {
      case 'thinking':
        if (!part.content?.trim()) return null;
        // A thinking is "live" only if it is the very last part in the list.
        // When any other element follows it (tool, text, etc.), it collapses.
        const isLastPart = part.id === lastPartId;
        return (
          <ThoughtCollapse
            key={part.id}
            text={stripToolNoise(part.content, { trim: false })}
            live={streaming && isLastPart}
          />
        );
      case 'text':
        if (!part.content) return null;
        const textContent = stripVoiceChannelBlock(
          repairStreamTextGlitches(stripToolNoise(part.content, { trim: false })),
        );
        if (!textContent) return null;
        return streaming
          ? (
            <StreamingMarkdown
              key={part.id}
              content={textContent}
              webSources={webSources}
              live={part.id === lastTextId}
            />
          )
          : <CrewAwareMarkdown key={part.id} content={textContent} webSources={webSources} />;
      case 'deep_search':
        if (!part.deepSearch) return null;
        return (
          <DeepSearchMessageBlock
            key={part.id}
            bundle={part.deepSearch.bundle}
            progress={part.deepSearch.progress}
            running={part.deepSearch.running}
          />
        );
      case 'download':
        if (!part.download) return null;
        return (
          <DownloadMessageBlock
            key={part.id}
            progress={part.download.progress}
            result={part.download.result}
            running={part.download.running}
          />
        );
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
            onCancel={
              part.questionnaire.status === 'pending' && onQuestionnaireCancel && messageId
                ? () => onQuestionnaireCancel(messageId)
                : undefined
            }
          />
        );
      case 'permission':
        if (!part.permission) return null;
        return <PermissionOutcomeChip key={part.id} record={part.permission} />;
      case 'crew_roster_picker':
        if (!part.crewRosterPicker) return null;
        return (
          <CrewRosterPickerMessage
            key={part.id}
            record={part.crewRosterPicker}
            onSubmit={
              part.crewRosterPicker.status === 'pending' && onCrewRosterPickerSubmit && messageId
                ? (selected) => onCrewRosterPickerSubmit(messageId, selected)
                : undefined
            }
            onSkip={
              part.crewRosterPicker.status === 'pending' && onCrewRosterPickerSkip && messageId
                ? (dismissForSession) => onCrewRosterPickerSkip(messageId, dismissForSession)
                : undefined
            }
            onViewDossier={onViewCrewDossier}
          />
        );
      case 'chart':
        if (!part.chartJson) return null;
        return <ChartBlock key={part.id} code={part.chartJson} language="chart" />;
      case 'visual':
        if (!part.visual) return null;
        return <VisualInlineBlock key={part.id} item={part.visual} />;
      case 'response_document':
        if (!part.responseDocument) return null;
        return (
          <ResponseUnit
            key={part.id}
            document={part.responseDocument}
            fallbackMarkdown={part.fallbackMarkdown}
          />
        );
      case 'subagent':
        if (!part.agent) return null;
        if (part.agent.kind === 'crew_worker') return null;
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
      case 'tool':
        // Dedicated tool cards get their own rich UI — shown for both running
        // and done states. These are NOT collapsed into CollapsedToolsSummary.
        if (!part.tool) return null;
        // Hide tools with empty/"(no output)" results to reduce clutter and improve performance.
        if (isEmptyToolResult(part.tool)) return null;
        if (isFileEditTool(part.tool.name)) {
          return <FileEditCard key={part.id} tool={part.tool} defaultExpanded={defaultExpanded} />;
        }
        if (isShellTool(part.tool.name)) {
          return <ShellExecutionCard key={part.id} tool={part.tool} defaultExpanded={defaultExpanded} />;
        }
        if (isCodeSearchTool(part.tool.name)) {
          return <CodeSearchCard key={part.id} tool={part.tool} defaultExpanded={defaultExpanded} />;
        }
        if (isWebSearchTool(part.tool.name)) {
          return <WebSearchCard key={part.id} tool={part.tool} defaultExpanded={defaultExpanded} />;
        }
        if (isGitTool(part.tool.name)) {
          return <GitOperationCard key={part.id} tool={part.tool} defaultExpanded={defaultExpanded} />;
        }
        if (isFileReadTool(part.tool.name)) {
          return <FileReadCard key={part.id} tool={part.tool} defaultExpanded={defaultExpanded} />;
        }
        if (isDirectoryListTool(part.tool.name)) {
          return <DirectoryListingCard key={part.id} tool={part.tool} defaultExpanded={defaultExpanded} />;
        }
        // Non-dedicated tools: running tools show inline, done tools get collapsed.
        if (showToolsInline && part.tool.status === 'running') {
          return <InlineToolCall key={part.id} tool={part.tool} />;
        }
        return null;
      default:
        return null;
    }
  };

  // Walk the ordered parts list and render in chronological order. Consecutive
  // done-tool parts are grouped into a single CollapsedToolsSummary so the UI
  // stays compact, but the group appears at its original position in the
  // stream — not hoisted to the top. Running tools (when streaming) render
  // inline at their position. Non-tool parts render via renderMainPart.
  const renderChronological = (): React.ReactNode[] => {
    const nodes: React.ReactNode[] = [];
    let doneToolBuffer: PartEntry[] = [];

    const flushDoneTools = () => {
      if (doneToolBuffer.length === 0) return;
      const tools = doneToolBuffer.map((p) => p.tool!);
      nodes.push(
        <CollapsedToolsSummary key={`__tools_${doneToolBuffer[0]!.id}__`} tools={tools} />,
      );
      doneToolBuffer = [];
    };

    for (const part of ordered) {
      if (part.type === 'tool' && part.tool && part.tool.status !== 'running' && !isEmptyToolResult(part.tool)) {
        // Dedicated tool cards get their own card — don't collapse them.
        if (part.tool && (
          isFileEditTool(part.tool.name)
          || isShellTool(part.tool.name)
          || isCodeSearchTool(part.tool.name)
          || isWebSearchTool(part.tool.name)
          || isGitTool(part.tool.name)
          || isFileReadTool(part.tool.name)
          || isDirectoryListTool(part.tool.name)
        )) {
          flushDoneTools();
          // All tool cards start collapsed — user expands on click.
          const node = renderMainPart(part, false);
          if (node) nodes.push(<React.Fragment key={part.id}>{node}</React.Fragment>);
          continue;
        }
        // Accumulate consecutive done tools into a single collapsed summary.
        doneToolBuffer.push(part);
        continue;
      }
      // Flush any buffered done tools before rendering the non-tool part.
      flushDoneTools();
      // Running tools always expand to show live progress.
      const isRunning = part.type === 'tool' && part.tool?.status === 'running';
      const node = renderMainPart(part, isRunning);
      if (node) {
        nodes.push(<React.Fragment key={part.id}>{node}</React.Fragment>);
      }
    }
    // Flush any remaining done tools at the end.
    flushDoneTools();
    return nodes;
  };

  // Tighter stack so conversational beats read as one living stream, not a card deck.
  const stackSx = { display: 'flex', flexDirection: 'column', gap: 0.75 } as const;
  return (
    <Box sx={stackSx}>
      {renderChronological()}
      {voiceSummary ? <VoiceSummaryCard text={voiceSummary} /> : null}
    </Box>
  );
}

function ChatMessageTurnComponent({ message, loadingSteps, onOpenChildSession, onQuestionnaireRespond, onQuestionnaireCancel, onCrewRosterPickerSubmit, onCrewRosterPickerSkip, onViewCrewDossier, showFeedback, onTurnFeedback, onSaveArticle, feedbackSubmitting }: {
  message: UIMessage;
  loadingSteps?: Array<{ id: string; label: string; status: string }> | null;
  onOpenChildSession?: (props: Omit<ChildSessionCardProps, 'onExpand'>) => void;
  onQuestionnaireRespond?: (messageId: string, response: string) => void;
  onQuestionnaireCancel?: (messageId: string) => void;
  onCrewRosterPickerSubmit?: (messageId: string, selected: CrewMatchCandidate[]) => void;
  onCrewRosterPickerSkip?: (messageId: string, dismissForSession?: boolean) => void;
  onViewCrewDossier?: (candidate: CrewMatchCandidate) => void;
  showFeedback?: boolean;
  onTurnFeedback?: (messageId: string, rating: TurnFeedbackRating) => void;
  onSaveArticle?: (message: UIMessage) => void;
  feedbackSubmitting?: boolean;
}) {
  const crewInfo = message.crew;
  const personaName = usePersonaName();
  const displayColor = crewInfo ? (crewInfo.color || getWebCrewColor(crewInfo.callsign)) : colors.accent.blue;
  const [whyOpen, setWhyOpen] = useState(false);
  const [workflowOpen, setWorkflowOpen] = useState(false);
  const [openAttachmentId, setOpenAttachmentId] = useState<string | null>(null);
  const normalized = useMemo(
    () => normalizeMessageForUi({
      content: message.content,
      parts: message.parts,
      toolCalls: message.toolCalls,
      thinking: message.thinking,
      subAgents: message.subAgents,
      metadata: {
        ...(message.thinking ? { thinking: message.thinking } : {}),
        ...(message.thinkingStartedAt != null ? { thinkingStartedAt: message.thinkingStartedAt } : {}),
        ...(message.thinkingDoneAt != null ? { thinkingDoneAt: message.thinkingDoneAt } : {}),
        ...(message.subAgents ? { subAgents: message.subAgents } : {}),
      },
    }, []),
    [message.content, message.parts, message.toolCalls, message.thinking, message.thinkingStartedAt, message.thinkingDoneAt, message.subAgents],
  );
  const displayMessage = useMemo(
    () => ({
      ...message,
      content: normalized.content || message.content,
      thinking: normalized.thinking || message.thinking,
      subAgents: normalized.subAgents ?? message.subAgents,
      parts: normalized.parts?.map((p) => (
        p.type === 'tool' && p.tool
          ? { ...p, tool: { ...p.tool, status: p.tool.status || 'done' as const } }
          : p
      )) as PartEntry[] | undefined ?? message.parts,
      toolCalls: (normalized.toolCalls ?? message.toolCalls)?.map((t) => ({
        ...t,
        status: t.status || 'done' as const,
      })),
    }),
    [message, normalized],
  );
  const cleanContent = useMemo(() => displayContent(displayMessage), [displayMessage]);
  const voiceSummary = useMemo(
    () => extractVoiceChannelBlock(displayMessage.content || '')
      || extractVoiceChannelBlock(displayMessage.parts?.filter((p) => p.type === 'text' && p.content).map((p) => p.content).join('') || ''),
    [displayMessage.content, displayMessage.parts],
  );
  const hasParts = useMemo(() => !!(displayMessage.parts && displayMessage.parts.length > 0), [displayMessage.parts]);
  const webSources = useMemo(() => collectWebSourceUrls(displayMessage.parts), [displayMessage.parts]);
  const hasQuestionnaire = useMemo(() => !!(displayMessage.parts?.some((p) => p.type === 'questionnaire')), [displayMessage.parts]);
  const canSaveArticle = useMemo(
    () => !message.streaming && message.role === 'assistant' && onSaveArticle && (hasParts || !!cleanContent),
    [message.streaming, message.role, onSaveArticle, hasParts, cleanContent],
  );
  const contentBlock = useMemo(
    () => hasParts ? renderParts(
      displayMessage.parts!,
      onOpenChildSession,
      onQuestionnaireRespond,
      message.id,
      onCrewRosterPickerSubmit,
      onCrewRosterPickerSkip,
      onViewCrewDossier,
      voiceSummary,
      message.streaming,
      onQuestionnaireCancel,
    ) : (
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
        {voiceSummary ? <VoiceSummaryCard text={voiceSummary} /> : null}
        {cleanContent && (
          message.streaming
            ? <StreamingMarkdown content={cleanContent} webSources={webSources} live />
            : <CrewAwareMarkdown content={cleanContent} webSources={webSources} />
        )}
      </Box>
    ),
    [hasParts, displayMessage.parts, onOpenChildSession, onQuestionnaireRespond, message.id, onCrewRosterPickerSubmit, onCrewRosterPickerSkip, onViewCrewDossier, voiceSummary, message.streaming, onQuestionnaireCancel, cleanContent, webSources],
  );

  const thinkingText = displayMessage.thinking || message.thinking;
  const hasWorkflow = useMemo(
    () => !message.streaming && message.role === 'assistant' && !!(
      displayMessage.toolCalls?.length
      || thinkingText
      || displayMessage.parts?.some((p) => p.type === 'tool' || p.type === 'deep_search')
    ),
    [message.streaming, message.role, displayMessage.toolCalls, thinkingText, displayMessage.parts],
  );
  const workflowStepCount = useMemo(() => {
    const parts = displayMessage.parts ?? [];
    const toolParts = parts.filter((p) => p.type === 'tool' && p.tool).length;
    const deepParts = parts.filter((p) => p.type === 'deep_search' && (p.deepSearch?.bundle || p.deepSearch?.progress)).length;
    const fallbackTools = toolParts === 0 ? (displayMessage.toolCalls?.length ?? 0) : 0;
    return toolParts + deepParts + fallbackTools;
  }, [displayMessage.parts, displayMessage.toolCalls]);

  // Prefer chronological part-attached sub-agent cards (inline in the turn body).
  // Only fall back to message.subAgents for agents missing from parts (legacy restore).
  const orphanSubAgentCards = useMemo(() => {
    const inParts = new Set(
      (displayMessage.parts ?? [])
        .filter((p) => p.type === 'subagent' && p.agent?.id)
        .map((p) => p.agent!.id),
    );
    return (message.subAgents ?? []).filter(
      (a) => a.id && a.id !== 'subagent' && a.kind !== 'crew_worker' && !inParts.has(a.id),
    );
  }, [displayMessage.parts, message.subAgents]);

  return (
    <Box sx={{ mb: 3, animation: 'agentx-fadeIn 0.25s ease-out' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.75 }}>
        <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: displayColor, boxShadow: crewInfo ? `0 0 6px ${alphaColor(displayColor, '80')}` : 'none', flexShrink: 0 }} />
        <Typography sx={{ fontSize: '0.6rem', fontWeight: 600, color: displayColor, fontFamily: "'JetBrains Mono', monospace", letterSpacing: '0.5px' }}>
          {crewInfo ? crewInfo.name : personaName}
        </Typography>
        {crewInfo?.callsign && (
          <Typography sx={{ fontSize: '0.5rem', color: colors.text.dim, fontFamily: "'JetBrains Mono', monospace", opacity: 0.7 }}>
            @{crewInfo.callsign}
          </Typography>
        )}
        {message.voiceTextOnly && (
          <Chip
            size="small"
            icon={<TextFieldsIcon sx={{ fontSize: '12px !important' }} />}
            label="Text only"
            sx={{ fontSize: '0.5rem', height: 18, bgcolor: `${alphaColor(colors.text.dim, '12')}`, border: `1px solid ${alphaColor(colors.text.dim, '30')}` }}
          />
        )}
        {crewInfo && (crewInfo.confidence || crewInfo.reasons) && (
          <Typography component="span" onClick={() => setWhyOpen(!whyOpen)} sx={{ fontSize: '0.5rem', cursor: 'pointer', color: colors.text.dim, opacity: 0.5 }}>Why?</Typography>
        )}
      </Box>

      {message.attachments && message.attachments.length > 0 && (
        <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mb: 0.75 }}>
          {message.attachments.map((a, i) => (
            <Chip
              key={i}
              size="small"
              icon={<InsertDriveFileIcon sx={{ fontSize: '11px !important' }} />}
              label={a.name}
              onClick={() => setOpenAttachmentId(a.id)}
              sx={{ fontSize: '0.5rem', height: 18, cursor: 'pointer', bgcolor: alphaColor(colors.accent.blue, '08'), border: `1px solid ${alphaColor(colors.accent.blue, '20')}` }}
            />
          ))}
          {message.attachments.map((a) => (
            <AttachmentModal
              key={a.id}
              open={openAttachmentId === a.id}
              onClose={() => setOpenAttachmentId(null)}
              id={a.id}
              name={a.name}
              mimeType={a.mimeType}
            />
          ))}
        </Box>
      )}

      {message.plan && message.plan.length > 0 && (
        <PlanRoadmapCard steps={message.plan} />
      )}
      {message.todos && message.todos.length > 0 && (
        <TodoChecklistCard todos={message.todos} />
      )}

      {hasParts || cleanContent || hasQuestionnaire ? contentBlock : null}
      {/* Legacy fallback: thinking blob with no chronological thinking parts. */}
      {!hasParts && thinkingText ? (
        <ThoughtCollapse text={stripToolNoise(thinkingText, { trim: false })} live={!!message.streaming} />
      ) : null}

      {orphanSubAgentCards.length > 0 && onOpenChildSession && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, mt: hasParts || cleanContent ? 1.25 : 0 }}>
          {orphanSubAgentCards.map((agent) => (
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

      {message.streaming && !cleanContent && !hasParts && !hasQuestionnaire && (
        <Box sx={{ display: 'flex', gap: 0.4, py: 0.5 }}>
          {[0, 1, 2].map((i) => (
            <Box key={i} sx={{ width: 5, height: 5, borderRadius: '50%', bgcolor: colors.accent.purple, animation: 'agentx-pulse 1.4s ease-in-out infinite', animationDelay: `${i * 0.2}s` }} />
          ))}
        </Box>
      )}

      {message.streaming && loadingSteps && loadingSteps.length > 0 && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.5, flexWrap: 'wrap' }}>
          {loadingSteps.slice(-3).map((step) => (
            <Box
              key={step.id}
              sx={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 0.4,
                px: 0.6,
                py: 0.2,
                borderRadius: '4px',
                bgcolor: step.status === 'complete' ? alphaColor(colors.accent.green, '12') : alphaColor(colors.accent.purple, '10'),
                border: `1px solid ${step.status === 'complete' ? alphaColor(colors.accent.green, '30') : alphaColor(colors.accent.purple, '25')}`,
              }}
            >
              <Box
                sx={{
                  width: 4,
                  height: 4,
                  borderRadius: '50%',
                  bgcolor: step.status === 'complete' ? colors.accent.green : colors.accent.purple,
                  flexShrink: 0,
                  ...(step.status !== 'complete' && { animation: 'agentx-pulse 1.2s ease-in-out infinite' }),
                }}
              />
              <Typography sx={{ fontSize: '0.55rem', color: colors.text.dim, fontFamily: "'JetBrains Mono', monospace", whiteSpace: 'nowrap' }}>
                {step.label}
              </Typography>
            </Box>
          ))}
        </Box>
      )}

      {!message.streaming && showFeedback && !message.turnFeedback && onTurnFeedback && message.role === 'assistant' && (
        <TurnFeedbackBar
          disabled={feedbackSubmitting}
          onRate={(rating) => onTurnFeedback(message.id, rating)}
        />
      )}

      {hasWorkflow && (
        <WorkflowEntryCard
          stepCount={workflowStepCount}
          hasReasoning={!!thinkingText}
          onOpen={() => setWorkflowOpen(true)}
        />
      )}

      {!message.streaming && (
        <Box sx={{ mt: 0.5, display: 'flex', alignItems: 'center', gap: 0.75, opacity: 0.45 }}>
            {canSaveArticle && (
              <Tooltip title="Save as Article">
                <IconButton
                  size="small"
                  onClick={() => onSaveArticle!(message)}
                  sx={{ p: 0.25, color: colors.text.dim, '&:hover': { color: colors.text.primary } }}
                >
                  <ArticleOutlinedIcon sx={{ fontSize: 13 }} />
                </IconButton>
              </Tooltip>
            )}
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
            {message.voiceTimings && (
              <Typography sx={{ fontSize: '0.5rem', color: colors.text.dim, fontFamily: "'JetBrains Mono', monospace" }}>
                STT {formatVoiceTimingMs(message.voiceTimings.sttMs)}
                {' · '}
                Think {formatVoiceTimingMs(message.voiceTimings.thinkingMs)}
                {' · '}
                TTS {formatVoiceTimingMs(message.voiceTimings.ttsMs)}
                {' · '}
                Total {formatVoiceTimingMs(message.voiceTimings.totalMs)}
              </Typography>
            )}
        </Box>
      )}

      {workflowOpen && (
        <Suspense fallback={null}>
          <WorkflowModal message={displayMessage} onClose={() => setWorkflowOpen(false)} />
        </Suspense>
      )}
    </Box>
  );
}

function propsEqual(prev: { message: UIMessage; loadingSteps?: Array<{ id: string; label: string; status: string }> | null; onOpenChildSession?: unknown; onQuestionnaireRespond?: unknown; onQuestionnaireCancel?: unknown; onCrewRosterPickerSubmit?: unknown; onCrewRosterPickerSkip?: unknown; onViewCrewDossier?: unknown; showFeedback?: boolean; onTurnFeedback?: unknown; onSaveArticle?: unknown; feedbackSubmitting?: boolean },
  next: { message: UIMessage; loadingSteps?: Array<{ id: string; label: string; status: string }> | null; onOpenChildSession?: unknown; onQuestionnaireRespond?: unknown; onQuestionnaireCancel?: unknown; onCrewRosterPickerSubmit?: unknown; onCrewRosterPickerSkip?: unknown; onViewCrewDossier?: unknown; showFeedback?: boolean; onTurnFeedback?: unknown; onSaveArticle?: unknown; feedbackSubmitting?: boolean }) {
  if (prev.loadingSteps !== next.loadingSteps) return false;
  if (prev.onOpenChildSession !== next.onOpenChildSession) return false;
  if (prev.onQuestionnaireRespond !== next.onQuestionnaireRespond) return false;
  if (prev.onQuestionnaireCancel !== next.onQuestionnaireCancel) return false;
  if (prev.onCrewRosterPickerSubmit !== next.onCrewRosterPickerSubmit) return false;
  if (prev.onCrewRosterPickerSkip !== next.onCrewRosterPickerSkip) return false;
  if (prev.onViewCrewDossier !== next.onViewCrewDossier) return false;
  if (prev.showFeedback !== next.showFeedback) return false;
  if (prev.onTurnFeedback !== next.onTurnFeedback) return false;
  if (prev.onSaveArticle !== next.onSaveArticle) return false;
  if (prev.feedbackSubmitting !== next.feedbackSubmitting) return false;
  const pm = prev.message;
  const nm = next.message;
  if (pm.id !== nm.id || pm.content !== nm.content || pm.streaming !== nm.streaming) return false;
  // Thinking field still drives Workflow modal; parts drive inline ThoughtCollapse.
  if ((pm.thinking ?? '') !== (nm.thinking ?? '')) return false;
  // Tool cards render only in the Workflow modal — only count/completion matter
  // (webSources chips derive from completed tool results).
  if ((pm.toolCalls?.length ?? 0) !== (nm.toolCalls?.length ?? 0)) return false;
  const pmDone = pm.toolCalls?.reduce((n, t) => n + (t.status === 'done' ? 1 : 0), 0) ?? 0;
  const nmDone = nm.toolCalls?.reduce((n, t) => n + (t.status === 'done' ? 1 : 0), 0) ?? 0;
  if (pmDone !== nmDone) return false;
  if (pm.crew?.crewId !== nm.crew?.crewId || pm.crew?.name !== nm.crew?.name) return false;
  if (pm.subAgents !== nm.subAgents) return false;
  if (pm.turnFeedback?.rating !== nm.turnFeedback?.rating) return false;
  if (pm.voiceTimings?.totalMs !== nm.voiceTimings?.totalMs) return false;
  const isRenderedPart = (p: NonNullable<UIMessage['parts']>[number]) =>
    p.type === 'text' || p.type === 'thinking' || p.type === 'chart' || p.type === 'visual' || p.type === 'questionnaire'
    || p.type === 'crew_roster_picker' || p.type === 'subagent' || p.type === 'tool' || p.type === 'permission'
    || p.type === 'response_document';
  const prevParts = (pm.parts ?? []).filter(isRenderedPart);
  const nextParts = (nm.parts ?? []).filter(isRenderedPart);
  if (pm.parts !== nm.parts) {
    if (prevParts.length !== nextParts.length) return false;
    for (let i = 0; i < prevParts.length; i++) {
      const pp = prevParts[i]!;
      const np = nextParts[i]!;
      if (pp.type !== np.type || pp.id !== np.id) return false;
      if (pp.type === 'text' && pp.content !== np.content) return false;
      if (pp.type === 'thinking' && pp.content !== np.content) return false;
      if (pp.type === 'chart' && pp.chartJson !== np.chartJson) return false;
      if (pp.type === 'visual' && pp.visual?.id !== np.visual?.id) return false;
      if (pp.type === 'questionnaire' && pp.questionnaire?.status !== np.questionnaire?.status) return false;
      if (pp.type === 'permission' && pp.permission?.decision !== np.permission?.decision) return false;
      if (pp.type === 'response_document') {
        if (pp.fallbackMarkdown !== np.fallbackMarkdown) return false;
        if (pp.responseDocument !== np.responseDocument) return false;
      }
      if (pp.type === 'subagent' && (pp.agent?.status !== np.agent?.status || pp.agent?.result !== np.agent?.result)) return false;
      if (pp.type === 'tool' && (pp.tool?.status !== np.tool?.status || pp.tool?.result !== np.tool?.result)) return false;
      if (pp.type === 'crew_roster_picker') {
        if (pp.crewRosterPicker?.status !== np.crewRosterPicker?.status) return false;
        const prevIds = pp.crewRosterPicker?.selectedCandidateIds;
        const nextIds = np.crewRosterPicker?.selectedCandidateIds;
        if ((prevIds?.length ?? 0) !== (nextIds?.length ?? 0)) return false;
        if (prevIds?.some((id, i) => id !== nextIds?.[i])) return false;
      }
    }
  }
  return true;
}

export const ChatMessageTurn = React.memo(ChatMessageTurnComponent, propsEqual);
