import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import { CrewAwareMarkdown } from '../chat/ChatMarkdown';
import { colors } from '../theme';

export interface ClarificationField {
  key: string;
  label: string;
  placeholder?: string;
}

export interface ClarificationData {
  question: string;
  options: string[];
  recommended?: string;
  allowChooseAll?: boolean;
  allowFreeform?: boolean;
  selectionMode?: 'single' | 'multiple';
  fields?: ClarificationField[];
}

interface ClarificationPromptProps {
  data: ClarificationData;
  onRespond: (response: string) => void;
}

type InputMode = 'single' | 'multiple' | 'form' | 'text';

function resolveMode(data: ClarificationData): InputMode {
  if (data.fields?.length) return 'form';
  if (data.selectionMode === 'multiple') return 'multiple';
  if (data.options.length > 0) return 'single';
  return 'text';
}

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
      transition: 'border-color 0.1s',
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
      lineHeight: 1,
    }}>
      {checked ? '✓' : ''}
    </Box>
  );
}

const fieldInputStyle: React.CSSProperties = {
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

export function ClarificationPrompt({ data, onRespond }: ClarificationPromptProps) {
  const mode = useMemo(() => resolveMode(data), [data]);
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [selectedOptions, setSelectedOptions] = useState<Set<string>>(new Set());
  const [formValues, setFormValues] = useState<Record<string, string>>({});
  const [freeText, setFreeText] = useState('');
  const [focusIdx, setFocusIdx] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const freeTextRef = useRef<HTMLInputElement>(null);

  const navigableOptions = useMemo(() => {
    const opts = [...data.options];
    if (data.allowChooseAll && data.options.length > 1) {
      opts.push('__all__');
    }
    return opts;
  }, [data.options, data.allowChooseAll]);

  useEffect(() => {
    setSelectedOption(data.recommended ?? null);
    setSelectedOptions(new Set(data.recommended ? [data.recommended] : []));
    setFormValues(Object.fromEntries((data.fields ?? []).map((f) => [f.key, ''])));
    setFreeText('');
    setFocusIdx(0);
    if (mode === 'single' || mode === 'multiple') {
      listRef.current?.focus();
    } else if (mode === 'text') {
      freeTextRef.current?.focus();
    }
  }, [data.question, data.options.join('|'), data.fields?.map((f) => f.key).join('|'), mode, data.recommended]);

  const canSubmit = useMemo(() => {
    if (mode === 'single') return !!selectedOption;
    if (mode === 'multiple') return selectedOptions.size > 0;
    if (mode === 'form') return (data.fields ?? []).every((f) => formValues[f.key]?.trim());
    return freeText.trim().length > 0;
  }, [mode, selectedOption, selectedOptions, formValues, freeText, data.fields]);

  const buildResponse = useCallback((): string | null => {
    if (mode === 'single') {
      if (!selectedOption) return null;
      if (selectedOption === '__all__') return `All: ${data.options.join(', ')}`;
      return selectedOption;
    }
    if (mode === 'multiple') {
      if (selectedOptions.size === 0) return null;
      return [...selectedOptions].join(', ');
    }
    if (mode === 'form') {
      const missing = (data.fields ?? []).find((f) => !formValues[f.key]?.trim());
      if (missing) return null;
      return (data.fields ?? []).map((f) => `${f.label}: ${formValues[f.key].trim()}`).join('\n');
    }
    const text = freeText.trim();
    return text || null;
  }, [mode, selectedOption, selectedOptions, formValues, freeText, data.options, data.fields]);

  const handleSubmit = useCallback(() => {
    const response = buildResponse();
    if (response) onRespond(response);
  }, [buildResponse, onRespond]);

  const toggleMultiple = useCallback((opt: string) => {
    setSelectedOptions((prev) => {
      const next = new Set(prev);
      if (next.has(opt)) next.delete(opt);
      else next.add(opt);
      return next;
    });
  }, []);

  const handleListKeyDown = useCallback((e: React.KeyboardEvent) => {
    const max = navigableOptions.length - 1;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setFocusIdx((i) => Math.min(i + 1, max));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setFocusIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const opt = navigableOptions[focusIdx];
      if (!opt) return;
      if (mode === 'single') {
        setSelectedOption(opt);
        if (opt !== '__all__') onRespond(opt);
        else onRespond(`All: ${data.options.join(', ')}`);
      } else {
        toggleMultiple(opt);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onRespond('(skipped)');
    }
  }, [navigableOptions, focusIdx, mode, onRespond, data.options, toggleMultiple]);

  const renderOptionLabel = (opt: string) => {
    if (opt === '__all__') return 'All of the above';
    return opt;
  };

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
        <Typography sx={{
          fontSize: '0.5rem',
          fontFamily: "'JetBrains Mono', monospace",
          color: colors.accent.blue,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          mb: 0.35,
        }}>
          Input needed
        </Typography>
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
          <CrewAwareMarkdown content={data.question} />
        </Box>
      </Box>

      {(mode === 'single' || mode === 'multiple') && (
        <Box
          ref={listRef}
          tabIndex={0}
          onKeyDown={handleListKeyDown}
          sx={{ outline: 'none', py: 0.5, px: 0.75, display: 'flex', flexDirection: 'column', gap: 0.25 }}
        >
          {navigableOptions.map((opt, idx) => {
            const label = renderOptionLabel(opt);
            const isRecommended = opt !== '__all__' && data.recommended === opt;
            const focused = focusIdx === idx;
            const checked = mode === 'single'
              ? selectedOption === opt
              : selectedOptions.has(opt);

            return (
              <Box
                key={opt}
                role={mode === 'single' ? 'radio' : 'checkbox'}
                aria-checked={checked}
                onClick={() => {
                  setFocusIdx(idx);
                  if (mode === 'single') {
                    setSelectedOption(opt);
                    if (opt === '__all__') onRespond(`All: ${data.options.join(', ')}`);
                    else onRespond(opt);
                  } else {
                    toggleMultiple(opt);
                  }
                }}
                onMouseEnter={() => setFocusIdx(idx)}
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
                  transition: 'background 0.1s, border-color 0.1s',
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
                  {isRecommended && (
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
      )}

      {mode === 'form' && (
        <Box sx={{ px: 1.25, py: 0.75, display: 'flex', flexDirection: 'column', gap: 0.65 }}>
          {(data.fields ?? []).map((field) => (
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
              <input
                type="text"
                value={formValues[field.key] ?? ''}
                onChange={(e) => setFormValues((v) => ({ ...v, [field.key]: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); handleSubmit(); }
                  if (e.key === 'Escape') { e.preventDefault(); onRespond('(skipped)'); }
                }}
                placeholder={field.placeholder ?? ''}
                style={fieldInputStyle}
              />
            </Box>
          ))}
        </Box>
      )}

      {mode === 'text' && (
        <Box sx={{ px: 1.25, py: 0.75 }}>
          <input
            ref={freeTextRef}
            type="text"
            value={freeText}
            onChange={(e) => setFreeText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); handleSubmit(); }
              if (e.key === 'Escape') { e.preventDefault(); onRespond('(skipped)'); }
            }}
            placeholder="Type your answer…"
            style={fieldInputStyle}
          />
        </Box>
      )}

      {(mode === 'single' || mode === 'multiple') && data.allowFreeform !== false && (
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
            onChange={(e) => setFreeText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && freeText.trim()) {
                e.preventDefault();
                onRespond(freeText.trim());
              }
            }}
            placeholder="Custom answer…"
            style={{ ...fieldInputStyle, fontSize: '0.65rem' }}
          />
        </Box>
      )}

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
        <Button
          size="small"
          onClick={() => onRespond('(skipped)')}
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
        <Typography sx={{ fontSize: '0.45rem', color: colors.text.dim, fontFamily: "'JetBrains Mono', monospace", flex: 1, textAlign: 'center' }}>
          {mode === 'single' || mode === 'multiple' ? '↑↓ · Enter' : 'Enter to submit'} · Esc skip
        </Typography>
        <Button
          size="small"
          disabled={!canSubmit && !(freeText.trim() && (mode === 'single' || mode === 'multiple'))}
          onClick={() => {
            if (freeText.trim() && (mode === 'single' || mode === 'multiple')) {
              onRespond(freeText.trim());
            } else {
              handleSubmit();
            }
          }}
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
          Continue
        </Button>
      </Box>
    </Box>
  );
}
