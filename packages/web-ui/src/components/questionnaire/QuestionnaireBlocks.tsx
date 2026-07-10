import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { colors, alphaColor } from '../../theme';
import type {
  QuestionnaireQuestion,
  QuestionnaireResponseState,
} from './types';
import { QUESTIONNAIRE_CUSTOM_SUFFIX } from './types';

export const fieldInputStyle: React.CSSProperties = {
  width: '100%',
  background: colors.bg.primary,
  border: `1px solid ${colors.border.default}`,
  borderRadius: 6,
  padding: '5px 8px',
  fontSize: '0.68rem',
  color: colors.text.primary,
  outline: 'none',
  fontFamily: "'Inter', sans-serif",
};

function RadioMark({ checked }: { checked: boolean }) {
  return (
    <Box sx={{
      width: 14,
      height: 14,
      borderRadius: '50%',
      border: `1.5px solid ${checked ? colors.accent.blue : colors.border.default}`,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
    }}>
      {checked && <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: colors.accent.blue }} />}
    </Box>
  );
}

function CheckMark({ checked }: { checked: boolean }) {
  return (
    <Box sx={{
      width: 14,
      height: 14,
      borderRadius: 3,
      border: `1.5px solid ${checked ? colors.accent.blue : colors.border.default}`,
      bgcolor: checked ? `${alphaColor(colors.accent.blue, '22')}` : 'transparent',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
      fontSize: '0.55rem',
      color: colors.accent.blue,
      fontWeight: 700,
    }}>
      {checked ? '✓' : ''}
    </Box>
  );
}

function CustomAnswerField({
  value,
  onChange,
  onSubmit,
  onSkip,
  label = 'Or type a custom answer',
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  onSkip: () => void;
  label?: string;
}) {
  return (
    <Box sx={{ px: 1.25, pb: 0.5 }}>
      <Typography sx={{
        fontSize: '0.5rem',
        color: colors.text.dim,
        fontFamily: "'JetBrains Mono', monospace",
        mb: 0.3,
      }}>
        {label}
      </Typography>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && value.trim()) { e.preventDefault(); onSubmit(); }
          if (e.key === 'Escape') { e.preventDefault(); onSkip(); }
        }}
        placeholder="Custom answer…"
        style={{ ...fieldInputStyle, fontSize: '0.65rem' }}
      />
    </Box>
  );
}

interface ChoiceListProps {
  mode: 'single' | 'multi';
  options: Array<{ value: string; label?: string; recommended?: boolean; disabled?: boolean }>;
  selected: string | null | Set<string>;
  focusIdx: number;
  onFocusIdx: (idx: number) => void;
  onSelectSingle: (value: string) => void;
  onToggleMulti: (value: string) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  listRef: React.RefObject<HTMLDivElement | null>;
}

/** Options may arrive corrupted as nested `{label}` objects from older model tool args. */
function choiceText(raw: unknown): string {
  if (typeof raw === 'string') return raw;
  if (typeof raw === 'number' || typeof raw === 'boolean') return String(raw);
  if (!raw || typeof raw !== 'object') return '';
  const obj = raw as Record<string, unknown>;
  for (const key of ['label', 'value', 'text', 'name'] as const) {
    const nested = obj[key];
    if (typeof nested === 'string' && nested.trim()) return nested.trim();
    if (nested && typeof nested === 'object') {
      const deeper = choiceText(nested);
      if (deeper) return deeper;
    }
  }
  return '';
}

function ChoiceList({
  mode,
  options,
  selected,
  focusIdx,
  onFocusIdx,
  onSelectSingle,
  onToggleMulti,
  onKeyDown,
  listRef,
}: ChoiceListProps) {
  return (
    <Box
      ref={listRef}
      tabIndex={focusIdx >= 0 ? 0 : -1}
      onKeyDown={onKeyDown}
      sx={{ outline: 'none', py: 0.5, px: 0.75, display: 'flex', flexDirection: 'column', gap: 0.25 }}
    >
      {options.map((opt, idx) => {
        const value = choiceText(opt.value) || choiceText(opt.label) || `option_${idx}`;
        const label = choiceText(opt.label) || value;
        const isDisabled = opt.disabled === true;
        const checked = mode === 'single'
          ? selected === value
          : (selected as Set<string>).has(value);
        const focused = focusIdx === idx;

        return (
          <Box
            key={`${idx}:${value}`}
            role={mode === 'single' ? 'radio' : 'checkbox'}
            aria-checked={checked}
            aria-disabled={isDisabled}
            onClick={() => {
              if (isDisabled) return;
              onFocusIdx(idx);
              if (mode === 'single') onSelectSingle(value);
              else onToggleMulti(value);
            }}
            onMouseEnter={() => onFocusIdx(idx)}
            sx={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 0.75,
              px: 0.75,
              py: 0.5,
              borderRadius: '8px',
              cursor: isDisabled ? 'not-allowed' : 'pointer',
              opacity: isDisabled ? 0.45 : 1,
              bgcolor: focused || checked ? `${alphaColor(colors.accent.blue, '10')}` : 'transparent',
              border: `1px solid ${focused && !isDisabled ? alphaColor(colors.accent.blue, '50') : 'transparent'}`,
            }}
          >
            {mode === 'single' ? <RadioMark checked={checked} /> : <CheckMark checked={checked} />}
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography sx={{
                fontSize: '0.7rem',
                color: checked ? colors.text.primary : colors.text.secondary,
                fontWeight: checked ? 500 : 400,
                lineHeight: 1.4,
              }}>
                {label}
              </Typography>
              {opt.recommended && (
                <Typography sx={{
                  fontSize: '0.48rem',
                  color: colors.accent.blue,
                  fontFamily: "'JetBrains Mono', monospace",
                  mt: 0.15,
                }}>
                  suggested
                </Typography>
              )}
            </Box>
          </Box>
        );
      })}
    </Box>
  );
}

