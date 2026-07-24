import React, { useState, useRef, useEffect, useCallback, useImperativeHandle } from 'react';
import Box from '@mui/material/Box';
import { colors, alphaColor } from '../theme';
import { getCrewAccent } from '../styles/crew-theme';
import type { Crew } from '../api';
import {
  MENTION_TOKEN_SPLIT_RE,
  findActiveMentionQuery,
  formatCrewMentionToken,
  formatFileMentionToken,
  formatFolderMentionToken,
  formatKbMentionToken,
  parseCrewMentionToken,
  parseFileMentionToken,
  parseFolderMentionToken,
  parseKbMentionToken,
} from '../chat/mention-tokens';

export interface MentionInputHandle {
  getValue: () => string;
  clear: () => void;
  setValue: (text: string) => void;
  focus: () => void;
  /** Insert a crew chip (serializes as @crew[callsign:name]). */
  insertMention: (crew: { callsign: string; name?: string }) => void;
  /** Insert an inline file chip (Cursor-style) at the active @ query or caret. */
  insertFileChip: (file: { id: string; name: string; path: string; relativePath: string }) => void;
  /** Insert an inline folder chip (serializes as @folder[relativePath]). */
  insertFolderChip: (folder: { id: string; name: string; path: string; relativePath: string }) => void;
  /** Insert a Knowledge Base document chip (serializes as @kb[sourceId:name]). */
  insertKbChip: (source: { sourceId: string; name: string }) => void;
  /** Sync a newly attached upload into an inline chip at the caret. */
  insertAttachmentChip: (attachment: { id: string; name: string }) => void;
}

interface MentionInputProps {
  onKeyDown: (e: React.KeyboardEvent) => void;
  onMentionQuery: (query: string | null) => void;
  onTextChange?: (text: string) => void;
  onFocusChange?: (focused: boolean) => void;
  /** Fired when a file chip is removed so parent can drop the attachment. */
  onFileChipRemove?: (attachmentId: string) => void;
  placeholder: string;
  crewList?: Crew[];
  disabled?: boolean;
}

function getCrewColor(callsign: string, crewList: Crew[]): string {
  if (callsign.toLowerCase() === 'agentx' || callsign.toLowerCase() === 'agent-x') {
    return colors.accent.blue;
  }
  const crew = crewList.find((c) => c.callsign.toLowerCase() === callsign.toLowerCase());
  return getCrewAccent(crew?.color, callsign);
}

const BLOCK_TAGS = new Set([
  'DIV', 'P', 'LI', 'UL', 'OL', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
  'PRE', 'BLOCKQUOTE', 'TR', 'SECTION', 'ARTICLE',
]);

function serializeNode(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? '';
  if (!(node instanceof HTMLElement)) return '';
  const chip = node.dataset.chip;
  if (chip === 'crew') {
    const callsign = node.dataset.callsign || node.dataset.mention || '';
    const name = node.dataset.crewName || callsign;
    return callsign ? formatCrewMentionToken(callsign, name) : '';
  }
  if (chip === 'file') {
    const rel = node.dataset.relativePath || node.dataset.name || '';
    return rel ? formatFileMentionToken(rel) : '';
  }
  if (chip === 'folder') {
    const rel = node.dataset.relativePath || node.dataset.name || '';
    return rel ? formatFolderMentionToken(rel) : '';
  }
  if (chip === 'kb') {
    const sourceId = node.dataset.sourceId || '';
    const name = node.dataset.name || sourceId;
    return sourceId ? formatKbMentionToken(sourceId, name) : '';
  }
  // Legacy crew mention spans
  const mention = node.dataset.mention;
  if (mention) return formatCrewMentionToken(mention, mention);
  if (node.tagName === 'BR') return '\n';

  let inner = '';
  node.childNodes.forEach((child) => { inner += serializeNode(child); });

  if (BLOCK_TAGS.has(node.tagName)) {
    if (inner.length > 0 && !inner.endsWith('\n')) inner += '\n';
    return inner;
  }
  return inner;
}

