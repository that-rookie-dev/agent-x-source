// ============================================================================
// Agent-X Visualization & Animation Type Contracts
// Based on: VISUALIZATION_ANIMATION_BLUEPRINT.md
// ============================================================================

import type { ToolCallStatus } from './communication.js';

// === STREAMING MARKDOWN ===

export interface StreamingMarkdownState {
  stablePrefix: string;
  unstableSuffix: string;
  stableHtml: string;
  unstableText: string;
  boundaryPosition: number;
}

// === TOOL CARD ===

export type ToolCardStatus = 'pending' | 'running' | 'completed' | 'error' | 'denied';

export interface ToolCardProps {
  id: string;
  name: string;
  icon: string;
  label: string;
  detail?: string;
  status: ToolCardStatus;
  input?: string;
  output?: string;
  error?: string;
  durationMs?: number;
  isExpanded: boolean;
  toolCallStatus?: ToolCallStatus;
}

export interface ToolDisplaySpec {
  icon: string;
  label: string;
  color: string;
}

// === THINKING / REASONING PANEL ===

export type ThinkingVisibility = 'show' | 'hide' | 'auto';

export interface ThinkingPanelState {
  isActive: boolean;
  isExpanded: boolean;
  content: string;
  title?: string;
  visibility: ThinkingVisibility;
  startTime?: number;
}

// === SPINNER ===

export type SpinnerVariant = 'braille' | 'dots' | 'pulse' | 'spin' | 'breathe';

export interface SpinnerConfig {
  variant: SpinnerVariant;
  speed: number; // ms per frame
  color: string;
  size?: number;
}

export const BRAILLE_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'] as const;

export const DOTS_FRAMES = ['.  ', '.. ', '...', ' ..', '  .', '   '] as const;

// === CODE BLOCK ===

export interface CodeBlockProps {
  language: string;
  content: string;
  isStreaming?: boolean;
  showLineNumbers?: boolean;
  maxHeight?: number;
}

// === DIFF VIEWER ===

export type DiffViewMode = 'split' | 'unified';

export interface DiffViewerProps {
  diff: string;
  view?: DiffViewMode;
  filetype?: string;
  showLineNumbers?: boolean;
  addedColor: string;
  removedColor: string;
  addedBgColor: string;
  removedBgColor: string;
}

// === THEME SYSTEM ===

export type ThemeMode = 'dark' | 'light';

export interface ThemeVariant {
  mode: ThemeMode;
  name: string;
  tokens: ThemeTokens;
}

export interface ThemeTokens {
  // Base
  bg: string;
  fg: string;
  accent: string;
  ok: string;
  destructive: string;
  warn: string;
  muted: string;
  border: string;

  // Surface
  surface: string;
  surfaceHover: string;
  surfaceActive: string;

  // Text hierarchy
  textPrimary: string;
  textSecondary: string;
  textMuted: string;

  // Tool card
  toolPending: string;
  toolRunning: string;
  toolCompleted: string;
  toolError: string;
  toolDenied: string;

  // Thinking panel
  thinkingBg: string;
  thinkingBorder: string;
  thinkingText: string;

  // Code block
  codeBg: string;
  codeBorder: string;
  codeText: string;

  // Diff
  diffAdded: string;
  diffRemoved: string;
  diffAddedBg: string;
  diffRemovedBg: string;
  diffContextBg: string;
  diffLineNumber: string;

  // Markdown
  markdownHeading: string;
  markdownLink: string;
  markdownCode: string;
  markdownBlockQuote: string;

  // Syntax highlighting
  syntaxKeyword: string;
  syntaxFunction: string;
  syntaxString: string;
  syntaxNumber: string;
  syntaxComment: string;

  // Spacing
  radiusSm: string;
  radiusMd: string;
  radiusLg: string;
  radiusFull: string;

  // Animation
  easeOut: string;
  easeSpring: string;
  durationFast: string;
  durationNormal: string;
  durationSlow: string;

  // Spinner
  spinnerColor: string;
  thinkingOpacity: number;
}

// === THEME ENGINE ===

export interface ThemeEngineConfig {
  mode: ThemeMode;
  variant: string;
  customTokens?: Partial<ThemeTokens>;
}

export interface BuiltinTheme {
  name: string;
  dark: ThemeTokens;
  light: ThemeTokens;
}

// === VISUAL EVENT BRIDGE ===

