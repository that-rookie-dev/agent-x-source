import DescriptionIcon from '@mui/icons-material/Description';
import EditIcon from '@mui/icons-material/Edit';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import SearchIcon from '@mui/icons-material/Search';
import FindInPageIcon from '@mui/icons-material/FindInPage';
import TerminalIcon from '@mui/icons-material/Terminal';
import PublicIcon from '@mui/icons-material/Public';
import SmartToyIcon from '@mui/icons-material/SmartToy';
import GroupsIcon from '@mui/icons-material/Groups';
import ChatIcon from '@mui/icons-material/Chat';
import AccountTreeIcon from '@mui/icons-material/AccountTree';
import AlarmIcon from '@mui/icons-material/Alarm';
import StorageIcon from '@mui/icons-material/Storage';
import Inventory2Icon from '@mui/icons-material/Inventory2';
import BuildIcon from '@mui/icons-material/Build';
import type { ReactNode } from 'react';

export interface ToolDisplayInfo {
  icon: ReactNode;
  title: string;
  subtitle?: string;
}

const TOOL_LABEL_KEYS = ['description', 'query', 'url', 'filePath', 'path', 'pattern', 'name', 'command', 'message', 'question'];

function getFilename(p: string): string {
  const parts = p.replace(/\\/g, '/').split('/');
  return parts[parts.length - 1] || p;
}

function getDirectory(p: string): string {
  const parts = p.replace(/\\/g, '/').split('/');
  parts.pop();
  return parts.join('/') || '/';
}

function extractLabel(args: Record<string, unknown>): string | undefined {
  for (const key of TOOL_LABEL_KEYS) {
    const val = args[key];
    if (val && typeof val === 'string') return val;
  }
  return undefined;
}

function extractArgs(args: Record<string, unknown> | string | undefined): Record<string, unknown> {
  if (!args) return {};
  if (typeof args === 'string') {
    try { return JSON.parse(args) as Record<string, unknown>; } catch { return {}; }
  }
  return args;
}

const iconSx = { fontSize: 13 };

export function getToolDisplay(toolName: string, args: Record<string, unknown> | string | undefined): ToolDisplayInfo {
  const parsed = extractArgs(args);
  const label = extractLabel(parsed);

  switch (toolName) {
    case 'file_read':
      return { icon: <DescriptionIcon sx={iconSx} />, title: 'Read', subtitle: label || (parsed.path || parsed.filePath ? getFilename(String(parsed.path || parsed.filePath)) : undefined) };
    case 'file_write':
    case 'file_patch':
    case 'code_replace':
    case 'code_insert':
      return { icon: <EditIcon sx={iconSx} />, title: 'Edit', subtitle: label || (parsed.path || parsed.filePath ? getFilename(String(parsed.path || parsed.filePath)) : undefined) };
    case 'folder_list':
      return { icon: <FolderOpenIcon sx={iconSx} />, title: 'List', subtitle: label || (parsed.path ? getDirectory(String(parsed.path)) : undefined) };
    case 'file_find':
    case 'glob':
      return { icon: <SearchIcon sx={iconSx} />, title: 'Glob', subtitle: label || (parsed.pattern ? String(parsed.pattern) : undefined) };
    case 'code_search':
    case 'code_grep':
    case 'grep':
      return { icon: <FindInPageIcon sx={iconSx} />, title: 'Grep', subtitle: label || (parsed.pattern ? String(parsed.pattern) : undefined) };
    case 'shell_exec':
    case 'shell_exec_streaming':
    case 'shell_background':
      return { icon: <TerminalIcon sx={iconSx} />, title: 'Shell', subtitle: label || (parsed.command ? String(parsed.command).slice(0, 60) : undefined) };
    case 'web_search':
      return { icon: <PublicIcon sx={iconSx} />, title: 'Search', subtitle: label };
    case 'deep_web_search':
      return { icon: <PublicIcon sx={iconSx} />, title: 'Deep Search', subtitle: label };
    case 'web_fetch':
    case 'web_scrape':
    case 'http_get':
      return { icon: <PublicIcon sx={iconSx} />, title: 'Fetch', subtitle: label };
    case 'delegate_to_subagent':
    case 'sub_agent_spawn':
      return { icon: <SmartToyIcon sx={iconSx} />, title: 'Agent', subtitle: label };
    case 'delegate_to_crew':
      return { icon: <GroupsIcon sx={iconSx} />, title: 'Crew', subtitle: label };
    case 'crew_message':
      return { icon: <ChatIcon sx={iconSx} />, title: 'Msg', subtitle: parsed.to ? `@${String(parsed.to)}` : undefined };
    case 'git_status':
    case 'git_diff':
    case 'git_commit':
    case 'git_push':
    case 'git_pull':
      return { icon: <AccountTreeIcon sx={iconSx} />, title: 'Git', subtitle: label };
    case 'reminder_set':
      return { icon: <AlarmIcon sx={iconSx} />, title: 'Remind', subtitle: label };
    case 'db_query':
    case 'db_migrate':
      return { icon: <StorageIcon sx={iconSx} />, title: 'DB', subtitle: label };
    case 'docker_build':
    case 'container_run':
      return { icon: <Inventory2Icon sx={iconSx} />, title: 'Docker', subtitle: label };
    case 'package_install':
    case 'package_remove':
    case 'pkg_update':
      return { icon: <Inventory2Icon sx={iconSx} />, title: 'Pkg', subtitle: label };
    default:
      return { icon: <BuildIcon sx={iconSx} />, title: toolName.split('_').map(w => w[0]?.toUpperCase() + w.slice(1)).join(' '), subtitle: label };
  }
}


