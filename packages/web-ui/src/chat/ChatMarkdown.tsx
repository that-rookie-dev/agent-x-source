import React, { Fragment, memo, useMemo } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark, oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { useColorScheme } from '@mui/material/styles';
import { colors, alphaColor } from '../theme';
import { StyledUl, StyledOl, StyledLi, StyledTableWrapper } from '../components/StructuredViews';
import { splitMarkdownSections, isPlainTextMarkdown, isLikelyPlainProse, PLAIN_TEXT_BUBBLE_MAX_WIDTH } from './markdown-normalize';
import { expandCollapsedTreeLine, isTreeDiagramContent } from './tree-diagram';
import { isHorizontalPipelineContent, isPipelineDiagramContent } from './pipeline-diagram';
import { FlowDiagramBlock } from './FlowDiagramBlock';
import { PipelineDiagramBlock } from './PipelineDiagramBlock';
import { CHART_FENCE_LANGS, isChartSpecContent, isMermaidSource } from '@agentx/shared/browser';
import { ChartBlock } from './ChartBlock';
import { CodeBlockChrome, CodeBlockBody, CODE_BLOCK_TOKENS, formatBlockTitle } from './code-block-chrome';
import { CitationChip } from './CitationChip';
import { prepareWebSourcedMarkdown } from './source-chip-utils';
import { openExternalUrl } from '../utils/open-external-url';
import { CrewDisplayChip, FileDisplayChip, FolderDisplayChip } from './ComposerChip';
import {
  MENTION_TOKEN_FIND_RE,
  parseCrewMentionToken,
  parseFileMentionToken,
  parseFolderMentionToken,
} from './mention-tokens';

const MARKDOWN_BASE_SX = {
  '& p': { m: 0, mb: 0.75, fontSize: '0.8125rem', lineHeight: 1.65, color: colors.text.secondary, fontFamily: "'Inter', sans-serif" },
  '& p:last-child': { mb: 0 },
  '& pre': { m: 0 },
  '& code': { fontFamily: "'JetBrains Mono', monospace", fontSize: '0.72rem' },
  '& strong': { color: colors.text.primary, fontWeight: 600 },
  '& em': { color: colors.text.tertiary, fontStyle: 'italic' },
  '& a': { color: colors.accent.blue, textDecoration: 'none', '&:hover': { textDecoration: 'underline' } },
};

export { getWebCrewColor } from './ComposerChip';

function flattenSyntaxTheme(base: typeof oneDark): typeof oneDark {
  return Object.fromEntries(
    Object.entries(base).map(([key, value]) => [
      key,
      {
        ...(value as Record<string, string>),
        background: 'transparent',
        textShadow: 'none',
        boxShadow: 'none',
      },
    ]),
  ) as typeof oneDark;
}

const CODE_BLOCK_THEMES = {
  dark: flattenSyntaxTheme(oneDark),
  light: flattenSyntaxTheme(oneLight),
} as const;

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
    background: `${alphaColor(colors.accent.blue, '40')}`,
    color: 'inherit',
  },
} as const;

function HierarchyDiagramBlock({ code }: { code: string }) {
  const lines = useMemo(
    () => expandCollapsedTreeLine(code.replace(/\r\n/g, '\n')).split('\n').filter((l) => l.trim().length > 0),
    [code],
  );

  const highlightLine = (line: string) => {
    const parts = line.split(/(├──|└──|│)/g);
    return parts.map((part, i) => (
      /^(?:├──|└──|│)$/.test(part)
        ? <Box key={i} component="span" sx={{ color: colors.accent.cyan, opacity: 0.9 }}>{part}</Box>
        : <Fragment key={i}>{part}</Fragment>
    ));
  };

  return (
    <CodeBlockChrome title="Hierarchy" copyText={lines.join('\n')}>
      <CodeBlockBody>
        <Box
          component="pre"
          sx={{
            m: 0, p: 0, overflowX: 'auto',
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: CODE_BLOCK_TOKENS.monoFontSize,
            lineHeight: CODE_BLOCK_TOKENS.treeLineHeight,
            color: colors.text.secondary,
            whiteSpace: 'pre',
            tabSize: 2,
          }}
        >
          {lines.map((line, i) => (
            <Fragment key={i}>
              {i > 0 ? '\n' : null}
              {highlightLine(line)}
            </Fragment>
          ))}
        </Box>
      </CodeBlockBody>
    </CodeBlockChrome>
  );
}