export type VisualUpdate =
  | { type: 'text_update'; messageId: string; stableHtml: string; unstableText: string }
  | { type: 'tool_card'; card: ToolCardProps }
  | { type: 'tool_card_update'; card: Partial<ToolCardProps> & { id: string } }
  | { type: 'thinking_update'; state: Partial<ThinkingPanelState> & { isActive: boolean } }
  | { type: 'todo_update'; items: Array<{ id: number; title: string; status: 'not-started' | 'in-progress' | 'completed' }> }
  | { type: 'spinner'; id: string; config: SpinnerConfig; show: boolean }
  | { type: 'toast'; message: string; icon: string; autoDismiss?: number }
  | { type: 'diff_preview'; filePath: string; diff: string; oldContent?: string; newContent?: string }
  | { type: 'compaction_toast'; action: 'start' | 'done'; details?: string };

// === TOOL DISPLAY SPEC REGISTRY ===

export const DEFAULT_TOOL_DISPLAY: Record<string, ToolDisplaySpec> = {
  file_read: { icon: '📖', label: 'Read', color: '#4FC3F7' },
  file_write: { icon: '✍️', label: 'Write', color: '#81C784' },
  file_delete: { icon: '🗑️', label: 'Delete', color: '#E57373' },
  file_find: { icon: '🔍', label: 'Find', color: '#4FC3F7' },
  file_copy: { icon: '📋', label: 'Copy', color: '#81C784' },
  file_diff: { icon: '🔀', label: 'Diff', color: '#FFB74D' },
  file_patch: { icon: '🩹', label: 'Patch', color: '#81C784' },
  folder_create: { icon: '📁', label: 'Create dir', color: '#81C784' },
  folder_list: { icon: '📂', label: 'List dir', color: '#4FC3F7' },
  folder_tree: { icon: '🌲', label: 'Tree', color: '#4FC3F7' },
  shell_exec: { icon: '💻', label: 'Shell', color: '#FFB74D' },
  shell_background: { icon: '⚙️', label: 'Background', color: '#FFB74D' },
  git_status: { icon: '📊', label: 'Git status', color: '#CE93D8' },
  git_diff: { icon: '🔀', label: 'Git diff', color: '#CE93D8' },
  git_commit: { icon: '💾', label: 'Git commit', color: '#CE93D8' },
  git_log: { icon: '📜', label: 'Git log', color: '#CE93D8' },
  git_add: { icon: '➕', label: 'Git add', color: '#CE93D8' },
  git_branch: { icon: '🌿', label: 'Git branch', color: '#CE93D8' },
  git_checkout: { icon: '🔄', label: 'Git checkout', color: '#CE93D8' },
  code_search: { icon: '🔎', label: 'Code search', color: '#4FC3F7' },
  code_replace: { icon: '✏️', label: 'Code replace', color: '#81C784' },
  code_insert: { icon: '📝', label: 'Code insert', color: '#81C784' },
  code_grep: { icon: '🔎', label: 'Grep', color: '#4FC3F7' },
  code_definitions: { icon: '📍', label: 'Definitions', color: '#4FC3F7' },
  code_symbols: { icon: '🔣', label: 'Symbols', color: '#4FC3F7' },
  web_search: { icon: '🌐', label: 'Web search', color: '#64B5F6' },
  deep_web_search: { icon: '🔍', label: 'Deep search', color: '#4FC3F7' },
  web_scrape: { icon: '🕸️', label: 'Web scrape', color: '#64B5F6' },
  web_fetch: { icon: '🌐', label: 'Web fetch', color: '#64B5F6' },
  http_get: { icon: '📡', label: 'HTTP GET', color: '#64B5F6' },
  http_post: { icon: '📮', label: 'HTTP POST', color: '#64B5F6' },
  db_query: { icon: '🗄️', label: 'DB query', color: '#A1887F' },
  db_schema: { icon: '📐', label: 'DB schema', color: '#A1887F' },
  test_run: { icon: '🧪', label: 'Test', color: '#4DB6AC' },
  test_watch: { icon: '👁️', label: 'Test watch', color: '#4DB6AC' },
  test_coverage: { icon: '📊', label: 'Coverage', color: '#4DB6AC' },
  package_install: { icon: '📦', label: 'Install', color: '#FFB74D' },
  package_remove: { icon: '🗑️', label: 'Remove', color: '#E57373' },
  package_list: { icon: '📋', label: 'List pkgs', color: '#4FC3F7' },
  system_info: { icon: '🖥️', label: 'System', color: '#90A4AE' },
  browser_open: { icon: '🌐', label: 'Browser', color: '#64B5F6' },
  browser_screenshot: { icon: '📸', label: 'Screenshot', color: '#64B5F6' },
  container_list: { icon: '🐳', label: 'Containers', color: '#4FC3F7' },
  reminder_set: { icon: '⏰', label: 'Reminder', color: '#FFB74D' },
  ask_clarification: { icon: '❓', label: 'Question', color: '#FFB74D' },
  delegate_to_subagent: { icon: '🤖', label: 'Sub-agent', color: '#CE93D8' },
  todo_write: { icon: '📋', label: 'Todo', color: '#81C784' },
};
