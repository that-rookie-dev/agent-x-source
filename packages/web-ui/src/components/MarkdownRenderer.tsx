import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { palette } from '../theme';
import type { Components } from 'react-markdown';

interface MarkdownRendererProps {
  content: string;
  isStreaming?: boolean;
}

const customStyle = {
  ...oneDark,
  'pre[class*="language-"]': {
    ...oneDark['pre[class*="language-"]'],
    background: '#111111',
    margin: 0,
    padding: '12px 16px',
    fontSize: '0.78rem',
    borderRadius: '6px',
  },
  'code[class*="language-"]': {
    ...oneDark['code[class*="language-"]'],
    fontSize: '0.78rem',
    fontFamily: "'JetBrains Mono', monospace",
  },
};

const components: Components = {
  p({ children }) {
    return (
      <Typography variant="body1" sx={{ color: palette.text.primary, mb: 1.5, lineHeight: 1.7, '&:last-child': { mb: 0 } }}>
        {children}
      </Typography>
    );
  },
  h1({ children }) {
    return <Typography variant="h6" sx={{ color: palette.text.primary, mt: 2, mb: 1, fontWeight: 700 }}>{children}</Typography>;
  },
  h2({ children }) {
    return <Typography variant="h6" sx={{ color: palette.text.primary, mt: 2, mb: 1, fontWeight: 600, fontSize: '0.82rem' }}>{children}</Typography>;
  },
  h3({ children }) {
    return <Typography variant="body1" sx={{ color: palette.text.primary, mt: 1.5, mb: 0.5, fontWeight: 600 }}>{children}</Typography>;
  },
  ul({ children }) {
    return <Box component="ul" sx={{ pl: 2.5, mb: 1.5, '& li': { color: palette.text.primary, fontSize: '0.875rem', mb: 0.5 } }}>{children}</Box>;
  },
  ol({ children }) {
    return <Box component="ol" sx={{ pl: 2.5, mb: 1.5, '& li': { color: palette.text.primary, fontSize: '0.875rem', mb: 0.5 } }}>{children}</Box>;
  },
  blockquote({ children }) {
    return (
      <Box sx={{ borderLeft: `3px solid ${palette.border.strong}`, pl: 2, my: 1.5, color: palette.text.secondary }}>
        {children}
      </Box>
    );
  },
  code({ className, children }) {
    const match = /language-(\w+)/.exec(className ?? '');
    const codeString = String(children).replace(/\n$/, '');

    if (match) {
      return (
        <Box sx={{ my: 1.5, borderRadius: 1.5, overflow: 'hidden', border: `1px solid ${palette.border.subtle}` }}>
          {/* Language header */}
          <Box sx={{ px: 2, py: 0.5, bgcolor: palette.bg.elevated, borderBottom: `1px solid ${palette.border.subtle}`, display: 'flex', alignItems: 'center' }}>
            <Typography sx={{ fontSize: '0.65rem', fontFamily: "'JetBrains Mono', monospace", color: palette.text.dim, letterSpacing: '1px', textTransform: 'uppercase' }}>
              {match[1]}
            </Typography>
          </Box>
          <SyntaxHighlighter
            style={customStyle}
            language={match[1]}
            PreTag="div"
            customStyle={{ margin: 0, background: '#111111', border: 'none' }}
          >
            {codeString}
          </SyntaxHighlighter>
        </Box>
      );
    }

    return (
      <Box
        component="code"
        sx={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: '0.8rem',
          bgcolor: palette.bg.elevated,
          color: palette.accent.blue,
          px: 0.75,
          py: 0.25,
          borderRadius: 0.5,
          border: `1px solid ${palette.border.subtle}`,
        }}
      >
        {children}
      </Box>
    );
  },
  a({ href, children }) {
    return (
      <Box
        component="a"
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        sx={{ color: palette.accent.blue, textDecoration: 'underline', textUnderlineOffset: '3px' }}
      >
        {children}
      </Box>
    );
  },
  hr() {
    return <Box sx={{ my: 2, borderTop: `1px solid ${palette.border.subtle}` }} />;
  },
  table({ children }) {
    return (
      <Box sx={{ overflowX: 'auto', my: 1.5 }}>
        <Box component="table" sx={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem', fontFamily: "'JetBrains Mono', monospace" }}>
          {children}
        </Box>
      </Box>
    );
  },
  th({ children }) {
    return (
      <Box component="th" sx={{ textAlign: 'left', p: 1, borderBottom: `1px solid ${palette.border.default}`, color: palette.text.secondary, fontWeight: 600, fontSize: '0.72rem' }}>
        {children}
      </Box>
    );
  },
  td({ children }) {
    return (
      <Box component="td" sx={{ p: 1, borderBottom: `1px solid ${palette.border.subtle}`, color: palette.text.primary, fontSize: '0.78rem' }}>
        {children}
      </Box>
    );
  },
};

export function MarkdownRenderer({ content, isStreaming }: MarkdownRendererProps) {
  return (
    <Box sx={{ '& > *:first-of-type': { mt: 0 } }}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
      {isStreaming && (
        <Box
          component="span"
          sx={{
            display: 'inline-block',
            width: '2px',
            height: '1em',
            bgcolor: palette.accent.blue,
            ml: 0.5,
            verticalAlign: 'text-bottom',
            animation: 'cursorBlink 1s step-end infinite',
            '@keyframes cursorBlink': {
              '0%, 100%': { opacity: 1 },
              '50%': { opacity: 0 },
            },
          }}
        />
      )}
    </Box>
  );
}
