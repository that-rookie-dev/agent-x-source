import type { ToolDefinition } from '@agentx/shared';
import { ToolRegistry } from './ToolRegistry.js';
import { ToolExecutor } from './ToolExecutor.js';
import * as fs from './builtin/filesystem.js';
import * as shell from './builtin/shell.js';
import * as git from './builtin/git.js';
import * as code from './builtin/code.js';
import * as documents from './builtin/documents.js';
import * as scheduler from './builtin/scheduler.js';

// Core tool definitions with schemas the model uses to invoke them
const CORE_TOOLS: ToolDefinition[] = [
  {
    id: 'file_read',
    name: 'Read File',
    description: 'Read the contents of a file',
    modelDescription: 'Read file contents. Use for examining code, config, or data files.',
    category: 'filesystem',
    riskLevel: 'low',
    schema: { type: 'object', properties: { path: { type: 'string', description: 'File path relative to working directory' } }, required: ['path'] },
    composable: true,
    source: 'builtin',
  },
  {
    id: 'file_write',
    name: 'Write File',
    description: 'Write content to a file (creates directories if needed)',
    modelDescription: 'Write/create a file with given content. Creates parent directories automatically.',
    category: 'filesystem',
    riskLevel: 'medium',
    schema: { type: 'object', properties: { path: { type: 'string', description: 'File path' }, content: { type: 'string', description: 'File content to write' } }, required: ['path', 'content'] },
    composable: true,
    source: 'builtin',
  },
  {
    id: 'file_delete',
    name: 'Delete File',
    description: 'Delete a file',
    modelDescription: 'Delete a file at the given path.',
    category: 'filesystem',
    riskLevel: 'high',
    schema: { type: 'object', properties: { path: { type: 'string', description: 'File path to delete' } }, required: ['path'] },
    composable: true,
    source: 'builtin',
  },
  {
    id: 'folder_create',
    name: 'Create Folder',
    description: 'Create a directory (recursive)',
    modelDescription: 'Create a directory and any parent directories.',
    category: 'filesystem',
    riskLevel: 'low',
    schema: { type: 'object', properties: { path: { type: 'string', description: 'Directory path' } }, required: ['path'] },
    composable: true,
    source: 'builtin',
  },
  {
    id: 'folder_list',
    name: 'List Directory',
    description: 'List contents of a directory',
    modelDescription: 'List files and folders in a directory.',
    category: 'filesystem',
    riskLevel: 'low',
    schema: { type: 'object', properties: { path: { type: 'string', description: 'Directory path (default: .)' } }, required: [] },
    composable: true,
    source: 'builtin',
  },
  {
    id: 'folder_delete',
    name: 'Delete Folder',
    description: 'Delete a directory recursively',
    modelDescription: 'Delete a directory and all its contents recursively.',
    category: 'filesystem',
    riskLevel: 'critical',
    schema: { type: 'object', properties: { path: { type: 'string', description: 'Directory path to delete' } }, required: ['path'] },
    composable: true,
    source: 'builtin',
  },
  {
    id: 'shell_exec',
    name: 'Execute Command',
    description: 'Run a shell command and return output',
    modelDescription: 'Execute a shell command in the working directory. Returns stdout/stderr. Use for builds, installs, tests, and system tasks.',
    category: 'shell_process',
    riskLevel: 'high',
    schema: { type: 'object', properties: { command: { type: 'string', description: 'Shell command to execute' }, cwd: { type: 'string', description: 'Working directory (optional, relative to scope)' }, timeout: { type: 'number', description: 'Timeout in ms (default: 30000)' } }, required: ['command'] },
    composable: true,
    source: 'builtin',
  },
  {
    id: 'git_status',
    name: 'Git Status',
    description: 'Show git repository status',
    modelDescription: 'Get git status showing modified, staged, and untracked files.',
    category: 'git_vcs',
    riskLevel: 'low',
    schema: { type: 'object', properties: {}, required: [] },
    composable: true,
    source: 'builtin',
  },
  {
    id: 'git_diff',
    name: 'Git Diff',
    description: 'Show git diff',
    modelDescription: 'Show uncommitted changes or diff between refs.',
    category: 'git_vcs',
    riskLevel: 'low',
    schema: { type: 'object', properties: { ref: { type: 'string', description: 'Git ref to diff against (optional)' }, path: { type: 'string', description: 'File path to diff (optional)' } }, required: [] },
    composable: true,
    source: 'builtin',
  },
  {
    id: 'git_commit',
    name: 'Git Commit',
    description: 'Create a git commit',
    modelDescription: 'Stage and commit changes with a message.',
    category: 'git_vcs',
    riskLevel: 'medium',
    schema: { type: 'object', properties: { message: { type: 'string', description: 'Commit message' }, files: { type: 'string', description: 'Files to stage (space-separated, or "." for all)' } }, required: ['message'] },
    composable: true,
    source: 'builtin',
  },
  {
    id: 'code_search',
    name: 'Search Code',
    description: 'Search for text/regex across files',
    modelDescription: 'Search code files for a pattern (text or regex). Returns matching lines with file paths and line numbers.',
    category: 'code_intelligence',
    riskLevel: 'low',
    schema: { type: 'object', properties: { pattern: { type: 'string', description: 'Search pattern (text or regex)' }, path: { type: 'string', description: 'Directory to search (default: .)' }, glob: { type: 'string', description: 'File glob pattern (e.g. "*.ts")' } }, required: ['pattern'] },
    composable: true,
    source: 'builtin',
  },
  {
    id: 'code_replace',
    name: 'Replace in File',
    description: 'Find and replace text in a file',
    modelDescription: 'Replace occurrences of a string in a file. Use for code edits.',
    category: 'code_intelligence',
    riskLevel: 'medium',
    schema: { type: 'object', properties: { path: { type: 'string', description: 'File path' }, search: { type: 'string', description: 'Text to find' }, replace: { type: 'string', description: 'Replacement text' } }, required: ['path', 'search', 'replace'] },
    composable: true,
    source: 'builtin',
  },
  {
    id: 'csv_create',
    name: 'Create CSV',
    description: 'Create a CSV file from headers and rows',
    modelDescription: 'Create a CSV file with structured data. Provide headers array and rows (array of arrays), or raw content string.',
    category: 'documents',
    riskLevel: 'medium',
    schema: { type: 'object', properties: { file: { type: 'string', description: 'Output file path' }, headers: { type: 'array', description: 'Column headers' }, rows: { type: 'array', description: 'Array of row arrays' }, content: { type: 'string', description: 'Raw CSV content (alternative to headers+rows)' } }, required: ['file'] },
    composable: true,
    source: 'builtin',
  },
  {
    id: 'pdf_create',
    name: 'Create PDF',
    description: 'Create a PDF document from text content',
    modelDescription: 'Create a PDF file with text content. Supports title, author metadata. Multi-page for long content.',
    category: 'documents',
    riskLevel: 'medium',
    schema: { type: 'object', properties: { file: { type: 'string', description: 'Output file path' }, title: { type: 'string', description: 'Document title' }, content: { type: 'string', description: 'Text content for the PDF' }, author: { type: 'string', description: 'Author name' } }, required: ['file', 'content'] },
    composable: true,
    source: 'builtin',
  },
  {
    id: 'docx_create',
    name: 'Create Word Document',
    description: 'Create a DOCX (Word) document',
    modelDescription: 'Create a .docx Word document with text content. Each newline becomes a paragraph.',
    category: 'documents',
    riskLevel: 'medium',
    schema: { type: 'object', properties: { file: { type: 'string', description: 'Output .docx file path' }, title: { type: 'string', description: 'Document title' }, content: { type: 'string', description: 'Document text content' }, author: { type: 'string', description: 'Author name' } }, required: ['file', 'content'] },
    composable: true,
    source: 'builtin',
  },
  {
    id: 'pptx_create',
    name: 'Create Presentation',
    description: 'Create a PPTX (PowerPoint) presentation',
    modelDescription: 'Create a .pptx presentation. Provide slides array with title and content for each slide.',
    category: 'documents',
    riskLevel: 'medium',
    schema: { type: 'object', properties: { file: { type: 'string', description: 'Output .pptx file path' }, title: { type: 'string', description: 'Presentation title' }, slides: { type: 'array', description: 'Array of {title, content} objects for each slide' } }, required: ['file', 'slides'] },
    composable: true,
    source: 'builtin',
  },
  {
    id: 'xlsx_create',
    name: 'Create Spreadsheet',
    description: 'Create an XLSX (Excel) spreadsheet',
    modelDescription: 'Create a .xlsx spreadsheet. Provide headers and rows arrays. Numbers are stored as numeric cells.',
    category: 'documents',
    riskLevel: 'medium',
    schema: { type: 'object', properties: { file: { type: 'string', description: 'Output .xlsx file path' }, sheet_name: { type: 'string', description: 'Sheet name (default: Sheet1)' }, headers: { type: 'array', description: 'Column headers' }, rows: { type: 'array', description: 'Array of row arrays (strings or numbers)' } }, required: ['file', 'headers', 'rows'] },
    composable: true,
    source: 'builtin',
  },
  {
    id: 'reminder_set',
    name: 'Set Reminder',
    description: 'Set a one-time reminder or a recurring task',
    modelDescription: 'Set a reminder or repeating task. For one-time: provide delay_seconds. For recurring: provide interval_minutes. The agent decides which based on user intent ("remind me in 5 min" = one-time, "remind me every hour" = recurring). Always determine timing from natural language — never ask the user for technical formats.',
    category: 'scheduler',
    riskLevel: 'low',
    schema: { type: 'object', properties: { name: { type: 'string', description: 'Short name for this reminder' }, message: { type: 'string', description: 'The reminder message to deliver when it fires' }, delay_seconds: { type: 'number', description: 'For one-time reminders: seconds from now until it fires' }, interval_minutes: { type: 'number', description: 'For recurring tasks: repeat interval in minutes' }, cron: { type: 'string', description: 'Advanced: cron expression (only if user explicitly provides schedule pattern)' } }, required: ['name', 'message'] },
    composable: true,
    source: 'builtin',
  },
  {
    id: 'reminder_list',
    name: 'List Reminders',
    description: 'List all active reminders and scheduled tasks',
    modelDescription: 'Show all active reminders, timers, and recurring tasks. Use when user asks what reminders are set.',
    category: 'scheduler',
    riskLevel: 'low',
    schema: { type: 'object', properties: {}, required: [] },
    composable: true,
    source: 'builtin',
  },
  {
    id: 'reminder_cancel',
    name: 'Cancel Reminder',
    description: 'Cancel/remove a reminder or scheduled task',
    modelDescription: 'Remove an active reminder or recurring task. Can match by name or ID.',
    category: 'scheduler',
    riskLevel: 'low',
    schema: { type: 'object', properties: { id: { type: 'string', description: 'ID of the reminder to cancel' }, name: { type: 'string', description: 'Name (or partial name) of the reminder to cancel' } }, required: [] },
    composable: true,
    source: 'builtin',
  },
];

