import type { ReactNode } from 'react';
import Box from '@mui/material/Box';
import PersonIcon from '@mui/icons-material/Person';
import { colors, alphaColor } from '../theme';
import { getCrewAccent } from '../styles/crew-theme';
import {
  MENTION_TOKEN_SPLIT_RE,
  parseCrewMentionToken,
  parseFileMentionToken,
  parseFolderMentionToken,
  parseKbMentionToken,
} from './mention-tokens';

/** Stable per-callsign accent (uses crew.color when provided). */
export function getWebCrewColor(callsign: string, color?: string): string {
  if (callsign.toLowerCase() === 'agentx' || callsign.toLowerCase() === 'agent-x') {
    return colors.accent.blue;
  }
  return getCrewAccent(color, callsign);
}

/** Shared visual language with MentionInput contenteditable chips. */

export function CrewDisplayChip({
  callsign,
  name,
  color: colorProp,
  onClick,
}: {
  callsign: string;
  name?: string;
  color?: string;
  onClick?: () => void;
}) {
  const color = getWebCrewColor(callsign, colorProp);
  const label = name?.trim() || callsign;
  return (
    <Box
      component="span"
      title={`@${callsign}${label !== callsign ? ` — ${label}` : ''}`}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      } : undefined}
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '3px',
        boxSizing: 'border-box',
        padding: '0 5px 0 0',
        margin: '0 1px',
        borderRadius: '999px',
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: '0.55rem',
        fontWeight: 600,
        color,
        background: alphaColor(color, '16'),
        border: `1px solid ${alphaColor(color, '28')}`,
        userSelect: 'none',
        whiteSpace: 'nowrap',
        lineHeight: 1.2,
        verticalAlign: 'middle',
        maxWidth: 200,
        overflow: 'hidden',
        cursor: onClick ? 'pointer' : 'default',
        '&:hover': onClick ? { borderColor: alphaColor(color, '55') } : undefined,
      }}
    >
      <Box
        component="span"
        sx={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 14,
          height: 14,
          borderRadius: '999px',
          lineHeight: 1,
          color: colors.bg.primary,
          background: color,
          flexShrink: 0,
        }}
      >
        <PersonIcon sx={{ fontSize: 9 }} />
      </Box>
      <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 160 }}>
        {label}
      </Box>
    </Box>
  );
}

export function FileDisplayChip({
  name,
  relativePath,
  onClick,
}: {
  name: string;
  relativePath?: string;
  onClick?: () => void;
}) {
  const rawName = name || 'file';
  const extRaw = rawName.includes('.') ? (rawName.split('.').pop() || '').toUpperCase() : '';
  const ext = (extRaw || 'FILE').slice(0, 6);
  const display = rawName.length > 24 ? `${rawName.slice(0, 24)}…` : rawName;
  const title = relativePath || rawName;
  return (
    <Box
      component="span"
      title={title}
      onClick={onClick}
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '3px',
        boxSizing: 'border-box',
        padding: '0 5px 0 0',
        margin: '0 1px',
        borderRadius: '999px',
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: '0.55rem',
        fontWeight: 600,
        color: colors.accent.cyan,
        background: alphaColor(colors.accent.cyan, '12'),
        border: `1px solid ${alphaColor(colors.accent.cyan, '28')}`,
        userSelect: 'none',
        whiteSpace: 'nowrap',
        lineHeight: 1.2,
        verticalAlign: 'middle',
        maxWidth: 200,
        overflow: 'hidden',
        cursor: onClick ? 'pointer' : 'default',
        '&:hover': onClick ? { borderColor: alphaColor(colors.accent.cyan, '50') } : undefined,
      }}
    >
      <Box
        component="span"
        sx={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          minWidth: 16,
          px: '3px',
          height: 14,
          borderRadius: '999px',
          fontSize: '0.42rem',
          fontWeight: 700,
          letterSpacing: '0.02em',
          lineHeight: 1,
          color: colors.bg.primary,
          background: colors.accent.cyan,
          flexShrink: 0,
        }}
      >
        {ext}
      </Box>
      <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 160 }}>
        {display}
      </Box>
    </Box>
  );
}

