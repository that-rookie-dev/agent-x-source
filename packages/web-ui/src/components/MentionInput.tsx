import { useState, useRef, useEffect, useCallback } from 'react';
import Box from '@mui/material/Box';
import { colors } from '../theme';
import type { Crew } from '../api';

interface MentionInputProps {
  value: string;
  onChange: (value: string) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  onMentionQuery: (query: string | null) => void;
  placeholder: string;
  crewList: Crew[];
  disabled?: boolean;
  onInsertReady?: (fn: (callsign: string) => void) => void;
}

const CREW_PALETTE = ['#4FC3F7', '#FF8A65', '#81C784', '#BA68C8', '#F06292', '#AED581', '#7986CB', '#4DD0E1', '#FFD54F', '#A1887F'];

function getCrewColor(callsign: string): string {
  if (callsign === 'agentx') return colors.accent.blue;
  let hash = 0;
  for (let i = 0; i < callsign.length; i++) {
    hash = ((hash << 5) - hash) + callsign.charCodeAt(i);
    hash |= 0;
  }
  return CREW_PALETTE[Math.abs(hash) % CREW_PALETTE.length];
}

interface TextSegment { type: 'text'; id: string; value: string; }
interface MentionSegment { type: 'mention'; id: string; callsign: string; }
type Segment = TextSegment | MentionSegment;

function buildPlaintext(segs: Segment[]): string {
  return segs.map(s => s.type === 'mention' ? `@${s.callsign}` : s.value).join('');
}

function parseInitialSegments(value: string): Segment[] {
  if (!value) return [{ type: 'text', id: crypto.randomUUID(), value: '' }];
  const segs: Segment[] = [];
  const parts = value.split(/(@\w+)/g);
  for (const part of parts) {
    if (part.startsWith('@') && part.length > 1) {
      segs.push({ type: 'mention', id: crypto.randomUUID(), callsign: part.slice(1) });
    } else if (part.length > 0) {
      segs.push({ type: 'text', id: crypto.randomUUID(), value: part });
    }
  }
  if (segs.length === 0 || segs[segs.length - 1]?.type !== 'text') {
    segs.push({ type: 'text', id: crypto.randomUUID(), value: '' });
  }
  return segs;
}

