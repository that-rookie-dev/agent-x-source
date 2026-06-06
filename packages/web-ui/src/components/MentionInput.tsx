import { useRef, useEffect, useCallback } from 'react';
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

function buildChipHtml(callsign: string): string {
  const color = getCrewColor(callsign);
  return `<span data-mention="${callsign}" contenteditable="false" style="display:inline-block;padding:1px 6px;margin:0 2px;border-radius:4px;font-family:'JetBrains Mono',monospace;font-size:0.78rem;font-weight:600;color:${color};background:${color}18;border:1px solid ${color}30;cursor:default;user-select:all;">@${callsign}</span>`;
}

export function MentionInput({ value, onChange, onKeyDown, onMentionQuery, placeholder, crewList: _crewList, disabled, onInsertReady }: MentionInputProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const isComposing = useRef(false);
  const externalUpdate = useRef(false);

  const extractText = useCallback((): string => {
    const el = editorRef.current;
    if (!el) return '';
    const parts: string[] = [];
    const walk = (node: Node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        parts.push(node.textContent || '');
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        const span = node as HTMLElement;
        if (span.getAttribute('data-mention')) {
          parts.push('@' + span.getAttribute('data-mention'));
        } else if (span.tagName === 'BR') {
          parts.push('\n');
        } else {
          node.childNodes.forEach(walk);
        }
      }
    };
    el.childNodes.forEach(walk);
    return parts.join('');
  }, []);

  const textToHtml = useCallback((text: string): string => {
    const parts = text.split(/(@\w+)/g);
    return parts.map((part) => {
      if (part.startsWith('@') && part.length > 1) {
        return buildChipHtml(part.slice(1));
      }
      return part.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
    }).join('');
  }, []);

  // Initial mount and external value changes only
  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    if (externalUpdate.current) {
      externalUpdate.current = false;
      return;
    }
    el.innerHTML = textToHtml(value) || `<span style="color:${colors.text.dim};font-family:Inter,sans-serif;font-size:0.8rem;">${placeholder}</span>`;
  }, [value, textToHtml, placeholder]);

  // After insertMention, mark as external update so next sync applies
  useEffect(() => {
    if (value === '' && editorRef.current) {
      externalUpdate.current = true;
      editorRef.current.innerHTML = '';
    }
  }, [value]);

  const handleInput = useCallback(() => {
    const el = editorRef.current;
    if (!el || isComposing.current) return;
    const text = extractText();
    externalUpdate.current = true;
    onChange(text);

    // Detect @mention query
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      const range = sel.getRangeAt(0);
      const node = range.startContainer;
      if (node.nodeType === Node.TEXT_NODE) {
        const before = node.textContent?.slice(0, range.startOffset) || '';
        const atIdx = before.lastIndexOf('@');
        if (atIdx >= 0) {
          const preChar = atIdx === 0 ? ' ' : before[atIdx - 1];
          if (preChar === ' ' || preChar === '\n' || atIdx === 0) {
            const query = before.slice(atIdx + 1);
            if (!query.includes(' ')) {
              onMentionQuery(query);
              return;
            }
          }
        }
      }
    }
    onMentionQuery(null);
  }, [extractText, onChange, onMentionQuery]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (isComposing.current) return;
    onKeyDown(e);
  }, [onKeyDown]);

  const insertMention = useCallback((callsign: string) => {
    const el = editorRef.current;
    if (!el) return;
    el.focus();
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      const range = sel.getRangeAt(0);
      const node = range.startContainer;
      if (node.nodeType === Node.TEXT_NODE) {
        const before = node.textContent?.slice(0, range.startOffset) || '';
        const atIdx = before.lastIndexOf('@');
        if (atIdx >= 0) {
          const preChar = atIdx === 0 ? ' ' : before[atIdx - 1];
          if (preChar === ' ' || preChar === '\n' || atIdx === 0) {
            // Delete @query text
            range.setStart(node, atIdx);
            range.setEnd(node, range.startOffset + (before.length - atIdx) > before.length ? before.length : range.startOffset);
            // Actually just delete from @ to cursor
            const deleteRange = document.createRange();
            deleteRange.setStart(node, atIdx);
            deleteRange.setEnd(node, before.length);
            deleteRange.deleteContents();

            // Insert mention chip
            const span = document.createElement('span');
            span.setAttribute('data-mention', callsign);
            span.setAttribute('contenteditable', 'false');
            const color = getCrewColor(callsign);
            span.style.cssText = `display:inline-block;padding:1px 6px;margin:0 2px;border-radius:4px;font-family:'JetBrains Mono',monospace;font-size:0.78rem;font-weight:600;color:${color};background:${color}18;border:1px solid ${color}30;cursor:default;user-select:all;`;
            span.textContent = '@' + callsign;
            deleteRange.insertNode(span);

            // Add space after chip
            const space = document.createTextNode('\u00A0');
            deleteRange.setStartAfter(span);
            deleteRange.collapse(true);
            deleteRange.insertNode(space);
            deleteRange.setStartAfter(space);
            deleteRange.collapse(true);
            sel.removeAllRanges();
            sel.addRange(deleteRange);

            externalUpdate.current = true;
            onChange(extractText());
          }
        }
      }
    }
  }, [extractText, onChange]);

  useEffect(() => {
    onInsertReady?.(insertMention);
  }, [onInsertReady, insertMention]);

  return (
    <Box
      ref={editorRef}
      contentEditable={!disabled}
      suppressContentEditableWarning
      onInput={handleInput}
      onKeyDown={handleKeyDown}
      onCompositionStart={() => { isComposing.current = true; }}
      onCompositionEnd={() => { isComposing.current = false; handleInput(); }}
      onBlur={() => { externalUpdate.current = true; onChange(extractText()); }}
      sx={{
        flex: 1, border: 'none', outline: 'none',
        fontFamily: "'Inter', sans-serif", fontSize: '0.8rem',
        lineHeight: 1.5, py: 0.75, px: 0.5,
        minHeight: 24, maxHeight: 120, overflow: 'auto',
        color: colors.text.primary,
        '&:empty:before': {
          content: `"${placeholder}"`,
          color: colors.text.dim,
          fontFamily: "'Inter', sans-serif",
        },
      }}
    />
  );
}
