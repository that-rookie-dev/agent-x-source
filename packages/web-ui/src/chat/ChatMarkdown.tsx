import React, { Fragment, memo, useMemo } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { colors } from '../theme';
import { StyledTableWrapper, StyledUl, StyledOl, StyledLi } from '../components/StructuredViews';
import { splitMarkdownSections, isPlainTextMarkdown, PLAIN_TEXT_BUBBLE_MAX_WIDTH } from './markdown-normalize';
import { expandCollapsedTreeLine, isTreeDiagramContent } from './tree-diagram';
import { isHorizontalPipelineContent, isPipelineDiagramContent } from './pipeline-diagram';
import { FlowDiagramBlock } from './FlowDiagramBlock';
import { PipelineDiagramBlock } from './PipelineDiagramBlock';
import { CodeBlockChrome, CodeBlockBody, CODE_BLOCK_TOKENS, formatBlockTitle } from './code-block-chrome';
import { CitationChip } from './CitationChip';
import { prepareWebSourcedMarkdown } from './source-chip-utils';

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
  const displayLang = language === 'bash' || language === 'sh' || language === 'shell' ? 'bash' : language;
  return (
    <CodeBlockChrome title={formatBlockTitle(displayLang)} copyText={code}>
      <CodeBlockBody>
        <Box sx={CODE_BLOCK_SX}>
          <SyntaxHighlighter
            style={CODE_BLOCK_THEME}
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
      if (code.includes('\n')) {
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
          sx={{ color: colors.accent.blue, textDecoration: 'none', '&:hover': { textDecoration: 'underline' } }}
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

function MarkdownSection({ content, index, compact, webSources }: { content: string; index: number; compact?: boolean; webSources?: string[] }) {
  const prepared = useMemo(
    () => prepareWebSourcedMarkdown(content, webSources ?? []),
    [content, webSources],
  );
  const components = useMemo(() => createMarkdownComponents(index === 0), [index]);
  return (
    <Box sx={{
      bgcolor: colors.bg.elevated,
      border: `1px solid ${colors.border.subtle}`,
      borderRadius: 1.5,
      px: 2,
      py: 1.5,
      ...(compact ? {
        display: 'inline-block',
        width: 'fit-content',
        maxWidth: PLAIN_TEXT_BUBBLE_MAX_WIDTH,
        verticalAlign: 'top',
        wordBreak: 'break-word',
      } : {}),
      ...MARKDOWN_BASE_SX,
    }}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>{prepared}</ReactMarkdown>
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

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
      {sections.map((section, i) => (
        <MarkdownSection
          key={i}
          content={section}
          index={i}
          webSources={webSources}
        />
      ))}
    </Box>
  );
});