function CodeBlockWithCopy({ code, language }: { code: string; language?: string }) {
  const lang = (language || 'text').toLowerCase();
  if (
    CHART_FENCE_LANGS.has(lang)
    || lang === 'mermaid'
    || isChartSpecContent(code)
    || isMermaidSource(code)
  ) {
    return <ChartBlock code={code} language={lang} />;
  }
  if (lang === 'tree' || lang === 'diagram' || (isTreeDiagramContent(code) && !isPipelineDiagramContent(code) && !isHorizontalPipelineContent(code))) {
    return <HierarchyDiagramBlock code={code} />;
  }
  if (lang === 'flow' || isPipelineDiagramContent(code)) {
    return <FlowDiagramBlock code={code} />;
  }
  if (lang === 'pipeline' || isHorizontalPipelineContent(code)) {
    return <PipelineDiagramBlock code={code} />;
  }
  return <SyntaxCodeBlock code={code} language={lang} />;
}

function SyntaxCodeBlock({ code, language }: { code: string; language: string }) {
  const { mode, systemMode } = useColorScheme();
  const resolved = (mode === 'system' ? systemMode : mode) ?? 'dark';
  const syntaxTheme = resolved === 'light' ? CODE_BLOCK_THEMES.light : CODE_BLOCK_THEMES.dark;
  const displayLang = language === 'bash' || language === 'sh' || language === 'shell' ? 'bash' : language;
  return (
    <CodeBlockChrome title={formatBlockTitle(displayLang)} copyText={code}>
      <CodeBlockBody>
        <Box sx={CODE_BLOCK_SX}>
          <SyntaxHighlighter
            style={syntaxTheme}
            language={displayLang}
            PreTag="div"
            wrapLongLines
            customStyle={{
              borderRadius: 0,
              fontSize: CODE_BLOCK_TOKENS.monoFontSize,
              margin: 0,
              padding: 0,
              background: 'transparent',
              lineHeight: CODE_BLOCK_TOKENS.monoLineHeight,
            }}
            codeTagProps={{ style: { background: 'transparent', textShadow: 'none' } }}
          >
            {code}
          </SyntaxHighlighter>
        </Box>
      </CodeBlockBody>
    </CodeBlockChrome>
  );
}

