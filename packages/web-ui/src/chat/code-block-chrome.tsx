import { useState, type ReactNode } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import type { SxProps, Theme } from '@mui/material/styles';
import { colors } from '../theme';
import { copyToClipboard } from '../utils/clipboard';

const MONO = "'JetBrains Mono', monospace";

/** Shared body typography + spacing for all code-block variants. */
export const CODE_BLOCK_TOKENS = {
  bodyBg: colors.bg.primary,
  bodyPx: 1.25,
  bodyPy: 1,
  monoFontSize: '0.68rem',
  monoLineHeight: 1.45,
  treeLineHeight: 1.32,
  sansFontSize: '0.68rem',
  sansLineHeight: 1.35,
  timingFontSize: '0.56rem',
} as const;

export function CodeBlockBody({ children, sx }: { children: ReactNode; sx?: SxProps<Theme> }) {
  return (
    <Box sx={{
      bgcolor: CODE_BLOCK_TOKENS.bodyBg,
      px: CODE_BLOCK_TOKENS.bodyPx,
      py: CODE_BLOCK_TOKENS.bodyPy,
      ...sx,
    }}>
      {children}
    </Box>
  );
}

const LANG_LABELS: Record<string, string> = {
  bash: 'Bash',
  sh: 'Bash',
  shell: 'Bash',
  zsh: 'Zsh',
  javascript: 'JavaScript',
  js: 'JavaScript',
  typescript: 'TypeScript',
  ts: 'TypeScript',
  tsx: 'TypeScript React',
  jsx: 'JavaScript React',
  python: 'Python',
  py: 'Python',
  json: 'JSON',
  yaml: 'YAML',
  yml: 'YAML',
  markdown: 'Markdown',
  md: 'Markdown',
  html: 'HTML',
  css: 'CSS',
  sql: 'SQL',
  rust: 'Rust',
  go: 'Go',
  java: 'Java',
  kotlin: 'Kotlin',
  swift: 'Swift',
  ruby: 'Ruby',
  php: 'PHP',
  csharp: 'C#',
  cs: 'C#',
  cpp: 'C++',
  c: 'C',
  text: 'Text',
  plaintext: 'Text',
  txt: 'Text',
  flow: 'Flow',
  pipeline: 'Pipeline',
  tree: 'Hierarchy',
  diagram: 'Hierarchy',
  chart: 'Chart',
  graph: 'Chart',
  viz: 'Chart',
  mermaid: 'Diagram',
};

/** Human-readable label for code fence language or custom block type. */
export function formatBlockTitle(language: string): string {
  const key = language.trim().toLowerCase();
  if (LANG_LABELS[key]) return LANG_LABELS[key];
  if (!key) return 'Text';
  return key
    .split(/[-_]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export function CodeBlockChrome({
  title,
  copyText,
  children,
}: {
  title: string;
  copyText: string;
  children: ReactNode;
}) {
  const [copied, setCopied] = useState(false);

  return (
    <Box sx={{
      my: 0.75,
      border: `1px solid ${colors.border.subtle}`,
      borderRadius: 1,
      overflow: 'hidden',
      bgcolor: colors.bg.secondary,
    }}>
      <Box sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        height: 24,
        minHeight: 24,
        px: 1,
        flexShrink: 0,
        borderBottom: `1px solid ${colors.border.subtle}`,
      }}>
        <Typography
          component="span"
          sx={{
            fontSize: '0.54rem',
            fontWeight: 600,
            lineHeight: '24px',
            color: colors.text.secondary,
            fontFamily: MONO,
            letterSpacing: '0.03em',
          }}
        >
          {title}
        </Typography>
        <Box
          component="button"
          onClick={() => {
            void copyToClipboard(copyText);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
          sx={{
            bgcolor: 'transparent',
            border: `1px solid ${colors.border.subtle}`,
            borderRadius: '4px',
            cursor: 'pointer',
            color: copied ? colors.accent.green : colors.text.dim,
            fontSize: '0.52rem',
            fontFamily: MONO,
            lineHeight: 1,
            height: 16,
            px: 0.55,
            py: 0,
            m: 0,
            display: 'inline-flex',
            alignItems: 'center',
            '&:hover': { borderColor: colors.border.strong, color: colors.text.secondary },
          }}
        >
          {copied ? 'Copied' : 'Copy'}
        </Box>
      </Box>
      {children}
    </Box>
  );
}