function serializeDom(root: HTMLElement): string {
  let out = '';
  root.childNodes.forEach((node) => { out += serializeNode(node); });
  return out.replace(/\u200B/g, '').replace(/\n$/, '');
}

/**
 * Serialize DOM up to the caret using the same chip→token rules as serializeDom.
 * Avoids Range.toString(), which pulls visible chip labels (e.g. "@alice") and
 * falsely re-opens the mention menu.
 */
function serializeBeforeCaret(root: HTMLElement, range: Range): string {
  let out = '';
  let done = false;

  const walk = (node: Node): void => {
    if (done) return;

    if (node === range.endContainer) {
      if (node.nodeType === Node.TEXT_NODE) {
        out += (node.textContent ?? '').slice(0, range.endOffset);
      } else if (node instanceof HTMLElement && !node.dataset.chip) {
        const children = Array.from(node.childNodes);
        for (let i = 0; i < range.endOffset && i < children.length; i++) {
          walk(children[i]!);
          if (done) return;
        }
      }
      done = true;
      return;
    }

    if (node.nodeType === Node.TEXT_NODE) {
      out += node.textContent ?? '';
      return;
    }

    if (!(node instanceof HTMLElement)) return;

    if (node.dataset.chip) {
      out += serializeNode(node);
      return;
    }

    if (node.tagName === 'BR') {
      out += '\n';
      return;
    }

    node.childNodes.forEach((child) => walk(child));
  };

  root.childNodes.forEach((child) => walk(child));
  return out.replace(/\u200B/g, '');
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Inline person icon for contenteditable crew chips (no React/MUI in HTML string). */
const PERSON_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="8" height="8" fill="currentColor" aria-hidden="true"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>`;

function crewChipHtml(callsign: string, name: string, crewList: Crew[]): string {
  const color = getCrewColor(callsign, crewList);
  const cs = escapeHtml(callsign);
  const displayName = name || callsign;
  const nm = escapeHtml(displayName);
  const title = escapeHtml(`@${callsign}${displayName !== callsign ? ` — ${displayName}` : ''}`);
  // padding-left 0 so the person badge touches the capsule border (same as files).
  return `<span data-chip="crew" data-callsign="${cs}" data-crew-name="${nm}" data-mention="${cs}" contenteditable="false" title="${title}" style="display:inline-flex;align-items:center;gap:3px;box-sizing:border-box;padding:0 5px 0 0;margin:0 1px;border-radius:999px;font-family:'JetBrains Mono',monospace;font-size:0.55rem;font-weight:600;color:${color};background:${alphaColor(color, '16')};border:1px solid ${alphaColor(color, '28')};user-select:none;white-space:nowrap;line-height:1.2;vertical-align:middle;max-width:200px;overflow:hidden"><span style="display:inline-flex;align-items:center;justify-content:center;width:14px;height:14px;border-radius:999px;line-height:1;color:${colors.bg.primary};background:${color};flex-shrink:0">${PERSON_ICON_SVG}</span><span style="overflow:hidden;text-overflow:ellipsis;max-width:160px">${nm}</span></span>`;
}

function fileChipHtml(file: { id: string; name: string; relativePath: string }): string {
  const rawName = file.name || 'file';
  const extRaw = rawName.includes('.') ? (rawName.split('.').pop() || '').toUpperCase() : '';
  const ext = (extRaw || 'FILE').slice(0, 6);
  const display = rawName.length > 24 ? `${rawName.slice(0, 24)}…` : rawName;
  const label = escapeHtml(display);
  const title = escapeHtml(file.relativePath || rawName);
  const extLabel = escapeHtml(ext);
  return `<span data-chip="file" data-attachment-id="${escapeHtml(file.id)}" data-name="${escapeHtml(rawName)}" data-relative-path="${title}" contenteditable="false" title="${title}" style="display:inline-flex;align-items:center;gap:3px;box-sizing:border-box;padding:0 5px 0 0;margin:0 1px;border-radius:999px;font-family:'JetBrains Mono',monospace;font-size:0.55rem;font-weight:600;color:${colors.accent.cyan};background:${alphaColor(colors.accent.cyan, '12')};border:1px solid ${alphaColor(colors.accent.cyan, '28')};user-select:none;white-space:nowrap;line-height:1.2;vertical-align:middle;max-width:200px;overflow:hidden"><span style="display:inline-flex;align-items:center;justify-content:center;min-width:16px;padding:0 3px;height:14px;border-radius:999px;font-size:0.42rem;font-weight:700;letter-spacing:0.02em;line-height:1;color:${colors.bg.primary};background:${colors.accent.cyan};flex-shrink:0">${extLabel}</span><span style="overflow:hidden;text-overflow:ellipsis;max-width:160px">${label}</span></span>`;
}

const FOLDER_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="9" height="9" fill="currentColor" aria-hidden="true"><path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/></svg>`;

function folderChipHtml(folder: { id: string; name: string; relativePath: string }): string {
  const rawName = folder.name || 'folder';
  const display = rawName.length > 24 ? `${rawName.slice(0, 24)}…` : rawName;
  const label = escapeHtml(display);
  const title = escapeHtml(folder.relativePath || rawName);
  return `<span data-chip="folder" data-attachment-id="${escapeHtml(folder.id)}" data-name="${escapeHtml(rawName)}" data-relative-path="${title}" contenteditable="false" title="${title}" style="display:inline-flex;align-items:center;gap:3px;box-sizing:border-box;padding:0 5px 0 0;margin:0 1px;border-radius:999px;font-family:'JetBrains Mono',monospace;font-size:0.55rem;font-weight:600;color:${colors.accent.cyan};background:${alphaColor(colors.accent.cyan, '12')};border:1px solid ${alphaColor(colors.accent.cyan, '28')};user-select:none;white-space:nowrap;line-height:1.2;vertical-align:middle;max-width:200px;overflow:hidden"><span style="display:inline-flex;align-items:center;justify-content:center;width:14px;height:14px;border-radius:999px;line-height:1;color:${colors.bg.primary};background:${colors.accent.cyan};flex-shrink:0">${FOLDER_ICON_SVG}</span><span style="overflow:hidden;text-overflow:ellipsis;max-width:160px">${label}</span></span>`;
}

function kbChipHtml(source: { sourceId: string; name: string }): string {
  const rawName = source.name || source.sourceId || 'document';
  const extRaw = rawName.includes('.') ? (rawName.split('.').pop() || '').toUpperCase() : '';
  const ext = (extRaw || 'KB').slice(0, 6);
  const display = rawName.length > 24 ? `${rawName.slice(0, 24)}…` : rawName;
  const label = escapeHtml(display);
  const title = escapeHtml(`Knowledge Base: ${rawName}`);
  const extLabel = escapeHtml(ext);
  return `<span data-chip="kb" data-source-id="${escapeHtml(source.sourceId)}" data-name="${escapeHtml(rawName)}" contenteditable="false" title="${title}" style="display:inline-flex;align-items:center;gap:3px;box-sizing:border-box;padding:0 5px 0 0;margin:0 1px;border-radius:999px;font-family:'JetBrains Mono',monospace;font-size:0.55rem;font-weight:600;color:${colors.accent.purple};background:${alphaColor(colors.accent.purple, '12')};border:1px solid ${alphaColor(colors.accent.purple, '28')};user-select:none;white-space:nowrap;line-height:1.2;vertical-align:middle;max-width:200px;overflow:hidden"><span style="display:inline-flex;align-items:center;justify-content:center;min-width:16px;padding:0 3px;height:14px;border-radius:999px;font-size:0.42rem;font-weight:700;letter-spacing:0.02em;line-height:1;color:${colors.bg.primary};background:${colors.accent.purple};flex-shrink:0">${extLabel}</span><span style="overflow:hidden;text-overflow:ellipsis;max-width:160px">${label}</span></span>`;
}

function buildHtmlFromPlain(text: string, crewList: Crew[]): string {
  if (!text) return '';
  const parts = text.split(MENTION_TOKEN_SPLIT_RE);
  return parts.map((part) => {
    const file = parseFileMentionToken(part);
    if (file) {
      return fileChipHtml({ id: crypto.randomUUID(), name: file.name, relativePath: file.relativePath });
    }
    const folder = parseFolderMentionToken(part);
    if (folder) {
      return folderChipHtml({ id: crypto.randomUUID(), name: folder.name, relativePath: folder.relativePath });
    }
    const kbTok = parseKbMentionToken(part);
    if (kbTok) {
      return kbChipHtml(kbTok);
    }
    const crewTok = parseCrewMentionToken(part);
    if (crewTok) {
      return crewChipHtml(crewTok.callsign, crewTok.name, crewList);
    }
    // Legacy bare @callsign
    if (part.startsWith('@') && part.length > 1 && !part.includes(':') && !part.includes('[')) {
      const callsign = part.slice(1);
      const crew = crewList.find((c) => c.callsign.toLowerCase() === callsign.toLowerCase());
      return crewChipHtml(callsign, crew?.name || callsign, crewList);
    }
    return escapeHtml(part).replace(/\n/g, '<br>');
  }).join('');
}

function placeCaretAfter(node: Node): void {
  const sel = window.getSelection();
  if (!sel) return;
  const range = document.createRange();
  range.setStartAfter(node);
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
}

const MentionInputComponent = React.forwardRef<MentionInputHandle, MentionInputProps>(function MentionInput(
  { onKeyDown, onMentionQuery, onTextChange, onFocusChange, onFileChipRemove, placeholder, crewList = [], disabled },
  ref,
) {
  const editorRef = useRef<HTMLDivElement>(null);
  const [isEmpty, setIsEmpty] = useState(true);
  const isComposing = useRef(false);
  const plainRef = useRef('');
  const mentionOriginRef = useRef<number | null>(null);
  const emptyRef = useRef(true);
  const pendingNotifyRef = useRef<number | null>(null);
  const knownFileChipIdsRef = useRef<Set<string>>(new Set());
  const onFileChipRemoveRef = useRef(onFileChipRemove);
  onFileChipRemoveRef.current = onFileChipRemove;

  const notifyText = useCallback((plain: string) => {
    plainRef.current = plain;
    const empty = plain.trim().length === 0;
    if (empty !== emptyRef.current) {
      emptyRef.current = empty;
      setIsEmpty(empty);
    }
    onTextChange?.(plain);
  }, [onTextChange]);

  const syncFromDom = useCallback(() => {
    const el = editorRef.current;
    if (!el) return '';
    const plain = serializeDom(el);
    notifyText(plain);

    const liveIds = new Set<string>();
    el.querySelectorAll('[data-chip="file"], [data-chip="folder"]').forEach((node) => {
      const id = (node as HTMLElement).dataset.attachmentId;
      if (id) liveIds.add(id);
    });
    for (const id of knownFileChipIdsRef.current) {
      if (!liveIds.has(id)) onFileChipRemoveRef.current?.(id);
    }
    knownFileChipIdsRef.current = liveIds;

    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) {
      onMentionQuery(null);
      mentionOriginRef.current = null;
      return plain;
    }

    const range = sel.getRangeAt(0);
    const chip = range.startContainer instanceof Element
      ? range.startContainer.closest('[data-chip]')
      : range.startContainer.parentElement?.closest('[data-chip]');
    if (chip) {
      onMentionQuery(null);
      mentionOriginRef.current = null;
      return plain;
    }

    const textBefore = serializeBeforeCaret(el, range);
    const active = findActiveMentionQuery(textBefore);
    if (active) {
      mentionOriginRef.current = active.atIdx;
      onMentionQuery(active.query);
      return plain;
    }
    mentionOriginRef.current = null;
    onMentionQuery(null);
    return plain;
  }, [notifyText, onMentionQuery]);

  const replaceActiveQueryWithHtml = useCallback((chipHtml: string) => {
    const el = editorRef.current;
    if (!el) return;
    const plain = plainRef.current;
    const atIdx = mentionOriginRef.current ?? findActiveMentionQuery(plain)?.atIdx ?? plain.lastIndexOf('@');
    // Trailing regular space after the chip (user can delete it); ZWSP keeps caret editable.
    const afterChip = ' \u200B';

    if (atIdx < 0) {
      el.insertAdjacentHTML('beforeend', chipHtml + afterChip);
      notifyText(serializeDom(el));
      onMentionQuery(null);
      el.focus();
      const chips = el.querySelectorAll('[data-chip]');
      const last = chips[chips.length - 1];
      if (last) {
        const spaceNode = last.nextSibling;
        placeCaretAfter(spaceNode && spaceNode.nodeType === Node.TEXT_NODE ? spaceNode : last);
      }
      return;
    }

    const before = plain.slice(0, atIdx);
    let afterIdx = atIdx + 1;
    while (afterIdx < plain.length && !/\s/.test(plain[afterIdx]!)) afterIdx++;
    const after = plain.slice(afterIdx);
    const beforeHtml = buildHtmlFromPlain(before, crewList);
    const afterHtml = buildHtmlFromPlain(after, crewList);
    const marker = `data-chip-insert="${Date.now()}"`;
    const markedHtml = chipHtml.replace('data-chip=', `${marker} data-chip=`);
    el.innerHTML = `${beforeHtml}${markedHtml}${afterChip}${afterHtml}`;
    notifyText(serializeDom(el));
    mentionOriginRef.current = null;
    onMentionQuery(null);
    el.focus();
    const chipEl = el.querySelector(`[${marker}]`) ?? el.querySelector('[data-chip]:last-of-type');
    if (chipEl instanceof HTMLElement) {
      chipEl.removeAttribute('data-chip-insert');
      const spaceNode = chipEl.nextSibling;
      placeCaretAfter(spaceNode && spaceNode.nodeType === Node.TEXT_NODE ? spaceNode : chipEl);
    }
  }, [crewList, notifyText, onMentionQuery]);

  const insertMention = useCallback((crew: { callsign: string; name?: string }) => {
    const name = crew.name || crew.callsign;
    replaceActiveQueryWithHtml(crewChipHtml(crew.callsign, name, crewList));
  }, [crewList, replaceActiveQueryWithHtml]);

  const insertFileChip = useCallback((file: { id: string; name: string; path: string; relativePath: string }) => {
    knownFileChipIdsRef.current.add(file.id);
    replaceActiveQueryWithHtml(fileChipHtml(file));
  }, [replaceActiveQueryWithHtml]);

  const insertFolderChip = useCallback((folder: { id: string; name: string; path: string; relativePath: string }) => {
    knownFileChipIdsRef.current.add(folder.id);
    replaceActiveQueryWithHtml(folderChipHtml(folder));
  }, [replaceActiveQueryWithHtml]);

  const insertKbChip = useCallback((source: { sourceId: string; name: string }) => {
    replaceActiveQueryWithHtml(kbChipHtml(source));
  }, [replaceActiveQueryWithHtml]);

  const insertAttachmentChip = useCallback((attachment: { id: string; name: string }) => {
    const el = editorRef.current;
    if (!el) return;
    knownFileChipIdsRef.current.add(attachment.id);
    const html = fileChipHtml({ id: attachment.id, name: attachment.name, relativePath: attachment.name });
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0 && el.contains(sel.anchorNode)) {
      const range = sel.getRangeAt(0);
      range.deleteContents();
      const temp = document.createElement('span');
      temp.innerHTML = html + ' \u200B';
      const frag = document.createDocumentFragment();
      while (temp.firstChild) frag.appendChild(temp.firstChild);
      const last = frag.lastChild;
      range.insertNode(frag);
      if (last) placeCaretAfter(last);
    } else {
      el.insertAdjacentHTML('beforeend', html + ' \u200B');
    }
    notifyText(serializeDom(el));
    el.focus();
  }, [notifyText]);

  const clear = useCallback(() => {
    const el = editorRef.current;
    if (!el) return;
    knownFileChipIdsRef.current = new Set();
    plainRef.current = '';
    el.innerHTML = '';
    emptyRef.current = true;
    setIsEmpty(true);
    onTextChange?.('');
    onMentionQuery(null);
    el.focus();
  }, [onMentionQuery, onTextChange]);

  const setValue = useCallback((text: string) => {
    const el = editorRef.current;
    if (!el) return;
    plainRef.current = text;
    el.innerHTML = text ? buildHtmlFromPlain(text, crewList) + '\u200B' : '';
    emptyRef.current = text.trim().length === 0;
    setIsEmpty(emptyRef.current);
    onTextChange?.(text);
    onMentionQuery(null);
    mentionOriginRef.current = null;
  }, [crewList, onMentionQuery, onTextChange]);

  useImperativeHandle(ref, () => ({
    getValue: () => plainRef.current,
    clear,
    setValue,
    focus: () => editorRef.current?.focus(),
    insertMention,
    insertFileChip,
    insertFolderChip,
    insertKbChip,

    insertAttachmentChip,
  }), [clear, insertMention, insertFileChip, insertFolderChip, insertKbChip, insertAttachmentChip, setValue]);

  const handleInput = useCallback(() => {
    if (isComposing.current) return;
    if (pendingNotifyRef.current !== null) return;
    pendingNotifyRef.current = requestAnimationFrame(() => {
      pendingNotifyRef.current = null;
      syncFromDom();
    });
  }, [syncFromDom]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Backspace') {
      const sel = window.getSelection();
      if (sel && sel.isCollapsed && sel.rangeCount > 0) {
        const range = sel.getRangeAt(0);
        const node = range.startContainer;
        const prev = node.nodeType === Node.TEXT_NODE && range.startOffset === 0
          ? node.previousSibling
          : (node instanceof Element ? node.previousSibling : null);
        const chip = prev instanceof HTMLElement && prev.dataset.chip
          ? prev
          : (node instanceof HTMLElement ? node.closest('[data-chip]') : null);
        if (chip instanceof HTMLElement && range.startOffset === 0) {
          e.preventDefault();
          const attId = chip.dataset.attachmentId;
          chip.remove();
          if (attId) {
            knownFileChipIdsRef.current.delete(attId);
            onFileChipRemove?.(attId);
          }
          syncFromDom();
          return;
        }
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
    }
    if (e.key === 'Enter' && e.shiftKey) return;
    onKeyDown(e);
  }, [onKeyDown, onFileChipRemove, syncFromDom]);

  useEffect(() => {
    editorRef.current?.focus();
    return () => {
      if (pendingNotifyRef.current !== null) cancelAnimationFrame(pendingNotifyRef.current);
    };
  }, []);

  return (
    <Box
      sx={{
        flex: 1,
        position: 'relative',
        minHeight: 24,
        maxHeight: 140,
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
        onFocus={() => onFocusChange?.(true)}
        onBlur={() => onFocusChange?.(false)}
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
          lineHeight: 1.55,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          '&:empty:before': { content: '""' },
        }}
      />
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
