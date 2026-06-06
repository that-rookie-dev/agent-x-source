import { useRef, useEffect, useCallback } from 'react';
import Box from '@mui/material/Box';
import { colors } from '../theme';
import type { Crew } from '../api';

interface MentionInputProps {
  value: string;
  onChange: (value: string) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  onMentionQuery: (query: string) => void;
  placeholder: string;
  crewList: Crew[];
  disabled?: boolean;
  onInsertReady?: (fn: (callsign: string) => void) => void;
}

function getCrewColor(callsign: string, crewList: Crew[]): string {
  if (callsign === 'agentx') return colors.accent.blue;
  const crew = crewList.find(c => c.callsign === callsign);
  if (crew) {
    let hash = 0;
    for (let i = 0; i < callsign.length; i++) {
      hash = ((hash << 5) - hash) + callsign.charCodeAt(i);
      hash |= 0;
    }
    const palette = ['#4FC3F7', '#FF8A65', '#81C784', '#BA68C8', '#F06292', '#AED581', '#7986CB', '#4DD0E1', '#FFD54F', '#A1887F'];
    return palette[Math.abs(hash) % palette.length];
  }
  return colors.accent.blue;
}

export function MentionInput({ value, onChange, onKeyDown, onMentionQuery, placeholder, crewList, disabled, onInsertReady }: MentionInputProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const isComposing = useRef(false);
  const lastHtmlRef = useRef('');

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

  const renderContent = useCallback((text: string) => {
    const parts = text.split(/(@\w+)/g);
    return parts.map((part) => {
      if (part.startsWith('@') && part.length > 1) {
        const callsign = part.slice(1);
        const color = getCrewColor(callsign, crewList);
        return `<span data-mention="${callsign}" contenteditable="false" style="display:inline-block;padding:1px 6px;margin:0 2px;border-radius:4px;font-family:'JetBrains Mono',monospace;font-size:0.78rem;font-weight:600;color:${color};background:${color}18;border:1px solid ${color}30;cursor:default;user-select:all;">@${callsign}</span>`;
      }
      return part.replace(/\n/g, '<br>');
    }).join('');
  }, [crewList]);

  const syncContent = useCallback(() => {
    const el = editorRef.current;
    if (!el) return;
    const html = renderContent(value);
    if (html !== lastHtmlRef.current) {
      lastHtmlRef.current = html;
      el.innerHTML = html || `<span style="color:${colors.text.dim};font-family:Inter,sans-serif;font-size:0.8rem;">${placeholder}</span>`;
    }
  }, [value, renderContent, placeholder]);

  useEffect(() => { syncContent(); }, [syncContent]);

  const handleInput = useCallback(() => {
    const el = editorRef.current;
    if (!el || isComposing.current) return;
    const text = extractText();
    lastHtmlRef.current = '';
    onChange(text);

    // Detect @mention query
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      const range = sel.getRangeAt(0);
      const before = range.startContainer.textContent?.slice(0, range.startOffset) || '';
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
    onMentionQuery('');
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
      const before = range.startContainer.textContent?.slice(0, range.startOffset) || '';
      const atIdx = before.lastIndexOf('@');
      if (atIdx >= 0) {
        const preChar = atIdx === 0 ? ' ' : before[atIdx - 1];
        if (preChar === ' ' || preChar === '\n' || atIdx === 0) {
          // Set cursor to @ position, delete @query, insert mention span
          range.setStart(range.startContainer, atIdx);
          range.deleteContents();
          const span = document.createElement('span');
          span.setAttribute('data-mention', callsign);
          span.setAttribute('contenteditable', 'false');
          const color = getCrewColor(callsign, crewList);
          span.style.cssText = `display:inline-block;padding:1px 6px;margin:0 2px;border-radius:4px;font-family:'JetBrains Mono',monospace;font-size:0.78rem;font-weight:600;color:${color};background:${color}18;border:1px solid ${color}30;cursor:default;user-select:all;`;
          span.textContent = '@' + callsign;
          range.insertNode(span);
          // Move cursor after the span
          const afterRange = document.createRange();
          afterRange.setStartAfter(span);
          afterRange.collapse(true);
          sel.removeAllRanges();
          sel.addRange(afterRange);
          // Insert a space
          const space = document.createTextNode('\u00A0');
          afterRange.insertNode(space);
          afterRange.setStartAfter(space);
          afterRange.collapse(true);
          sel.removeAllRanges();
          sel.addRange(afterRange);
          onChange(extractText());
        }
      }
    }
  }, [crewList, extractText, onChange]);

  // Expose insertMention to parent
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
      onBlur={() => { onChange(extractText()); }}
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