function SimpleCodeBlock({ code, language }: { code: string; language?: string }) {
  return (
    <Box sx={{
      mb: 0.75,
      border: `1px solid ${colors.border.subtle}`,
      borderRadius: 1,
      overflow: 'hidden',
      bgcolor: colors.bg.tertiary,
    }}>
      {language && language !== 'text' && (
        <Box sx={{
          px: 1, py: 0.5,
          borderBottom: `1px solid ${colors.border.subtle}`,
          fontSize: '0.62rem',
          fontFamily: "'JetBrains Mono', monospace",
          color: colors.text.dim,
          textTransform: 'uppercase',
        }}>
          {language}
        </Box>
      )}
      <Box sx={{ p: 1, overflowX: 'auto' }}>
        <Box component="pre" sx={{
          m: 0,
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: '0.72rem',
          lineHeight: 1.55,
          color: colors.text.secondary,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}>
          {code}
        </Box>
      </Box>
    </Box>
  );
}

function SimpleInlineCode({ children, ...props }: { children?: React.ReactNode; [key: string]: unknown }) {
  return (
    <Box
      component="code"
      sx={{
        bgcolor: colors.bg.tertiary,
        color: colors.accent.cyan,
        px: 0.6, py: 0.1,
        borderRadius: '4px',
        fontSize: '0.72rem',
        border: `1px solid ${colors.border.subtle}`,
        boxShadow: 'none',
        textShadow: 'none',
      }}
      {...props}
    >
      {children}
    </Box>
  );
}

function createMarkdownComponents(isFirstSection: boolean, simpleCode?: boolean) {
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
          bgcolor: `${alphaColor(colors.accent.blue, '08')}`,
        }}>
          <Box sx={{ '& p': { mb: 0.5, fontSize: '0.78rem', color: colors.text.secondary } }}>{children}</Box>
        </Box>
      );
    },
    code({ className, children, ...props }: { className?: string; children?: React.ReactNode }) {
      const match = /language-(\w+)/.exec(className ?? '');
      const code = String(children).replace(/\n$/, '');
      if (simpleCode) {
        if (match || code.includes('\n')) return <SimpleCodeBlock code={code} language={match?.[1]} />;
        return <SimpleInlineCode {...props}>{children}</SimpleInlineCode>;
      }
      if (match) return <CodeBlockWithCopy code={code} language={match[1]} />;
      if (code.includes('\n')) {
        if (isChartSpecContent(code) || isMermaidSource(code)) return <ChartBlock code={code} />;
        if (isPipelineDiagramContent(code)) return <FlowDiagramBlock code={code} />;
        if (isHorizontalPipelineContent(code)) return <PipelineDiagramBlock code={code} />;
        if (isTreeDiagramContent(code)) return <HierarchyDiagramBlock code={code} />;
        return <SyntaxCodeBlock code={code} language="text" />;
      }
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
    li({ children }: { children?: React.ReactNode }) {
      return (
        <StyledLi>
          <Box sx={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'baseline',
            gap: 0.35,
            rowGap: 0.25,
            '& > p': { display: 'inline', m: 0, mb: 0 },
          }}>
            {children}
          </Box>
        </StyledLi>
      );
    },
    a({ href, children }: { href?: string; children?: React.ReactNode }) {
      if (href?.startsWith('http')) {
        return <CitationChip href={href} label={String(children ?? '')} />;
      }
      return (
        <Box
          component="a"
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e: React.MouseEvent) => {
            if (!href) return;
            e.preventDefault();
            e.stopPropagation();
            openExternalUrl(href);
          }}
          sx={{ color: colors.accent.blue, textDecoration: 'none', cursor: 'pointer', '&:hover': { textDecoration: 'underline' } }}
        >
          {children}
        </Box>
      );
    },
    sup({ children }: { children?: React.ReactNode }) {
      return (
        <Box
          component="sup"
          sx={{
            fontSize: '0.62rem',
            fontFamily: "'JetBrains Mono', monospace",
            color: colors.accent.cyan,
            fontWeight: 700,
          }}
        >
          {children}
        </Box>
      );
    },
  };
}

export const MarkdownSection = memo(function MarkdownSection({
  content,
  index,
  compact,
  webSources,
  simpleCode,
  live = false,
}: {
  content: string;
  index: number;
  compact?: boolean;
  webSources?: string[];
  simpleCode?: boolean;
  /** True only for the active trailing conversational beat while streaming. */
  live?: boolean;
}) {
  const prepared = useMemo(
    () => prepareWebSourcedMarkdown(content, webSources ?? []),
    [content, webSources],
  );
  const components = useMemo(() => createMarkdownComponents(index === 0, simpleCode), [index, simpleCode]);

  // Conversational beats: pulse-rail stream — no heavy card fill.
  if (compact) {
    return (
      <Box
        sx={{
          position: 'relative',
          display: 'inline-block',
          width: 'fit-content',
          maxWidth: PLAIN_TEXT_BUBBLE_MAX_WIDTH,
          verticalAlign: 'top',
          wordBreak: 'break-word',
          pl: 1.35,
          pr: 0.75,
          py: 0.55,
          borderRadius: '0 6px 6px 0',
          bgcolor: live ? alphaColor(colors.accent.cyan, '0a') : 'transparent',
          animation: 'agentx-beat-in 0.18s ease-out',
          willChange: live ? 'opacity' : 'auto',
          ...MARKDOWN_BASE_SX,
          '& p': {
            ...MARKDOWN_BASE_SX['& p'],
            mb: 0.4,
            fontSize: '0.78rem',
            lineHeight: 1.55,
            color: live ? colors.text.secondary : colors.text.tertiary,
          },
          '&::before': {
            content: '""',
            position: 'absolute',
            left: 0,
            top: 5,
            bottom: 5,
            width: 2,
            borderRadius: 1,
            bgcolor: live ? colors.accent.cyan : alphaColor(colors.accent.cyan, '35'),
            animation: live ? 'agentx-rail-breathe 1.6s ease-in-out infinite' : 'none',
          },
        }}
      >
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>{prepared}</ReactMarkdown>
      </Box>
    );
  }

  // Final / structured report: keep a light surface, tighter than before.
  return (
    <Box sx={{
      bgcolor: alphaColor(colors.bg.elevated, '85'),
      border: `1px solid ${colors.border.subtle}`,
      borderRadius: 1.25,
      px: 1.75,
      py: 1.25,
      ...MARKDOWN_BASE_SX,
    }}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>{prepared}</ReactMarkdown>
    </Box>
  );
});

