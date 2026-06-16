import { useState, useEffect } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Collapse from '@mui/material/Collapse';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import { colors } from '../../theme';

export interface ToolCallData {
  id: string;
  name: string;
  args?: string | Record<string, unknown>;
  result?: string;
  status: 'running' | 'done' | 'error';
  elapsed?: number;
  metadata?: { diff?: string; filePath?: string; oldContent?: string; newContent?: string };
}

function getToolStatusColor(status: string): string {
  if (status === 'running') return colors.accent.blue;   // progress = light blue
  if (status === 'error') return colors.accent.purple;    // failure = purple
  return colors.accent.green;                              // success = green
}

interface DetailSection {
  label: string;
  content: string;
  type: 'command' | 'code' | 'diff' | 'text' | 'pre';
  filePath?: string;
}

function formatArgs(args: string | Record<string, unknown> | undefined, toolName: string): { primary: string; secondary?: string } {
  if (!args) return { primary: '' };
  if (typeof args === 'string') return { primary: args };
  const n = toolName.toLowerCase();
  const command = (args['command'] as string) || (args['cmd'] as string) || '';
  const filePath = (args['path'] as string) || (args['file'] as string) || (args['filePath'] as string) || (args['target'] as string) || '';
  const content = (args['content'] as string) || (args['newContent'] as string) || (args['text'] as string) || '';
  const oldStr = (args['oldString'] as string) || (args['old_str'] as string) || '';
  const newStr = (args['newString'] as string) || (args['new_str'] as string) || '';
  const pattern = (args['pattern'] as string) || (args['query'] as string) || (args['regex'] as string) || '';
  const url = (args['url'] as string) || '';

  if (command) {
    const second = (args['workdir'] as string) || (args['cwd'] as string) || (args['workingDirectory'] as string) || '';
    return { primary: command, secondary: second };
  }
  if (url) return { primary: url };
  if (pattern) return { primary: pattern, secondary: (args['path'] as string) || (args['include'] as string) || (args['directory'] as string) || '' };
  if (filePath) {
    if (content) return { primary: filePath, secondary: content.length > 160 ? content.slice(0, 160) + '...' : content };
    if (oldStr || newStr) return { primary: filePath, secondary: (oldStr ? `- ${oldStr.slice(0, 60)}` : '') + (newStr ? ` → + ${newStr.slice(0, 60)}` : '') };
    return { primary: filePath };
  }
  if (n.includes('delegate') || n.includes('subagent') || n.includes('crew')) {
    return { primary: (args['mission'] as string) || (args['task'] as string) || (args['instruction'] as string) || '' };
  }
  if (n.includes('glob') || n.includes('ls') || n.includes('list')) {
    return { primary: (args['pattern'] as string) || (args['path'] as string) || '' };
  }
  if (n.includes('read') || n.includes('grep') || n.includes('search') || n.includes('find')) {
    return { primary: filePath || pattern || '' };
  }
  if (n.includes('write') || n.includes('edit') || n.includes('create') || n.includes('replace')) {
    return { primary: filePath || '' };
  }
  if (n.includes('web') || n.includes('fetch') || n.includes('http') || n.includes('url') || n.includes('curl')) {
    return { primary: url || '' };
  }
  if (n.includes('question') || n.includes('ask') || n.includes('clarif')) {
    return { primary: (args['question'] as string) || '' };
  }
  return { primary: '' };
}