export function FolderDisplayChip({
  name,
  relativePath,
}: {
  name: string;
  relativePath?: string;
}) {
  const rawName = name || 'folder';
  const display = rawName.length > 24 ? `${rawName.slice(0, 24)}…` : rawName;
  const title = relativePath || rawName;
  return (
    <Box
      component="span"
      title={title}
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '3px',
        boxSizing: 'border-box',
        padding: '0 5px 0 0',
        margin: '0 1px',
        borderRadius: '999px',
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: '0.55rem',
        fontWeight: 600,
        color: colors.accent.cyan,
        background: alphaColor(colors.accent.cyan, '12'),
        border: `1px solid ${alphaColor(colors.accent.cyan, '28')}`,
        userSelect: 'none',
        whiteSpace: 'nowrap',
        lineHeight: 1.2,
        verticalAlign: 'middle',
        maxWidth: 200,
        overflow: 'hidden',
      }}
    >
      <Box
        component="span"
        sx={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 14,
          height: 14,
          borderRadius: '999px',
          lineHeight: 1,
          color: colors.bg.primary,
          background: colors.accent.cyan,
          flexShrink: 0,
          fontSize: '0.42rem',
          fontWeight: 800,
        }}
      >
        /
      </Box>
      <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 160 }}>
        {display}
      </Box>
    </Box>
  );
}

export function KbDisplayChip({
  name,
  sourceId,
  onClick,
}: {
  name: string;
  sourceId?: string;
  onClick?: () => void;
}) {
  const rawName = name || 'document';
  const extRaw = rawName.includes('.') ? (rawName.split('.').pop() || '').toUpperCase() : '';
  const ext = (extRaw || 'KB').slice(0, 6);
  const display = rawName.length > 24 ? `${rawName.slice(0, 24)}…` : rawName;
  const title = sourceId ? `Knowledge Base: ${rawName}` : rawName;
  return (
    <Box
      component="span"
      title={title}
      onClick={onClick}
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '3px',
        boxSizing: 'border-box',
        padding: '0 5px 0 0',
        margin: '0 1px',
        borderRadius: '999px',
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: '0.55rem',
        fontWeight: 600,
        color: colors.accent.purple,
        background: alphaColor(colors.accent.purple, '12'),
        border: `1px solid ${alphaColor(colors.accent.purple, '28')}`,
        userSelect: 'none',
        whiteSpace: 'nowrap',
        lineHeight: 1.2,
        verticalAlign: 'middle',
        maxWidth: 200,
        overflow: 'hidden',
        cursor: onClick ? 'pointer' : 'default',
        '&:hover': onClick ? { borderColor: alphaColor(colors.accent.purple, '50') } : undefined,
      }}
    >
      <Box
        component="span"
        sx={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          minWidth: 16,
          px: '3px',
          height: 14,
          borderRadius: '999px',
          fontSize: '0.42rem',
          fontWeight: 700,
          letterSpacing: '0.02em',
          lineHeight: 1,
          color: colors.bg.primary,
          background: colors.accent.purple,
          flexShrink: 0,
        }}
      >
        {ext}
      </Box>
      <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 160 }}>
        {display}
      </Box>
    </Box>
  );
}

/** Tokens for @file[…], @folder[…], @kb[…], @crew[…], and legacy colon / bare @callsign. */
export function renderComposerMentionTokens(
  text: string,
  opts?: {
    onFileClick?: (relativePath: string, fileName: string) => void;
    onCrewClick?: (callsign: string, name?: string) => void;
    crewIcons?: Record<string, string | undefined>;
    crewColors?: Record<string, string | undefined>;
  },
): ReactNode {
  const parts = text.split(MENTION_TOKEN_SPLIT_RE);
  if (parts.length === 1) return text;
  return parts.map((part, i) => {
    const file = parseFileMentionToken(part);
    if (file) {
      return (
        <FileDisplayChip
          key={i}
          name={file.name}
          relativePath={file.relativePath}
          onClick={opts?.onFileClick ? () => opts.onFileClick!(file.relativePath, file.name) : undefined}
        />
      );
    }
    const folder = parseFolderMentionToken(part);
    if (folder) {
      return (
        <FolderDisplayChip
          key={i}
          name={folder.name}
          relativePath={folder.relativePath}
        />
      );
    }
    const kbTok = parseKbMentionToken(part);
    if (kbTok) {
      return (
        <KbDisplayChip
          key={i}
          name={kbTok.name}
          sourceId={kbTok.sourceId}
        />
      );
    }
    const crewTok = parseCrewMentionToken(part);
    if (crewTok) {
      const key = crewTok.callsign.toLowerCase();
      return (
        <CrewDisplayChip
          key={i}
          callsign={crewTok.callsign}
          name={crewTok.name}
          color={opts?.crewColors?.[key]}
          onClick={opts?.onCrewClick
            ? () => opts.onCrewClick!(crewTok.callsign, crewTok.name)
            : undefined}
        />
      );
    }
    if (part.startsWith('@') && part.length > 1 && !part.includes(':') && !part.includes('[')) {
      const callsign = part.slice(1);
      const key = callsign.toLowerCase();
      return (
        <CrewDisplayChip
          key={i}
          callsign={callsign}
          color={opts?.crewColors?.[key]}
          onClick={opts?.onCrewClick ? () => opts.onCrewClick!(callsign) : undefined}
        />
      );
    }
    return <span key={i}>{part}</span>;
  });
}
