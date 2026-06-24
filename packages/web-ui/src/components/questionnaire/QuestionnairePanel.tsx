import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import { CrewAwareMarkdown } from '../../chat/ChatMarkdown';
import { colors } from '../../theme';
import { QuestionnaireBlockRenderer } from './QuestionnaireBlocks';
import {
  ALL_CHOICE_VALUE,
  buildClarificationResponse,
  clarificationToQuestionnaire,
  initialQuestionnaireState,
  type ClarificationData,
  type MultiChoiceBlock,
  type QuestionnairePayload,
  type SingleChoiceBlock,
} from './types';

export interface QuestionnairePanelProps {
  payload: QuestionnairePayload;
  onRespond: (response: string) => void;
}

function sourceLabel(payload: QuestionnairePayload): string {
  if (payload.title) return payload.title;
  if (payload.source?.kind === 'crew') {
    return payload.source.callsign ?? payload.source.name ?? 'Crew';
  }
  return 'Agent-X';
}

function navigableCount(block: SingleChoiceBlock | MultiChoiceBlock): number {
  let count = block.options.length;
  if (block.allowAll && block.options.length > 1) count += 1;
  return count;
}

export function QuestionnairePanel({ payload, onRespond }: QuestionnairePanelProps) {
  const [state, setState] = useState(() => initialQuestionnaireState(payload));
  const [focusIdx, setFocusIdx] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const primaryBlock = payload.blocks[0];
  const hasChoiceBlock = primaryBlock?.type === 'single_choice' || primaryBlock?.type === 'multi_choice';

  useEffect(() => {
    setState(initialQuestionnaireState(payload));
    setFocusIdx(0);
    if (hasChoiceBlock) listRef.current?.focus();
  }, [payload.question, payload.blocks.map((b) => b.id).join('|'), hasChoiceBlock]);

  const freeformValue = useMemo(() => {
    if (primaryBlock?.type !== 'single_choice') return '';
    return (state[`${primaryBlock.id}__freeform`] as string) ?? '';
  }, [primaryBlock, state]);

  const canSubmit = useMemo(() => {
    const response = buildClarificationResponse(payload, state);
    if (response) return true;
    return freeformValue.trim().length > 0;
  }, [payload, state, freeformValue]);

  const handleSubmit = useCallback(() => {
    if (freeformValue.trim() && primaryBlock?.type === 'single_choice') {
      onRespond(freeformValue.trim());
      return;
    }
    const response = buildClarificationResponse(payload, state);
    if (response) onRespond(response);
  }, [freeformValue, primaryBlock, payload, state, onRespond]);

  const handleSkip = useCallback(() => onRespond('(skipped)'), [onRespond]);

  const handleStateChange = useCallback((blockId: string, value: typeof state[string]) => {
    setState((prev) => ({ ...prev, [blockId]: value }));
  }, []);

  const handleListKeyDown = useCallback((
    e: React.KeyboardEvent,
    block: SingleChoiceBlock | MultiChoiceBlock,
  ) => {
    const max = navigableCount(block) - 1;
    const navigable = [...block.options];
    if (block.allowAll && block.options.length > 1) {
      navigable.push({ value: ALL_CHOICE_VALUE, label: 'All of the above' });
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setFocusIdx((i) => Math.min(i + 1, max));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setFocusIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const opt = navigable[focusIdx];
      if (!opt) return;
      if (block.type === 'single_choice') {
        handleStateChange(block.id, opt.value);
      } else {
        const current = new Set((state[block.id] as Set<string>) ?? []);
        if (current.has(opt.value)) current.delete(opt.value);
        else current.add(opt.value);
        handleStateChange(block.id, current);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      handleSkip();
    }
  }, [focusIdx, handleStateChange, handleSkip, state]);

  const keyboardHint = hasChoiceBlock ? '↑↓ · Enter' : 'Enter to submit';

  return (
    <Box
      sx={{
        width: '100%',
        mb: 0.75,
        borderRadius: '14px',
        border: `1px solid ${colors.accent.blue}40`,
        bgcolor: colors.bg.secondary,
        overflow: 'hidden',
      }}
    >
      <Box sx={{ px: 1.25, py: 0.85, borderBottom: `1px solid ${colors.border.subtle}` }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.35 }}>
          <Typography sx={{
            fontSize: '0.5rem',
            fontFamily: "'JetBrains Mono', monospace",
            color: colors.accent.blue,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
          }}>
            Input needed
          </Typography>
          <Chip
            size="small"
            label={sourceLabel(payload)}
            sx={{
              height: 16,
              fontSize: '0.45rem',
              fontFamily: "'JetBrains Mono', monospace",
              bgcolor: `${colors.accent.blue}15`,
              color: colors.accent.blue,
              '& .MuiChip-label': { px: 0.75 },
            }}
          />
        </Box>
        <Box sx={{
          fontSize: '0.74rem',
          color: colors.text.primary,
          lineHeight: 1.5,
          '& p': { m: 0, mb: 0.5 },
          '& p:last-child': { mb: 0 },
          '& ul, & ol': { my: 0.35, pl: 2 },
          '& li': { mb: 0.2 },
          '& h1, & h2, & h3': { fontSize: '0.8rem', fontWeight: 600, mt: 0.5, mb: 0.25 },
        }}>
          <CrewAwareMarkdown content={payload.question} />
        </Box>
      </Box>

      {payload.blocks.map((block) => (
        <QuestionnaireBlockRenderer
          key={block.id}
          block={block}
          state={state}
          onStateChange={handleStateChange}
          focusIdx={focusIdx}
          onFocusIdx={setFocusIdx}
          listRef={listRef}
          onListKeyDown={handleListKeyDown}
          onSubmit={handleSubmit}
          onSkip={handleSkip}
        />
      ))}

      <Box sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 1,
        px: 1.25,
        py: 0.65,
        borderTop: `1px solid ${colors.border.subtle}`,
        bgcolor: colors.bg.tertiary,
      }}>
        {payload.allowSkip !== false && (
          <Button
            size="small"
            onClick={handleSkip}
            sx={{
              minWidth: 0,
              px: 1,
              fontSize: '0.58rem',
              textTransform: 'none',
              color: colors.text.dim,
              '&:hover': { bgcolor: 'transparent', color: colors.text.secondary },
            }}
          >
            Skip
          </Button>
        )}
        <Typography sx={{
          fontSize: '0.45rem',
          color: colors.text.dim,
          fontFamily: "'JetBrains Mono', monospace",
          flex: 1,
          textAlign: 'center',
        }}>
          {keyboardHint} · Esc skip
        </Typography>
        <Button
          size="small"
          disabled={!canSubmit}
          onClick={handleSubmit}
          sx={{
            minWidth: 0,
            px: 1.25,
            fontSize: '0.58rem',
            textTransform: 'none',
            bgcolor: colors.accent.blue,
            color: colors.bg.primary,
            '&:hover': { bgcolor: '#58a6ffcc' },
            '&.Mui-disabled': { bgcolor: colors.bg.hover, color: colors.text.dim },
          }}
        >
          {payload.submitLabel ?? 'Continue'}
        </Button>
      </Box>
    </Box>
  );
}

/** Convenience wrapper for legacy ClarificationData from SSE events. */
export function ClarificationQuestionnaire({
  data,
  onRespond,
}: {
  data: ClarificationData;
  onRespond: (response: string) => void;
}) {
  const payload = useMemo(() => clarificationToQuestionnaire(data), [data]);
  return <QuestionnairePanel payload={payload} onRespond={onRespond} />;
}