/**
 * User bubble renderer — preserves whitespace and supports common markdown
 * (lists via `-`, bold via `*`/`**`, italics via `_`).
 * Renders @crew[…], @file[…], and @folder[…] tokens as the same chips used in the composer.
 *
 * Tokens are extracted before markdown so paths like `@file[_test.html]` are not
 * mangled by emphasis / autolink rules. Bracket delimiters keep trailing `?` etc. outside.
 */
export function UserMentionText({
  content,
  onFileClick,
  onCrewClick,
  crewColors,
}: {
  content: string;
  onFileClick?: (relativePath: string, fileName: string) => void;
  onCrewClick?: (callsign: string, name?: string) => void;
  /** callsign(lower) → accent hex from roster / hub */
  crewColors?: Record<string, string | undefined>;
}) {
  const segments = useMemo(() => {
    const re = new RegExp(MENTION_TOKEN_FIND_RE.source, 'g');
    const out: Array<{ kind: 'text' | 'crew' | 'file' | 'folder'; value: string; callsign?: string; name?: string }> = [];
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) {
      if (m.index > last) out.push({ kind: 'text', value: content.slice(last, m.index) });
      const tok = m[0]!;
      const file = parseFileMentionToken(tok);
      if (file) {
        out.push({ kind: 'file', value: file.relativePath });
      } else {
        const folder = parseFolderMentionToken(tok);
        if (folder) {
          out.push({ kind: 'folder', value: folder.relativePath });
        } else {
          const crew = parseCrewMentionToken(tok);
          if (crew) {
            out.push({ kind: 'crew', value: tok, callsign: crew.callsign, name: crew.name });
          } else if (tok.startsWith('@') && tok.length > 1) {
            out.push({ kind: 'crew', value: tok, callsign: tok.slice(1) });
          } else {
            out.push({ kind: 'text', value: tok });
          }
        }
      }
      last = m.index + tok.length;
    }
    if (last < content.length) out.push({ kind: 'text', value: content.slice(last) });
    if (out.length === 0) out.push({ kind: 'text', value: content });
    return out;
  }, [content]);

  const mdComponents = useMemo(() => ({
    p: ({ children }: { children?: React.ReactNode }) => (
      <Typography component="span" sx={{ fontSize: '0.8rem', color: colors.text.primary, lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
        {children}
      </Typography>
    ),
    li: ({ children }: { children?: React.ReactNode }) => (
      <Box component="li" sx={{ fontSize: '0.8rem', color: colors.text.primary, lineHeight: 1.55, mb: 0.25 }}>
        {children}
      </Box>
    ),
    ul: ({ children }: { children?: React.ReactNode }) => (
      <Box component="ul" sx={{ m: 0, pl: 2.25, mb: 0.75, display: 'inline-block', verticalAlign: 'top' }}>{children}</Box>
    ),
    ol: ({ children }: { children?: React.ReactNode }) => (
      <Box component="ol" sx={{ m: 0, pl: 2.25, mb: 0.75, display: 'inline-block', verticalAlign: 'top' }}>{children}</Box>
    ),
    strong: ({ children }: { children?: React.ReactNode }) => (
      <Box component="strong" sx={{ fontWeight: 700, color: colors.text.primary }}>{children}</Box>
    ),
    em: ({ children }: { children?: React.ReactNode }) => (
      <Box component="em" sx={{ fontStyle: 'italic', color: colors.text.secondary }}>{children}</Box>
    ),
    code: ({ children }: { children?: React.ReactNode }) => (
      <Box component="code" sx={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.72rem', px: 0.4, py: 0.1, bgcolor: alphaColor(colors.bg.primary, 0.55), borderRadius: 0.5 }}>
        {children}
      </Box>
    ),
    a: ({ href, children }: { href?: string; children?: React.ReactNode }) => (
      <Box
        component="a"
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e: React.MouseEvent) => {
          if (!href) return;
          e.preventDefault();
          e.stopPropagation();
          openExternalUrl(href);
        }}
        sx={{ color: colors.accent.blue, textDecoration: 'none', cursor: 'pointer', '&:hover': { textDecoration: 'underline' } }}
      >
        {children}
      </Box>
    ),
  }), []);

  return (
    <Box sx={{ fontSize: '0.8rem', color: colors.text.primary, lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
      {segments.map((seg, i) => {
        if (seg.kind === 'crew') {
          const callsign = seg.callsign || seg.value;
          const key = callsign.toLowerCase();
          return (
            <CrewDisplayChip
              key={i}
              callsign={callsign}
              name={seg.name}
              color={crewColors?.[key]}
              onClick={onCrewClick ? () => onCrewClick(callsign, seg.name) : undefined}
            />
          );
        }
        if (seg.kind === 'file') {
          const fileName = seg.value.split(/[/\\]/).pop() || seg.value;
          return (
            <FileDisplayChip
              key={i}
              name={fileName}
              relativePath={seg.value}
              onClick={onFileClick ? () => onFileClick(seg.value, fileName) : undefined}
            />
          );
        }
        if (seg.kind === 'folder') {
          const folderName = seg.value === '.'
            ? 'workspace'
            : (seg.value.split(/[/\\]/).pop() || seg.value);
          return (
            <FolderDisplayChip
              key={i}
              name={folderName}
              relativePath={seg.value}
            />
          );
        }
        if (!seg.value) return null;
        // Pure whitespace / plain text — skip markdown overhead when no md markers.
        if (!/[*_`#\-\[]/.test(seg.value) && !seg.value.includes('\n\n')) {
          return <Fragment key={i}>{seg.value}</Fragment>;
        }
        return (
          <Box key={i} component="span" sx={{ display: 'inline', '& p': { display: 'inline', m: 0 }, '& > :last-child': { mb: 0 } }}>
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents as never}>
              {seg.value}
            </ReactMarkdown>
          </Box>
        );
      })}
    </Box>
  );
}

export const CrewAwareMarkdown = memo(function CrewAwareMarkdown({
  content,
  webSources,
}: {
  content: string;
  webSources?: string[];
}) {
  const sections = useMemo(() => splitMarkdownSections(content), [content]);
  const compact = useMemo(() => isPlainTextMarkdown(content), [content]);

  if (sections.length === 0) return null;

  if (sections.length === 1) {
    return (
      <MarkdownSection content={sections[0]!} index={0} compact={compact} webSources={webSources} />
    );
  }

  // Multi-section final reports stay as surfaces; plain multi-beats stream as a rail.
  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        gap: compact ? 0.65 : 1.1,
        ...(compact ? {
          position: 'relative',
          '&::before': {
            content: '""',
            position: 'absolute',
            left: 0,
            top: 10,
            bottom: 10,
            width: 2,
            borderRadius: 1,
            bgcolor: alphaColor(colors.accent.cyan, '18'),
            pointerEvents: 'none',
          },
        } : {}),
      }}
    >
      {sections.map((section, i) => (
        <MarkdownSection
          key={i}
          content={section}
          index={i}
          compact={compact}
          webSources={webSources}
        />
      ))}
    </Box>
  );
});

export const StreamingMarkdown = memo(function StreamingMarkdown({
  content,
  webSources,
  live = false,
}: {
  content: string;
  webSources?: string[];
  /** Active trailing beat — enables the breathing rail without extra JS. */
  live?: boolean;
}) {
  if (!content) return null;
  // Hot path: avoid full markdown normalize on every stream flush.
  const compact = isLikelyPlainProse(content);
  return (
    <MarkdownSection
      content={content}
      index={0}
      compact={compact}
      live={live && compact}
      simpleCode
      webSources={webSources}
    />
  );
});