function buildExpandedSections(tool: ToolCallData): DetailSection[] {
  const sections: DetailSection[] = [];
  const args = typeof tool.args === 'object' && tool.args ? tool.args : {};
  const command = (args['command'] as string) || (args['cmd'] as string) || '';
  const filePath = (args['path'] as string) || (args['file'] as string) || (args['filePath'] as string) || (args['target'] as string) || '';
  const content = (args['content'] as string) || (args['newContent'] as string) || (args['text'] as string) || '';
  const oldStr = (args['oldString'] as string) || (args['old_str'] as string) || '';
  const newStr = (args['newString'] as string) || (args['new_str'] as string) || '';
  const pattern = (args['pattern'] as string) || (args['query'] as string) || (args['regex'] as string) || '';
  const url = (args['url'] as string) || '';
  const workdir = (args['workdir'] as string) || (args['cwd'] as string) || (args['workingDirectory'] as string) || '';

  // Bash-like tools
  if (command) {
    sections.push({ label: 'Command', content: command, type: 'command' });
    if (workdir) sections.push({ label: 'Directory', content: workdir, type: 'text' });
  }

  // File path info
  if (filePath) {
    sections.push({ label: 'File', content: filePath, type: 'text', filePath });
  }

  // Content for write tools
  if (content) {
    sections.push({ label: 'Content', content: content.slice(0, 3000), type: 'code' });
  }

  // Edit tools: show old→new
  if (oldStr || newStr) {
    const diffBuilder: string[] = [];
    if (oldStr) diffBuilder.push(`- ${oldStr.slice(0, 500)}`);
    if (newStr) diffBuilder.push(`+ ${newStr.slice(0, 500)}`);
    sections.push({ label: 'Change', content: diffBuilder.join('\n'), type: 'diff' });
  }

  // Search pattern
  if (pattern) {
    sections.push({ label: 'Pattern', content: pattern, type: 'code' });
  }

  // URL
  if (url) {
    sections.push({ label: 'URL', content: url, type: 'text' });
  }

  // Diff from metadata (tool result carries diff)
  if (tool.metadata?.diff) {
    sections.push({ label: 'Diff', content: tool.metadata.diff, type: 'diff' });
  }

  // Old/new content from metadata
  if (!oldStr && !newStr && (tool.metadata?.oldContent || tool.metadata?.newContent)) {
    const od = tool.metadata.oldContent || '';
    const nd = tool.metadata.newContent || '';
    if (od) sections.push({ label: 'Old', content: od.slice(0, 2000), type: 'code' });
    if (nd) sections.push({ label: 'New', content: nd.slice(0, 2000), type: 'code' });
  }

  // Fallback: show raw args if nothing recognized
  if (sections.length === 0 && tool.args && Object.keys(args).length > 0) {
    sections.push({ label: 'Arguments', content: JSON.stringify(args, null, 2).slice(0, 2000), type: 'code' });
  }

  // Output
  if (tool.result) {
    let out = tool.result;
    // Parse JSON if it looks like a JSON response object
    if (typeof out === 'string' && out.startsWith('{')) {
      try {
        const parsed = JSON.parse(out);
        if (parsed && typeof parsed === 'object') {
          // Extract formatted output from common response structures
          if ('output' in parsed) {
            out = parsed.output;
          } else if ('result' in parsed) {
            out = parsed.result;
          } else if ('message' in parsed) {
            out = parsed.message;
          } else {
            out = JSON.stringify(parsed, null, 2);
          }
        }
      } catch {
        // Not valid JSON, use as-is
      }
    }
    const display = out.length > 8000 ? out.slice(0, 8000) + `\n\n… [${out.length - 8000} more chars]` : out;
    sections.push({ label: 'Output', content: display, type: 'pre' });
  }

  return sections;
}

