import React, { Fragment, useMemo, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { colors } from '../theme';
import { StyledTableWrapper, StyledUl, StyledOl, StyledLi } from '../components/StructuredViews';
import { splitMarkdownSections } from './markdown-normalize';

const MARKDOWN_BASE_SX = {
  '& p': { m: 0, mb: 0.75, fontSize: '0.8125rem', lineHeight: 1.65, color: colors.text.secondary, fontFamily: "'Inter', sans-serif" },
  '& p:last-child': { mb: 0 },
  '& pre': { m: 0 },
  '& code': { fontFamily: "'JetBrains Mono', monospace", fontSize: '0.72rem' },
  '& strong': { color: colors.text.primary, fontWeight: 600 },
  '& em': { color: colors.text.tertiary, fontStyle: 'italic' },
  '& a': { color: colors.accent.blue, textDecoration: 'none', '&:hover': { textDecoration: 'underline' } },
};

const CREW_PALETTE = ['#4FC3F7', '#81C784', '#FFB74D', '#F06292', '#BA68C8', '#4DB6AC', '#FF8A65', '#A1887F'];

export function getWebCrewColor(callsign: string): string {
  let hash = 0;
  for (let i = 0; i < callsign.length; i++) hash = callsign.charCodeAt(i) + ((hash << 5) - hash);
  return CREW_PALETTE[Math.abs(hash) % CREW_PALETTE.length]!;
}

const CODE_BLOCK_THEME = Object.fromEntries(
  Object.entries(oneDark).map(([key, value]) => [
    key,
    {
      ...(value as Record<string, string>),
      background: 'transparent',
      textShadow: 'none',
      boxShadow: 'none',
    },
  ]),
) as typeof oneDark;

const CODE_BLOCK_SX = {
  '& .token': {
    background: 'transparent !important',
    textShadow: 'none !important',
    boxShadow: 'none !important',
  },
  '& span[class*="token"]': {
    background: 'transparent !important',
    textShadow: 'none !important',
  },
  '& code': {
    background: 'transparent !important',
    textShadow: 'none !important',
  },
  '& ::selection': {
    background: `${colors.accent.blue}40`,
    color: 'inherit',
  },
} as const;

function CodeBlockWithCopy({ code, language }: { code: string; language?: string }) {
  const [copied, setCopied] = useState(false);
  const lang = (language || 'text').toLowerCase();
  const displayLang = lang === 'bash' || lang === 'sh' || lang === 'shell' ? 'bash' : lang;
  return (
    <Box sx={{ my: 1.25, border: `1px solid ${colors.border.default}`, borderRadius: 1.25, overflow: 'hidden' }}>
      <Box sx={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        px: 1.25, py: 0.5, bgcolor: colors.bg.secondary, borderBottom: `1px solid ${colors.border.default}`,
      }}>
        <Typography sx={{ fontSize: '0.55rem', fontWeight: 700, color: colors.text.secondary, fontFamily: "'JetBrains Mono', monospace", letterSpacing: '0.04em', textTransform: 'uppercase' }}>
          {displayLang}
        </Typography>
        <Box
          component="button"
          onClick={() => { navigator.clipboard.writeText(code).catch(() => {}); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
          sx={{
            bgcolor: 'transparent', border: `1px solid ${colors.border.subtle}`, borderRadius: '6px',
            cursor: 'pointer', px: 0.85, py: 0.2, color: copied ? colors.accent.green : colors.text.dim, fontSize: '0.52rem',
            fontFamily: "'JetBrains Mono', monospace", transition: 'color 0.15s',
            '&:hover': { borderColor: colors.border.strong, color: colors.text.secondary },
          }}
        >
          {copied ? '✓ Copied' : 'Copy'}
        </Box>
      </Box>
      <Box sx={CODE_BLOCK_SX}>
        <SyntaxHighlighter
          style={CODE_BLOCK_THEME}
          language={displayLang}
          PreTag="div"
          wrapLongLines
          customStyle={{
            borderRadius: 0,
            fontSize: '0.72rem',
            margin: 0,
            padding: '12px 14px',
            background: colors.bg.primary,
            lineHeight: 1.55,
          }}
          codeTagProps={{ style: { background: 'transparent', textShadow: 'none' } }}
        >
          {code}
        </SyntaxHighlighter>
      </Box>
    </Box>
  );
}

function createMarkdownComponents(isFirstSection: boolean) {
  return {
    h1({ children }: { children?: React.ReactNode }) {
      return (
        <Typography component="h1" sx={{
          fontSize: '0.85rem', fontWeight: 700, color: colors.text.primary, mt: isFirstSection ? 0 : 0.5, mb: 1,
          fontFamily: "'Inter', sans-serif", letterSpacing: '-0.01em',
        }}>
          {children}
        </Typography>
      );
    },
    h2({ children }: { children?: React.ReactNode }) {
      return (
        <Box sx={{
          display: 'flex', alignItems: 'center', gap: 0.75,
          mt: isFirstSection ? 0 : 0.25, mb: 1.25, pb: 0.75,
          borderBottom: `1px solid ${colors.border.default}`,
        }}>
          <Typography component="h2" sx={{
            fontSize: '0.72rem', fontWeight: 700, color: colors.text.primary,
            fontFamily: "'Inter', sans-serif", letterSpacing: '0.04em', textTransform: 'uppercase', lineHeight: 1.3,
          }}>
            {children}
          </Typography>
        </Box>
      );
    },
    h3({ children }: { children?: React.ReactNode }) {
      return (
        <Typography component="h3" sx={{
          fontSize: '0.75rem', fontWeight: 600, color: colors.text.primary,
          mt: 1, mb: 0.5, fontFamily: "'Inter', sans-serif",
        }}>
          {children}
        </Typography>
      );
    },
    h4({ children }: { children?: React.ReactNode }) {
      return (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mt: 1.25, mb: 0.6 }}>
          <Box sx={{ width: 3, height: 14, borderRadius: 1, bgcolor: colors.accent.blue, flexShrink: 0 }} />
          <Typography component="h4" sx={{
            fontSize: '0.72rem', fontWeight: 600, color: colors.accent.blue,
            fontFamily: "'Inter', sans-serif", letterSpacing: '0.01em',
          }}>
            {children}
          </Typography>
        </Box>
      );
    },
    p({ children }: { children?: React.ReactNode }) {
      return <Typography component="p" sx={{ m: 0, mb: 0.75, fontSize: '0.8125rem', lineHeight: 1.65, color: colors.text.secondary, fontFamily: "'Inter', sans-serif", '&:last-child': { mb: 0 } }}>{children}</Typography>;
    },
    hr() {
      return <Box sx={{ my: 1.25, height: '1px', bgcolor: colors.border.subtle }} />;
    },
    blockquote({ children }: { children?: React.ReactNode }) {
      return (
        <Box sx={{
          my: 1, px: 1.5, py: 1, borderRadius: 1,
          borderLeft: `3px solid ${colors.accent.blue}`,
          bgcolor: `${colors.accent.blue}08`,
        }}>
          <Box sx={{ '& p': { mb: 0.5, fontSize: '0.78rem', color: colors.text.secondary } }}>{children}</Box>
        </Box>
      );
    },
    code({ className, children, ...props }: { className?: string; children?: React.ReactNode }) {
      const match = /language-(\w+)/.exec(className ?? '');
      const code = String(children).replace(/\n$/, '');
      if (match) return <CodeBlockWithCopy code={code} language={match[1]} />;
      return (
        <Box
          component="code"
          sx={{
            bgcolor: colors.bg.tertiary, color: colors.accent.cyan,
            px: 0.6, py: 0.1, borderRadius: '4px', fontSize: '0.72rem',
            border: `1px solid ${colors.border.subtle}`,
            boxShadow: 'none',
            textShadow: 'none',
          }}
          {...props}
        >
          {children}
        </Box>
      );
    },
    pre({ children }: { children?: React.ReactNode }) { return <>{children}</>; },
    table({ children }: { children?: React.ReactNode }) { return <StyledTableWrapper>{children}</StyledTableWrapper>; },
    thead({ children }: { children?: React.ReactNode }) { return <thead>{children}</thead>; },
    tbody({ children }: { children?: React.ReactNode }) { return <tbody>{children}</tbody>; },
    tr({ children }: { children?: React.ReactNode }) { return <tr>{children}</tr>; },
    th({ children }: { children?: React.ReactNode }) { return <th>{children}</th>; },
    td({ children }: { children?: React.ReactNode }) { return <td>{children}</td>; },
    ul({ children }: { children?: React.ReactNode }) { return <StyledUl>{children}</StyledUl>; },
    ol({ children }: { children?: React.ReactNode }) { return <StyledOl>{children}</StyledOl>; },
    li({ children }: { children?: React.ReactNode }) { return <StyledLi>{children}</StyledLi>; },
  };
}

