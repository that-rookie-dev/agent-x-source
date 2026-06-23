import React, { useState, useRef, useEffect, useCallback, useImperativeHandle } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { colors } from '../theme';
import type { Crew } from '../api';

export interface MentionInputHandle {
  getValue: () => string;
  clear: () => void;
  focus: () => void;
  insertMention: (callsign: string) => void;
}

interface MentionInputProps {
  onKeyDown: (e: React.KeyboardEvent) => void;
  onMentionQuery: (query: string | null) => void;
  onTextChange?: (text: string) => void;
  placeholder: string;
  crewList?: Crew[];
  disabled?: boolean;
}

function hashCallsign(callsign: string): number {
  let hash = 0;
  for (let i = 0; i < callsign.length; i++) {
    hash = ((hash << 5) - hash) + callsign.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

const FALLBACK_PALETTE = ['#4FC3F7', '#FF8A65', '#81C784', '#BA68C8', '#F06292', '#AED581', '#7986CB', '#4DD0E1'];

function getCrewColor(callsign: string, crewList: Crew[]): string {
  const crew = crewList.find((c) => c.callsign.toLowerCase() === callsign.toLowerCase());
  if (crew?.color) return crew.color;
  if (callsign.toLowerCase() === 'agentx') return colors.accent.blue;
  return FALLBACK_PALETTE[hashCallsign(callsign) % FALLBACK_PALETTE.length]!;
}

function serializeDom(root: HTMLElement): string {
  let out = '';
  root.childNodes.forEach((node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      out += node.textContent ?? '';
    } else if (node instanceof HTMLElement) {
      const mention = node.dataset.mention;
      if (mention) {
        out += `@${mention}`;
      } else if (node.tagName === 'BR') {
        out += '\n';
      } else {
        out += node.textContent ?? '';
      }
    }
  });
  return out;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function buildHtmlFromPlain(text: string, crewList: Crew[]): string {
  if (!text) return '';
  const parts = text.split(/(@\w+)/g);
  return parts.map((part) => {
    if (part.startsWith('@') && part.length > 1) {
      const callsign = part.slice(1);
      const color = getCrewColor(callsign, crewList);
      return `<span data-mention="${escapeHtml(callsign)}" contenteditable="false" style="display:inline-flex;align-items:center;padding:1px 6px;margin:0 1px;border-radius:4px;font-family:'JetBrains Mono',monospace;font-size:0.78rem;font-weight:600;color:${color};background:${color}18;border:1px solid ${color}30;user-select:none;white-space:nowrap;line-height:1.5">@${escapeHtml(callsign)}</span>`;
    }
    return escapeHtml(part).replace(/\n/g, '<br>');
  }).join('');
}

const MentionInputComponent = React.forwardRef<MentionInputHandle, MentionInputProps>(function MentionInput(
  { onKeyDown, onMentionQuery, onTextChange, placeholder, crewList = [], disabled },
  ref,
) {
  const editorRef = useRef<HTMLDivElement>(null);
  const [isEmpty, setIsEmpty] = useState(true);
  const [invalidMentions, setInvalidMentions] = useState<string[]>([]);
  const isComposing = useRef(false);
  const plainRef = useRef('');
  const mentionOriginRef = useRef<number | null>(null);

  const syncFromDom = useCallback(() => {
    const el = editorRef.current;
    if (!el) return '';
    const plain = serializeDom(el);
    plainRef.current = plain;
    setIsEmpty(plain.trim().length === 0);
    onTextChange?.(plain);

    const mentions = plain.match(/(?<!\w)@(\w+)/g) ?? [];
    const invalid = mentions
      .map((m) => m.slice(1).toLowerCase())
      .filter((callsign) => callsign !== 'agentx' && callsign !== 'agent-x'
        && !crewList.some((c) => c.callsign.toLowerCase() === callsign));
    setInvalidMentions([...new Set(invalid)]);

    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) {
      onMentionQuery(null);
      mentionOriginRef.current = null;
      return plain;
    }

    const range = sel.getRangeAt(0);
    const preRange = range.cloneRange();
    preRange.selectNodeContents(el);
    preRange.setEnd(range.endContainer, range.endOffset);
    const textBefore = preRange.toString();
    const atIdx = textBefore.lastIndexOf('@');
    if (atIdx >= 0) {
      const preChar = atIdx === 0 ? ' ' : textBefore[atIdx - 1];
      if (preChar === ' ' || preChar === '\n' || atIdx === 0) {
        const q = textBefore.slice(atIdx + 1);
        if (!q.includes(' ') && !q.includes('\n')) {
          mentionOriginRef.current = atIdx;
          onMentionQuery(q);
          return plain;
        }
      }
    }
    mentionOriginRef.current = null;
    onMentionQuery(null);
    return plain;
  }, [onMentionQuery, onTextChange, crewList]);

  const insertMention = useCallback((callsign: string) => {
    const el = editorRef.current;
    if (!el) return;

    const plain = plainRef.current;
    const atIdx = mentionOriginRef.current ?? plain.lastIndexOf('@');
    if (atIdx < 0) {
      const next = plain + (plain.endsWith(' ') || plain.length === 0 ? '' : ' ') + `@${callsign} `;
      plainRef.current = next;
      el.innerHTML = buildHtmlFromPlain(next, crewList) + '\u200B';
      setIsEmpty(false);
      onTextChange?.(next);
      onMentionQuery(null);
      el.focus();
      return;
    }

    const before = plain.slice(0, atIdx);
    const afterStart = atIdx + 1;
    let afterIdx = afterStart;
    while (afterIdx < plain.length && !/\s/.test(plain[afterIdx]!)) afterIdx++;
    const after = plain.slice(afterIdx);
    const next = `${before}@${callsign}${after.startsWith(' ') ? '' : ' '}${after}`;
    plainRef.current = next;
    el.innerHTML = buildHtmlFromPlain(next, crewList) + '\u200B';
    setIsEmpty(next.trim().length === 0);
    onTextChange?.(next);
    mentionOriginRef.current = null;
    onMentionQuery(null);
    el.focus();
  }, [crewList, onMentionQuery, onTextChange]);

  const clear = useCallback(() => {
    const el = editorRef.current;
    if (!el) return;
    plainRef.current = '';
    el.innerHTML = '';
    setIsEmpty(true);
    onTextChange?.('');
    onMentionQuery(null);
    el.focus();
  }, [onMentionQuery, onTextChange]);

  useImperativeHandle(ref, () => ({
    getValue: () => plainRef.current,
    clear,
    focus: () => editorRef.current?.focus(),
    insertMention,
  }), [clear, insertMention]);

  const handleInput = useCallback(() => {
    if (isComposing.current) return;
    syncFromDom();
  }, [syncFromDom]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' && e.shiftKey) return;
    onKeyDown(e);
  }, [onKeyDown]);

  useEffect(() => {
    editorRef.current?.focus();
  }, []);

  return (
    <Box
      sx={{
        flex: 1,
        position: 'relative',
        minHeight: 24,
        maxHeight: 120,
        overflowY: 'auto',
        py: 0.75,
        px: 0.5,
        cursor: 'text',
      }}
      onClick={() => editorRef.current?.focus()}
    >
      <Box
        ref={editorRef}
        contentEditable={!disabled}
        suppressContentEditableWarning
        onInput={handleInput}
        onKeyDown={handleKeyDown}
        onCompositionStart={() => { isComposing.current = true; }}
        onCompositionEnd={() => { isComposing.current = false; handleInput(); }}
        onPaste={(e) => {
          e.preventDefault();
          const text = e.clipboardData.getData('text/plain');
          document.execCommand('insertText', false, text);
          handleInput();
        }}
        sx={{
          outline: 'none',
          minHeight: '1.5em',
          color: colors.text.primary,
          fontFamily: "'Inter', sans-serif",
          fontSize: '0.8rem',
          lineHeight: 1.5,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          '&:empty:before': { content: '""' },
        }}
      />
      {invalidMentions.length > 0 && (
        <Typography sx={{
          position: 'absolute', bottom: -16, left: 4,
          fontSize: '0.5rem', color: colors.accent.orange,
          fontFamily: "'JetBrains Mono', monospace",
        }}>
          Unknown crew: @{invalidMentions.join(', @')}
        </Typography>
      )}
      {isEmpty && (
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
            pointerEvents: 'none',
            userSelect: 'none',
          }}
        >
          {placeholder}
        </Box>
      )}
    </Box>
  );
});

export const MentionInput = React.memo(MentionInputComponent);