export function ToolCallCard({ tool }: { tool: ToolCallData }) {
  const [expanded, setExpanded] = useState(false);
  const cc = getToolStatusColor(tool.status);
  const formatted = formatArgs(tool.args, tool.name);

  // Live elapsed timer for running tools
  const [liveElapsed, setLiveElapsed] = useState(0);
  useEffect(() => {
    if (tool.status !== 'running') { setLiveElapsed(0); return; }
    const start = Date.now();
    const timer = setInterval(() => setLiveElapsed(Date.now() - start), 200);
    return () => clearInterval(timer);
  }, [tool.status, tool.id]);

  const elapsed = tool.elapsed != null
    ? `${tool.elapsed >= 1000 ? (tool.elapsed / 1000).toFixed(1) + 's' : tool.elapsed + 'ms'}`
    : tool.status === 'running'
      ? `${liveElapsed >= 1000 ? (liveElapsed / 1000).toFixed(1) + 's' : liveElapsed + 'ms'}`
      : null;

  const sections = buildExpandedSections(tool);

  return (
    <Box sx={{
      mb: 0.5, borderRadius: 1, overflow: 'hidden',
      border: `1px solid ${cc}25`,
      bgcolor: tool.status === 'running' ? cc + '05' : cc + '06',
      transition: 'all 0.15s ease',
    }}>
      <Box
        onClick={() => tool.status !== 'running' && setExpanded(e => !e)}
        sx={{
          display: 'flex', alignItems: 'center', gap: 0.75, px: 1.25, py: 0.625,
          cursor: tool.status === 'running' ? 'default' : 'pointer',
          '&:hover': tool.status !== 'running' ? { bgcolor: cc + '0A' } : {},
        }}
      >
        {/* Color dot — no icons */}
        <Box sx={{
          width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
          bgcolor: cc,
          ...(tool.status === 'running' ? {
            animation: 'agentx-pulse 1.4s ease-in-out infinite',
          } : {}),
        }} />

        {/* Tool name + detail */}
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography sx={{
            fontSize: '0.6rem', fontWeight: 600, color: colors.text.primary,
            fontFamily: "'JetBrains Mono', monospace", lineHeight: 1.2,
          }}>
            {tool.name.split('_').join(' ')}
          </Typography>
          {formatted.primary && (
            <Typography sx={{
              fontSize: '0.55rem', color: colors.text.secondary,
              fontFamily: "'JetBrains Mono', monospace",
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              lineHeight: 1.3, mt: 0.15,
            }}>
              {formatted.primary}
            </Typography>
          )}
        </Box>

        {/* Timing + status */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexShrink: 0 }}>
          <Typography sx={{
            fontSize: '0.5rem', color: cc, fontFamily: "'JetBrains Mono', monospace",
            opacity: tool.status === 'running' ? 0.8 : 0.5,
            ...(tool.status === 'running' ? {
              animation: 'agentx-pulse 1.4s ease-in-out infinite',
            } : {}),
          }}>
            {tool.status === 'running' ? 'running' : tool.status === 'error' ? 'failed' : 'done'}
          </Typography>
          {elapsed && (
            <Typography sx={{ fontSize: '0.5rem', color: colors.text.dim, fontFamily: "'JetBrains Mono', monospace" }}>
              {elapsed}
            </Typography>
          )}
        </Box>

        {/* Expand arrow */}
        {tool.status !== 'running' && (
          <KeyboardArrowDownIcon sx={{
            fontSize: 14, color: colors.text.dim,
            transform: expanded ? 'rotate(180deg)' : 'none',
            transition: 'transform 0.15s', flexShrink: 0,
          }} />
        )}
      </Box>

      <Collapse in={expanded}>
        <Box sx={{ px: 1.25, pb: 1, pt: 0.25, borderTop: `1px solid ${cc}15` }}>
          {sections.map((s, i) => (
            <Box key={i} sx={{ mt: 0.5 }}>
              <Typography sx={{ fontSize: '0.5rem', fontWeight: 600, color: colors.text.dim, fontFamily: "'JetBrains Mono', monospace", mb: 0.25, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                {s.label}
              </Typography>
              {s.type === 'command' ? (
                <Box sx={{ bgcolor: '#0a0a0a', borderRadius: 0.5, p: 0.75, fontFamily: "'JetBrains Mono', monospace", fontSize: '0.55rem', color: '#3fb950', lineHeight: 1.5, whiteSpace: 'pre-wrap', maxHeight: 250, overflow: 'auto' }}>
                  <Box component="span" sx={{ color: '#3fb950', mr: 0.5 }}>$</Box>
                  {s.content}
                </Box>
              ) : s.type === 'code' || s.type === 'pre' ? (
                <Box sx={{ bgcolor: '#0a0a0a', borderRadius: 0.5, p: 0.75, fontFamily: "'JetBrains Mono', monospace", fontSize: '0.55rem', color: colors.text.secondary, lineHeight: 1.5, whiteSpace: 'pre-wrap', maxHeight: 300, overflow: 'auto', wordBreak: 'break-word' }}>
                  {s.content}
                </Box>
              ) : s.type === 'diff' ? (
                <DiffBlock diff={s.content} />
              ) : (
                <Typography sx={{ fontSize: '0.55rem', color: colors.text.secondary, fontFamily: "'JetBrains Mono', monospace", wordBreak: 'break-word' }}>
                  {s.content}
                </Typography>
              )}
            </Box>
          ))}
        </Box>
      </Collapse>
    </Box>
  );
}

function DiffBlock({ diff }: { diff: string }) {
  const lines = diff.split('\n');
  return (
    <Box sx={{ bgcolor: '#0a0a0a', borderRadius: 0.5, p: 0.75, maxHeight: 300, overflow: 'auto', fontFamily: "'JetBrains Mono', monospace", fontSize: '0.5rem', lineHeight: 1.6 }}>
      {lines.map((line, i) => {
        let sx: Record<string, unknown> = { display: 'flex', alignItems: 'center' };
        if (line.startsWith('+') && !line.startsWith('+++')) { sx = { ...sx, bgcolor: '#1a3a1a', color: '#3fb950' }; }
        else if (line.startsWith('-') && !line.startsWith('---')) { sx = { ...sx, bgcolor: '#3a1a1a', color: '#f85149' }; }
        else if (line.startsWith('@@')) { sx = { ...sx, color: '#58a6ff' }; }
        else { sx = { ...sx, color: '#8b8b8b' }; }
        return (
          <Box key={i} sx={sx}>
            <Box component="span" sx={{ width: 32, textAlign: 'right', mr: 1, color: '#484848', flexShrink: 0 }}>{i + 1}</Box>
            <Box component="span" sx={{ whiteSpace: 'pre' }}>{line}</Box>
          </Box>
        );
      })}
    </Box>
  );
}
