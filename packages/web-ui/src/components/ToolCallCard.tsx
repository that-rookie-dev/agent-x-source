import { useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Collapse from '@mui/material/Collapse';
import IconButton from '@mui/material/IconButton';
import CircularProgress from '@mui/material/CircularProgress';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import DescriptionOutlinedIcon from '@mui/icons-material/DescriptionOutlined';
import SearchIcon from '@mui/icons-material/Search';
import EditNoteIcon from '@mui/icons-material/EditNote';
import TerminalIcon from '@mui/icons-material/Terminal';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import CodeIcon from '@mui/icons-material/Code';
import type { ToolCall } from '../types';
import { palette } from '../theme';

interface ToolCallCardProps {
  toolCall: ToolCall;
}

const toolIcons: Record<string, typeof DescriptionOutlinedIcon> = {
  read_file: DescriptionOutlinedIcon,
  grep_search: SearchIcon,
  semantic_search: SearchIcon,
  file_search: FolderOpenIcon,
  replace_string_in_file: EditNoteIcon,
  create_file: EditNoteIcon,
  run_in_terminal: TerminalIcon,
  list_dir: FolderOpenIcon,
};

function getToolIcon(tool: string) {
  return toolIcons[tool] ?? CodeIcon;
}

function getToolLabel(toolCall: ToolCall): string {
  const { tool, description, input } = toolCall;
  if (description) return description;

  switch (tool) {
    case 'read_file': {
      const fp = input?.['filePath'] as string | undefined;
      const start = input?.['startLine'] as number | undefined;
      const end = input?.['endLine'] as number | undefined;
      const name = fp?.split('/').pop() ?? 'file';
      return start && end ? `Read ${name}, lines ${start} to ${end}` : `Read ${name}`;
    }
    case 'grep_search': {
      const q = input?.['query'] as string | undefined;
      const pat = input?.['includePattern'] as string | undefined;
      return `Searched for text ${q ?? '...'} ${pat ? `(${pat})` : ''}`;
    }
    case 'semantic_search': {
      const q = input?.['query'] as string | undefined;
      return `Semantic search: ${q ?? '...'}`;
    }
    case 'file_search': {
      const q = input?.['query'] as string | undefined;
      return `File search: ${q ?? '...'}`;
    }
    case 'replace_string_in_file':
    case 'multi_replace_string_in_file': {
      const fp = input?.['filePath'] as string | undefined;
      const name = fp?.split('/').pop() ?? 'file';
      return `Editing ${name}`;
    }
    case 'create_file': {
      const fp = input?.['filePath'] as string | undefined;
      const name = fp?.split('/').pop() ?? 'file';
      return `Creating ${name}`;
    }
    case 'run_in_terminal': {
      const cmd = input?.['command'] as string | undefined;
      return cmd ? `Running: ${cmd.slice(0, 60)}${cmd.length > 60 ? '...' : ''}` : 'Running command';
    }
    case 'list_dir': {
      const p = input?.['path'] as string | undefined;
      return `List directory: ${p?.split('/').pop() ?? '...'}`;
    }
    default:
      return tool.replace(/_/g, ' ');
  }
}

function getResultSummary(toolCall: ToolCall): string | null {
  const { result } = toolCall;
  if (!result) return null;
  // Count results for search-like tools
  if (toolCall.tool.includes('search') || toolCall.tool === 'grep_search') {
    const matchCount = (result.match(/match/gi) ?? []).length;
    if (matchCount > 0) return `${matchCount} result${matchCount > 1 ? 's' : ''}`;
  }
  if (result.length > 200) return `${result.length} chars`;
  return null;
}

export function ToolCallCard({ toolCall }: ToolCallCardProps) {
  const [expanded, setExpanded] = useState(false);
  const Icon = getToolIcon(toolCall.tool);
  const label = getToolLabel(toolCall);
  const isRunning = toolCall.status === 'running';
  const isError = toolCall.status === 'error';
  const summary = getResultSummary(toolCall);
  const duration = toolCall.endTime && toolCall.startTime
    ? ((toolCall.endTime - toolCall.startTime) / 1000).toFixed(1)
    : null;

  return (
    <Box
      sx={{
        borderLeft: `2px solid ${isRunning ? palette.accent.blue : isError ? palette.accent.red : palette.border.default}`,
        ml: 1,
        transition: 'border-color 0.3s',
      }}
    >
      <Box
        onClick={() => toolCall.result && setExpanded(!expanded)}
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          py: 0.5,
          pl: 1.5,
          pr: 1,
          cursor: toolCall.result ? 'pointer' : 'default',
          borderRadius: 1,
          '&:hover': toolCall.result ? { bgcolor: palette.bg.elevated } : {},
          transition: 'background-color 0.15s',
        }}
      >
        {/* Status icon */}
        {isRunning ? (
          <CircularProgress size={14} thickness={5} sx={{ color: palette.accent.blue }} />
        ) : isError ? (
          <ErrorIcon sx={{ fontSize: 14, color: palette.accent.red }} />
        ) : (
          <CheckCircleIcon sx={{ fontSize: 14, color: palette.text.dim }} />
        )}

        {/* Tool icon */}
        <Icon sx={{ fontSize: 14, color: palette.text.tertiary }} />

        {/* Label */}
        <Typography
          variant="body2"
          sx={{
            flex: 1,
            color: isRunning ? palette.text.secondary : palette.text.tertiary,
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: '0.75rem',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {label}
        </Typography>

        {/* Summary badge */}
        {summary && (
          <Typography
            component="span"
            sx={{
              fontSize: '0.65rem',
              fontFamily: "'JetBrains Mono', monospace",
              color: palette.text.dim,
              bgcolor: palette.bg.elevated,
              px: 0.75,
              py: 0.25,
              borderRadius: 0.5,
              border: `1px solid ${palette.border.subtle}`,
            }}
          >
            {summary}
          </Typography>
        )}

        {/* Duration */}
        {duration && (
          <Typography
            component="span"
            sx={{ fontSize: '0.6rem', fontFamily: "'JetBrains Mono', monospace", color: palette.text.dim }}
          >
            {duration}s
          </Typography>
        )}

        {/* Expand button */}
        {toolCall.result && (
          <IconButton size="small" sx={{ p: 0.25 }}>
            <ExpandMoreIcon
              sx={{
                fontSize: 14,
                color: palette.text.dim,
                transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
                transition: 'transform 0.2s',
              }}
            />
          </IconButton>
        )}
      </Box>

      {/* Expandable result */}
      <Collapse in={expanded}>
        <Box
          sx={{
            ml: 1.5,
            mt: 0.5,
            mb: 1,
            p: 1.5,
            bgcolor: palette.bg.secondary,
            border: `1px solid ${palette.border.subtle}`,
            borderRadius: 1,
            maxHeight: 300,
            overflow: 'auto',
          }}
        >
          <Typography
            component="pre"
            sx={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: '0.7rem',
              color: palette.text.secondary,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
              m: 0,
            }}
          >
            {toolCall.result}
          </Typography>
        </Box>
      </Collapse>
    </Box>
  );
}