function MarkdownSection({ content, index }: { content: string; index: number }) {
  const components = useMemo(() => createMarkdownComponents(index === 0), [index]);
  return (
    <Box sx={{
      bgcolor: colors.bg.elevated,
      border: `1px solid ${colors.border.subtle}`,
      borderRadius: 1.5,
      px: 2,
      py: 1.5,
      ...MARKDOWN_BASE_SX,
    }}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>{content}</ReactMarkdown>
    </Box>
  );
}

export function UserMentionText({ content }: { content: string }) {
  const parts = content.split(/(@\w+)/g);
  return (
    <Typography sx={{ fontSize: '0.8rem', color: colors.text.primary, lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
      {parts.map((part, i) => {
        if (part.startsWith('@') && part.length > 1) {
          const callsign = part.slice(1);
          const color = callsign === 'agentx' ? colors.accent.blue : getWebCrewColor(callsign);
          return <Box key={i} component="span" sx={{ color, fontWeight: 600 }}>{part}</Box>;
        }
        return <Fragment key={i}>{part}</Fragment>;
      })}
    </Typography>
  );
}

export function CrewAwareMarkdown({ content }: { content: string }) {
  const sections = useMemo(() => splitMarkdownSections(content), [content]);

  if (sections.length === 0) return null;

  if (sections.length === 1) {
    return (
      <MarkdownSection content={sections[0]!} index={0} />
    );
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
      {sections.map((section, i) => (
        <MarkdownSection
          key={i}
          content={section}
          index={i}
        />
      ))}
    </Box>
  );
}