/**
 * Creates a fully configured toolkit with registry + executor + handlers.
 */
export function createDefaultToolkit(scopePath: string): { registry: ToolRegistry; executor: ToolExecutor } {
  const registry = new ToolRegistry();
  const executor = new ToolExecutor(registry, scopePath);

  // Register definitions
  for (const tool of CORE_TOOLS) {
    registry.register(tool);
  }

  // Register handlers
  executor.registerHandler('file_read', fs.fileRead);
  executor.registerHandler('file_write', fs.fileWrite);
  executor.registerHandler('file_delete', fs.fileDelete);
  executor.registerHandler('folder_create', fs.folderCreate);
  executor.registerHandler('folder_delete', fs.folderDelete);
  executor.registerHandler('folder_list', fs.folderList);
  executor.registerHandler('folder_move', fs.folderMove);
  executor.registerHandler('shell_exec', shell.shellExec);
  executor.registerHandler('git_status', git.gitStatus);
  executor.registerHandler('git_diff', git.gitDiff);
  executor.registerHandler('git_commit', git.gitCommit);
  executor.registerHandler('git_add', git.gitAdd);
  executor.registerHandler('git_log', git.gitLog);
  executor.registerHandler('code_search', code.codeSearch);
  executor.registerHandler('code_replace', code.codeReplace);
  executor.registerHandler('code_insert', code.codeInsert);
  executor.registerHandler('code_definitions', code.codeDefinitions);
  executor.registerHandler('code_symbols', code.codeSymbols);
  executor.registerHandler('csv_create', documents.csvCreate);
  executor.registerHandler('pdf_create', documents.pdfCreate);
  executor.registerHandler('docx_create', documents.docxCreate);
  executor.registerHandler('pptx_create', documents.pptxCreate);
  executor.registerHandler('xlsx_create', documents.xlsxCreate);
  executor.registerHandler('reminder_set', scheduler.reminderSet);
  executor.registerHandler('reminder_list', scheduler.reminderList);
  executor.registerHandler('reminder_cancel', scheduler.reminderCancel);

  return { registry, executor };
}

export { CORE_TOOLS };