interface QuestionBlockRendererProps {
  question: QuestionnaireQuestion;
  state: QuestionnaireResponseState;
  onStateChange: (key: string, value: QuestionnaireResponseState[string]) => void;
  focusIdx: number;
  onFocusIdx: (idx: number) => void;
  listRef: React.RefObject<HTMLDivElement | null>;
  onSubmit: () => void;
  onSkip: () => void;
}

export function QuestionBlockRenderer({
  question,
  state,
  onStateChange,
  focusIdx,
  onFocusIdx,
  listRef,
  onSubmit,
  onSkip,
}: QuestionBlockRendererProps) {
  const customKey = `${question.id}${QUESTIONNAIRE_CUSTOM_SUFFIX}`;
  const customValue = (state[customKey] as string) ?? '';

  const handleListKeyDown = (e: React.KeyboardEvent) => {
    if (question.type !== 'single_choice' && question.type !== 'multi_choice') return;
    const options = question.options ?? [];
    const max = options.length - 1;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      onFocusIdx(Math.min(focusIdx + 1, max));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      onFocusIdx(Math.max(focusIdx - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const opt = options[focusIdx];
      if (!opt) return;
      const value = choiceText(opt.value) || choiceText(opt.label);
      if (!value) return;
      if (question.type === 'single_choice') {
        onStateChange(question.id, value);
      } else {
        const current = new Set((state[question.id] as Set<string>) ?? []);
        if (current.has(value)) current.delete(value);
        else current.add(value);
        onStateChange(question.id, current);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onSkip();
    }
  };

  if (question.type === 'single_choice' && question.options?.length) {
    return (
      <>
        <ChoiceList
          mode="single"
          options={question.options}
          selected={(state[question.id] as string | null) ?? null}
          focusIdx={focusIdx}
          onFocusIdx={onFocusIdx}
          onSelectSingle={(value) => onStateChange(question.id, value)}
          onToggleMulti={() => {}}
          onKeyDown={handleListKeyDown}
          listRef={listRef}
        />
        {question.allowCustom !== false && (
          <CustomAnswerField
            value={customValue}
            onChange={(v) => onStateChange(customKey, v)}
            onSubmit={onSubmit}
            onSkip={onSkip}
          />
        )}
      </>
    );
  }

  if (question.type === 'multi_choice' && question.options?.length) {
    return (
      <>
        <ChoiceList
          mode="multi"
          options={question.options}
          selected={(state[question.id] as Set<string>) ?? new Set()}
          focusIdx={focusIdx}
          onFocusIdx={onFocusIdx}
          onSelectSingle={() => {}}
          onToggleMulti={(value) => {
            const current = new Set((state[question.id] as Set<string>) ?? []);
            if (value === 'none') {
              onStateChange(question.id, new Set(['none']));
              return;
            }
            current.delete('none');
            const opt = question.options?.find((o) => o.value === value);
            if (opt?.disabled) return;
            if (current.has(value)) current.delete(value);
            else current.add(value);
            onStateChange(question.id, current);
          }}
          onKeyDown={handleListKeyDown}
          listRef={listRef}
        />
        {question.allowCustom !== false && (
          <CustomAnswerField
            value={customValue}
            onChange={(v) => onStateChange(customKey, v)}
            onSubmit={onSubmit}
            onSkip={onSkip}
          />
        )}
      </>
    );
  }

  const value = (state[question.id] as string) ?? '';
  return (
    <Box sx={{ px: 1.25, py: 0.75 }}>
      {question.multiline ? (
        <textarea
          value={value}
          onChange={(e) => onStateChange(question.id, e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSubmit(); }
            if (e.key === 'Escape') { e.preventDefault(); onSkip(); }
          }}
          placeholder={question.placeholder ?? 'Type your answer…'}
          rows={3}
          style={{ ...fieldInputStyle, resize: 'vertical', minHeight: 56 }}
        />
      ) : (
        <input
          type="text"
          value={value}
          onChange={(e) => onStateChange(question.id, e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); onSubmit(); }
            if (e.key === 'Escape') { e.preventDefault(); onSkip(); }
          }}
          placeholder={question.placeholder ?? 'Type your answer…'}
          style={fieldInputStyle}
        />
      )}
    </Box>
  );
}
