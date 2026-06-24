import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { colors } from '../../theme';
import type {
  FormFieldsBlock,
  MultiChoiceBlock,
  QuestionnaireBlock,
  QuestionnaireResponseState,
  SingleChoiceBlock,
  TextBlock,
} from './types';
import { ALL_CHOICE_VALUE } from './types';

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
      bgcolor: checked ? `${colors.accent.blue}22` : 'transparent',
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

interface ChoiceListProps {
  mode: 'single' | 'multi';
  options: Array<{ value: string; label?: string; recommended?: boolean }>;
  allowAll?: boolean;
  selected: string | null | Set<string>;
  focusIdx: number;
  onFocusIdx: (idx: number) => void;
  onSelectSingle: (value: string) => void;
  onToggleMulti: (value: string) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  listRef: React.RefObject<HTMLDivElement | null>;
}

function ChoiceList({
  mode,
  options,
  allowAll,
  selected,
  focusIdx,
  onFocusIdx,
  onSelectSingle,
  onToggleMulti,
  onKeyDown,
  listRef,
}: ChoiceListProps) {
  const navigable = [...options];
  if (allowAll && options.length > 1) {
    navigable.push({ value: ALL_CHOICE_VALUE, label: 'All of the above' });
  }

  return (
    <Box
      ref={listRef}
      tabIndex={0}
      onKeyDown={onKeyDown}
      sx={{ outline: 'none', py: 0.5, px: 0.75, display: 'flex', flexDirection: 'column', gap: 0.25 }}
    >
      {navigable.map((opt, idx) => {
        const label = opt.label ?? opt.value;
        const checked = mode === 'single'
          ? selected === opt.value
          : (selected as Set<string>).has(opt.value);
        const focused = focusIdx === idx;

        return (
          <Box
            key={opt.value}
            role={mode === 'single' ? 'radio' : 'checkbox'}
            aria-checked={checked}
            onClick={() => {
              onFocusIdx(idx);
              if (mode === 'single') onSelectSingle(opt.value);
              else onToggleMulti(opt.value);
            }}
            onMouseEnter={() => onFocusIdx(idx)}
            sx={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 0.75,
              px: 0.75,
              py: 0.5,
              borderRadius: '8px',
              cursor: 'pointer',
              bgcolor: focused || checked ? `${colors.accent.blue}10` : 'transparent',
              border: `1px solid ${focused ? colors.accent.blue + '50' : 'transparent'}`,
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

interface BlockRendererProps {
  block: QuestionnaireBlock;
  state: QuestionnaireResponseState;
  onStateChange: (blockId: string, value: QuestionnaireResponseState[string]) => void;
  focusIdx: number;
  onFocusIdx: (idx: number) => void;
  listRef: React.RefObject<HTMLDivElement | null>;
  onListKeyDown: (e: React.KeyboardEvent, block: SingleChoiceBlock | MultiChoiceBlock) => void;
  onSubmit: () => void;
  onSkip: () => void;
}

export function QuestionnaireBlockRenderer({
  block,
  state,
  onStateChange,
  focusIdx,
  onFocusIdx,
  listRef,
  onListKeyDown,
  onSubmit,
  onSkip,
}: BlockRendererProps) {
  if (block.type === 'single_choice') {
    const freeTextKey = `${block.id}__freeform`;
    const freeText = (state[freeTextKey] as string) ?? '';

    return (
      <>
        <ChoiceList
          mode="single"
          options={block.options}
          allowAll={block.allowAll}
          selected={(state[block.id] as string | null) ?? null}
          focusIdx={focusIdx}
          onFocusIdx={onFocusIdx}
          onSelectSingle={(value) => onStateChange(block.id, value)}
          onToggleMulti={() => {}}
          onKeyDown={(e) => onListKeyDown(e, block)}
          listRef={listRef}
        />
        {block.allowFreeform !== false && (
          <Box sx={{ px: 1.25, pb: 0.5 }}>
            <Typography sx={{
              fontSize: '0.5rem',
              color: colors.text.dim,
              fontFamily: "'JetBrains Mono', monospace",
              mb: 0.3,
            }}>
              Or type a custom answer
            </Typography>
            <input
              type="text"
              value={freeText}
              onChange={(e) => onStateChange(freeTextKey, e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && freeText.trim()) { e.preventDefault(); onSubmit(); }
                if (e.key === 'Escape') { e.preventDefault(); onSkip(); }
              }}
              placeholder="Custom answer…"
              style={{ ...fieldInputStyle, fontSize: '0.65rem' }}
            />
          </Box>
        )}
      </>
    );
  }

  if (block.type === 'multi_choice') {
    return (
      <ChoiceList
        mode="multi"
        options={block.options}
        allowAll={block.allowAll}
        selected={(state[block.id] as Set<string>) ?? new Set()}
        focusIdx={focusIdx}
        onFocusIdx={onFocusIdx}
        onSelectSingle={() => {}}
        onToggleMulti={(value) => {
          const current = new Set((state[block.id] as Set<string>) ?? []);
          if (current.has(value)) current.delete(value);
          else current.add(value);
          onStateChange(block.id, current);
        }}
        onKeyDown={(e) => onListKeyDown(e, block)}
        listRef={listRef}
      />
    );
  }

  if (block.type === 'text') {
    const textBlock = block as TextBlock;
    const value = (state[block.id] as string) ?? '';
    return (
      <Box sx={{ px: 1.25, py: 0.75 }}>
        {textBlock.multiline ? (
          <textarea
            value={value}
            onChange={(e) => onStateChange(block.id, e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSubmit(); }
              if (e.key === 'Escape') { e.preventDefault(); onSkip(); }
            }}
            placeholder={textBlock.placeholder ?? 'Type your answer…'}
            rows={3}
            style={{ ...fieldInputStyle, resize: 'vertical', minHeight: 56 }}
          />
        ) : (
          <input
            type="text"
            value={value}
            onChange={(e) => onStateChange(block.id, e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); onSubmit(); }
              if (e.key === 'Escape') { e.preventDefault(); onSkip(); }
            }}
            placeholder={textBlock.placeholder ?? 'Type your answer…'}
            style={fieldInputStyle}
          />
        )}
      </Box>
    );
  }

  if (block.type === 'form_fields') {
    const formBlock = block as FormFieldsBlock;
    const values = (state[block.id] as Record<string, string>) ?? {};

    return (
      <Box sx={{ px: 1.25, py: 0.75, display: 'flex', flexDirection: 'column', gap: 0.65 }}>
        {formBlock.fields.map((field) => (
          <Box key={field.key}>
            <Typography sx={{
              fontSize: '0.55rem',
              color: colors.text.dim,
              fontFamily: "'JetBrains Mono', monospace",
              mb: 0.3,
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
            }}>
              {field.label}
            </Typography>
            {field.type === 'textarea' ? (
              <textarea
                value={values[field.key] ?? ''}
                onChange={(e) => onStateChange(block.id, { ...values, [field.key]: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSubmit(); }
                  if (e.key === 'Escape') { e.preventDefault(); onSkip(); }
                }}
                placeholder={field.placeholder ?? ''}
                rows={2}
                style={{ ...fieldInputStyle, resize: 'vertical' }}
              />
            ) : (
              <input
                type={field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'}
                value={values[field.key] ?? ''}
                onChange={(e) => onStateChange(block.id, { ...values, [field.key]: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); onSubmit(); }
                  if (e.key === 'Escape') { e.preventDefault(); onSkip(); }
                }}
                placeholder={field.placeholder ?? ''}
                style={fieldInputStyle}
              />
            )}
          </Box>
        ))}
      </Box>
    );
  }

  return null;
}