export function MentionInput({ value, onChange, onKeyDown, onMentionQuery, placeholder, crewList: _crewList, disabled, onInsertReady }: MentionInputProps) {
  const [segments, setSegments] = useState<Segment[]>(() => parseInitialSegments(value));
  const textInputRefs = useRef<Map<string, HTMLTextAreaElement>>(new Map());
  const containerRef = useRef<HTMLDivElement>(null);
  const isComposing = useRef(false);
  const prevValueRef = useRef(value);

  const [mentionQuery, setMentionQueryLocal] = useState<string | null>(null);
  const mentionOriginRef = useRef<{ segmentIdx: number; atIdx: number } | null>(null);
  const mentionActiveRef = useRef(false);

  useEffect(() => {
    mentionActiveRef.current = mentionQuery !== null;
  }, [mentionQuery]);

  useEffect(() => {
    if (value === '' && prevValueRef.current !== '') {
      setMentionQueryLocal(null);
      mentionOriginRef.current = null;
      const existingEmpty = segments.find(s => s.type === 'text' && (s as TextSegment).value === '');
      if (existingEmpty) {
        requestAnimationFrame(() => {
          const el = textInputRefs.current.get(existingEmpty.id);
          if (el) el.focus();
        });
      } else {
        const newSeg = { type: 'text' as const, id: crypto.randomUUID(), value: '' };
        setSegments([newSeg]);
        requestAnimationFrame(() => {
          const el = textInputRefs.current.get(newSeg.id);
          if (el) el.focus();
        });
      }
    }
    prevValueRef.current = value;
  }, [value]);

  const notifyChange = useCallback((segs: Segment[]) => {
    onChange(buildPlaintext(segs));
  }, [onChange]);

  const focusTextInput = useCallback((segId: string, position: 'start' | 'end') => {
    requestAnimationFrame(() => {
      const el = textInputRefs.current.get(segId);
      if (el) {
        el.focus();
        const pos = position === 'end' ? el.value.length : 0;
        el.setSelectionRange(pos, pos);
      }
    });
  }, []);

  const ensureEndsWithText = useCallback((segs: Segment[]): Segment[] => {
    if (segs.length === 0 || segs[segs.length - 1]?.type !== 'text') {
      return [...segs, { type: 'text', id: crypto.randomUUID(), value: '' }];
    }
    return segs;
  }, []);

  const mergeAdjacentText = useCallback((segs: Segment[]): Segment[] => {
    if (segs.length < 2) return segs;
    const result: Segment[] = [segs[0]];
    for (let i = 1; i < segs.length; i++) {
      const prev = result[result.length - 1];
      const curr = segs[i];
      if (prev.type === 'text' && curr.type === 'text') {
        result[result.length - 1] = { ...prev, value: prev.value + (curr as TextSegment).value };
      } else {
        result.push(curr);
      }
    }
    return result;
  }, []);

  const insertMention = useCallback((callsign: string) => {
    const origin = mentionOriginRef.current;
    mentionOriginRef.current = null;
    setMentionQueryLocal(null);
    onMentionQuery(null);

    setSegments(prev => {
      if (!origin) return prev;
      const seg = prev[origin.segmentIdx];
      if (!seg || seg.type !== 'text') return prev;

      const val = seg.value;
      const atIdx = val.lastIndexOf('@');
      if (atIdx < 0) return prev;

      const before = val.slice(0, atIdx);

      const newSegs: Segment[] = [];
      if (before) newSegs.push({ type: 'text', id: crypto.randomUUID(), value: before });
      newSegs.push({ type: 'mention', id: crypto.randomUUID(), callsign });
      newSegs.push({ type: 'text', id: crypto.randomUUID(), value: '' });

      const result = [...prev];
      result.splice(origin.segmentIdx, 1, ...newSegs);

      const cleaned = ensureEndsWithText(mergeAdjacentText(result));
      notifyChange(cleaned);

      const newTextSeg = cleaned.filter(s => s.type === 'text').pop() as TextSegment | undefined;
      if (newTextSeg) {
        focusTextInput(newTextSeg.id, 'end');
      }

      return cleaned;
    });
  }, [notifyChange, onMentionQuery, ensureEndsWithText, mergeAdjacentText, focusTextInput]);

  useEffect(() => {
    onInsertReady?.(insertMention);
  }, [onInsertReady, insertMention]);

  const handleTextChange = useCallback((_segId: string, newValue: string, idx: number) => {
    if (isComposing.current) return;

    const atIdx = newValue.lastIndexOf('@');
    if (atIdx >= 0) {
      const preChar = atIdx === 0 ? ' ' : newValue[atIdx - 1];
      if (preChar === ' ' || preChar === '\n' || atIdx === 0) {
        const q = newValue.slice(atIdx + 1);
        if (!q.includes(' ') && !q.includes('\n')) {
          setMentionQueryLocal(q);
          mentionOriginRef.current = { segmentIdx: idx, atIdx };
          onMentionQuery(q);

          setSegments(prev => {
            const updated = [...prev];
            updated[idx] = { ...updated[idx], value: newValue } as TextSegment;
            notifyChange(updated);
            return updated;
          });
          return;
        }
      }
    }

    setMentionQueryLocal(null);
    mentionOriginRef.current = null;
    onMentionQuery(null);

    setSegments(prev => {
      const updated = [...prev];
      updated[idx] = { ...updated[idx], value: newValue } as TextSegment;
      notifyChange(updated);
      return updated;
    });
  }, [notifyChange, onMentionQuery]);

  const handleInputKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement | HTMLInputElement>, seg: Segment, idx: number) => {
    if (isComposing.current) return;

    if (mentionActiveRef.current) {
      if (e.key === 'Enter' && !e.shiftKey || e.key === 'Tab') {
        e.preventDefault();
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setMentionQueryLocal(null);
        mentionOriginRef.current = null;
        onMentionQuery(null);
        return;
      }
    }

    if (e.key === 'Backspace' && (seg as TextSegment).value === '') {
      if (idx > 0) {
        const prevSeg = segments[idx - 1];
        if (prevSeg?.type === 'mention') {
          e.preventDefault();
          setSegments(prev => {
            const updated = [...prev];
            updated.splice(idx - 1, 2);
            const cleaned = mergeAdjacentText(ensureEndsWithText(updated));
            notifyChange(cleaned);
            if (cleaned.length > 0 && cleaned[idx - 1]?.type === 'text') {
              focusTextInput((cleaned[idx - 1] as TextSegment).id, 'end');
            }
            return cleaned;
          });
          return;
        }
      }
    }

    if (e.key === 'ArrowLeft') {
      const input = e.currentTarget;
      if (input.selectionStart === 0) {
        for (let i = idx - 1; i >= 0; i--) {
          const s = segments[i];
          if (s?.type === 'text' && (s as TextSegment).value.length > 0) {
            e.preventDefault();
            focusTextInput(s.id, 'end');
            return;
          }
        }
        for (let i = segments.length - 1; i >= 0; i--) {
          const s = segments[i];
          if (s?.type === 'text') {
            e.preventDefault();
            focusTextInput(s.id, 'end');
            return;
          }
        }
      }
    }

    if (e.key === 'ArrowRight') {
      const input = e.currentTarget;
      if (input.selectionStart === input.value.length) {
        for (let i = idx + 1; i < segments.length; i++) {
          const s = segments[i];
          if (s?.type === 'text' && (s as TextSegment).value.length > 0) {
            e.preventDefault();
            focusTextInput(s.id, 'start');
            return;
          }
        }
        for (let i = segments.length - 1; i >= 0; i--) {
          const s = segments[i];
          if (s?.type === 'text') {
            e.preventDefault();
            focusTextInput(s.id, 'end');
            return;
          }
        }
      }
    }

    if (mentionActiveRef.current && e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      return;
    }

    onKeyDown(e);
  }, [segments, onKeyDown, notifyChange, mergeAdjacentText, ensureEndsWithText, focusTextInput, onMentionQuery]);

  const handleContainerClick = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest('textarea, input, button')) return;
    if (target.closest('[data-mention-chip]')) return;
    setSegments(prev => {
      const lastSeg = prev[prev.length - 1];
      if (lastSeg?.type === 'text') {
        focusTextInput(lastSeg.id, 'end');
      }
      return prev;
    });
  }, [focusTextInput]);

  const hasContent = segments.some(s => (s.type === 'text' && s.value !== '') || s.type === 'mention');

  return (
    <Box
      ref={containerRef}
      onClick={handleContainerClick}
      sx={{
        flex: 1,
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: '2px',
        minHeight: 24,
        maxHeight: 120,
        overflowY: 'auto',
        overflowX: 'hidden',
        py: 0.75,
        px: 0.5,
        border: 'none',
        outline: 'none',
        cursor: 'text',
        position: 'relative',
      }}
    >
      {segments.map((seg, idx) => {
        if (seg.type === 'mention') {
          const color = getCrewColor(seg.callsign);
          return (
            <Box
              key={seg.id}
              data-mention-chip
              component="span"
              sx={{
                display: 'inline-flex',
                alignItems: 'center',
                px: '6px',
                py: '1px',
                borderRadius: '4px',
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: '0.78rem',
                fontWeight: 600,
                color,
                bgcolor: color + '18',
                border: `1px solid ${color}30`,
                cursor: 'default',
                userSelect: 'none',
                whiteSpace: 'nowrap',
                flexShrink: 0,
                lineHeight: 1.5,
              }}
            >
              @{seg.callsign}
            </Box>
          );
        }

        const isLast = idx === segments.length - 1;
        const textLen = (seg as TextSegment).value.length || 0;
        const isEmpty = textLen === 0;
        return (
          <Box
            key={seg.id}
            component="span"
            sx={{
              display: 'inline-flex',
              alignItems: 'center',
              flex: isLast ? '1 1 auto' : '0 0 auto',
              minWidth: isLast ? '2ch' : 0,
              width: isLast ? undefined : (isEmpty ? 0 : 'auto'),
            }}
          >
            <Box
              component="textarea"
              ref={(el: HTMLTextAreaElement | null) => {
                if (el) textInputRefs.current.set(seg.id, el);
                else textInputRefs.current.delete(seg.id);
              }}
              value={(seg as TextSegment).value}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => {
                handleTextChange(seg.id, e.target.value, idx);
                e.target.style.height = 'auto';
                e.target.style.height = e.target.scrollHeight + 'px';
              }}
              onKeyDown={(e: React.KeyboardEvent<HTMLTextAreaElement>) => {
                handleInputKeyDown(e, seg, idx);
                if (e.key === 'Enter' && e.shiftKey) {
                  requestAnimationFrame(() => {
                    e.currentTarget.style.height = 'auto';
                    e.currentTarget.style.height = e.currentTarget.scrollHeight + 'px';
                  });
                }
              }}
              onCompositionStart={() => { isComposing.current = true; }}
              onCompositionEnd={() => { isComposing.current = false; }}
              disabled={disabled}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              rows={1}
              style={{
                border: 'none',
                outline: 'none',
                background: 'transparent',
                color: colors.text.primary,
                fontFamily: "'Inter', sans-serif",
                fontSize: '0.8rem',
                lineHeight: 1.5,
                width: isLast ? '100%' : (isEmpty ? '0' : `${Math.max(1, textLen)}ch`),
                minWidth: isLast ? '2ch' : 0,
                minHeight: '1.5em',
                height: 'auto',
                padding: 0,
                margin: 0,
                flex: isLast ? '1 1 auto' : '0 0 auto',
                resize: 'none',
                overflow: 'hidden',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                display: 'inline-block',
              }}
            />
          </Box>
        );
      })}
      {!hasContent && (
        <Box
          component="span"
          sx={{
            position: 'absolute',
            left: '6px',
            top: '50%',
            transform: 'translateY(-50%)',
            color: colors.text.dim,
            fontFamily: "'Inter', sans-serif",
            fontSize: '0.8rem',
            lineHeight: 1.5,
            pointerEvents: 'none',
            userSelect: 'none',
            whiteSpace: 'nowrap',
          }}
        >
          {placeholder}
        </Box>
      )}
    </Box>
  );
}
