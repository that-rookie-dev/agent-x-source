import type { ToolDefinition } from '@agentx/shared';
import { ToolRegistry } from './ToolRegistry.js';
import { ToolExecutor } from './ToolExecutor.js';
import * as fs from './builtin/filesystem.js';
import * as shell from './builtin/shell.js';
import * as git from './builtin/git.js';
import * as code from './builtin/code.js';
import * as documents from './builtin/documents.js';
import * as scheduler from './builtin/scheduler.js';
import * as subagent from './builtin/subagent.js';
import * as browser from './builtin/browser.js';
import * as containers from './builtin/containers.js';
import * as data from './builtin/data.js';
import * as database from './builtin/database.js';
import * as github from './builtin/github.js';
import * as mcp from './builtin/mcp.js';
import * as packages from './builtin/packages.js';
import * as system from './builtin/system.js';
import * as testing from './builtin/testing.js';
import * as web from './builtin/web.js';
import * as image from './builtin/image.js';
import * as project from './builtin/project.js';

// All tool definitions with schemas the model uses to invoke them
const CORE_TOOLS: ToolDefinition[] = [
  // ═══ FILESYSTEM ═══
  { id: 'file_read', name: 'Read File', description: 'Read the contents of a file', modelDescription: 'Read file contents. Use for examining code, config, or data files.', category: 'filesystem', riskLevel: 'low', schema: { type: 'object', properties: { path: { type: 'string', description: 'File path' } }, required: ['path'] }, composable: true, source: 'builtin' },
  { id: 'file_write', name: 'Write File', description: 'Write content to a file', modelDescription: 'Write/create a file with given content. Creates parent directories automatically.', category: 'filesystem', riskLevel: 'medium', schema: { type: 'object', properties: { path: { type: 'string', description: 'File path' }, content: { type: 'string', description: 'File content' } }, required: ['path', 'content'] }, composable: true, source: 'builtin' },
  { id: 'file_delete', name: 'Delete File', description: 'Delete a file', modelDescription: 'Delete a file at the given path.', category: 'filesystem', riskLevel: 'high', schema: { type: 'object', properties: { path: { type: 'string', description: 'File path to delete' } }, required: ['path'] }, composable: true, source: 'builtin' },
  { id: 'folder_create', name: 'Create Folder', description: 'Create a directory (recursive)', modelDescription: 'Create a directory and any parent directories.', category: 'filesystem', riskLevel: 'low', schema: { type: 'object', properties: { path: { type: 'string', description: 'Directory path' } }, required: ['path'] }, composable: true, source: 'builtin' },
  { id: 'folder_list', name: 'List Directory', description: 'List contents of a directory', modelDescription: 'List files and folders in a directory.', category: 'filesystem', riskLevel: 'low', schema: { type: 'object', properties: { path: { type: 'string', description: 'Directory path (default: .)' } }, required: [] }, composable: true, source: 'builtin' },
  { id: 'folder_delete', name: 'Delete Folder', description: 'Delete a directory recursively', modelDescription: 'Delete a directory and all its contents.', category: 'filesystem', riskLevel: 'critical', schema: { type: 'object', properties: { path: { type: 'string', description: 'Directory path' } }, required: ['path'] }, composable: true, source: 'builtin' },
  { id: 'folder_move', name: 'Move/Rename', description: 'Move or rename a file or directory', modelDescription: 'Move or rename a file or directory.', category: 'filesystem', riskLevel: 'medium', schema: { type: 'object', properties: { from: { type: 'string', description: 'Source path' }, to: { type: 'string', description: 'Destination path' } }, required: ['from', 'to'] }, composable: true, source: 'builtin' },
  { id: 'file_find', name: 'Find Files', description: 'Find files by name pattern', modelDescription: 'Search for files by glob name pattern (e.g. "*.ts", "config*"). Excludes node_modules and .git.', category: 'filesystem', riskLevel: 'low', schema: { type: 'object', properties: { pattern: { type: 'string', description: 'File name glob (e.g. "*.ts", "README*")' }, path: { type: 'string', description: 'Directory to search (default: .)' } }, required: ['pattern'] }, composable: true, source: 'builtin' },

  // ═══ SHELL & PROCESS ═══
  { id: 'shell_exec', name: 'Execute Command', description: 'Run a shell command', modelDescription: 'Execute a shell command. Returns stdout/stderr. Use for builds, installs, tests.', category: 'shell_process', riskLevel: 'high', schema: { type: 'object', properties: { command: { type: 'string', description: 'Shell command' }, cwd: { type: 'string', description: 'Working directory (optional)' }, timeout: { type: 'number', description: 'Timeout ms (default: 30000)' } }, required: ['command'] }, composable: true, source: 'builtin' },
  { id: 'shell_background', name: 'Background Process', description: 'Start a long-running background process', modelDescription: 'Start a detached background process (dev server, watcher). Returns PID.', category: 'shell_process', riskLevel: 'high', schema: { type: 'object', properties: { command: { type: 'string', description: 'Command to run' }, cwd: { type: 'string', description: 'Working directory' } }, required: ['command'] }, composable: true, source: 'builtin' },
  { id: 'process_kill', name: 'Kill Process', description: 'Kill a process by PID', modelDescription: 'Send signal to terminate a process.', category: 'shell_process', riskLevel: 'high', schema: { type: 'object', properties: { pid: { type: 'number', description: 'Process ID' }, signal: { type: 'string', description: 'Signal (default: SIGTERM)' } }, required: ['pid'] }, composable: true, source: 'builtin' },
  { id: 'process_list', name: 'List Processes', description: 'List running processes', modelDescription: 'Show running processes with PID, CPU%, MEM%, and command.', category: 'shell_process', riskLevel: 'low', schema: { type: 'object', properties: {}, required: [] }, composable: true, source: 'builtin' },

  // ═══ GIT & VCS ═══
  { id: 'git_status', name: 'Git Status', description: 'Show repository status', modelDescription: 'Show modified, staged, and untracked files.', category: 'git_vcs', riskLevel: 'low', schema: { type: 'object', properties: {}, required: [] }, composable: true, source: 'builtin' },
  { id: 'git_diff', name: 'Git Diff', description: 'Show changes', modelDescription: 'Show uncommitted changes or diff against a ref.', category: 'git_vcs', riskLevel: 'low', schema: { type: 'object', properties: { ref: { type: 'string', description: 'Ref to diff against' }, path: { type: 'string', description: 'File to diff' } }, required: [] }, composable: true, source: 'builtin' },
  { id: 'git_log', name: 'Git Log', description: 'Show commit history', modelDescription: 'Show recent commits with hashes and messages.', category: 'git_vcs', riskLevel: 'low', schema: { type: 'object', properties: { count: { type: 'number', description: 'Number of commits (default: 10)' }, oneline: { type: 'boolean', description: 'One-line format (default: true)' } }, required: [] }, composable: true, source: 'builtin' },
  { id: 'git_commit', name: 'Git Commit', description: 'Stage and commit', modelDescription: 'Stage files and commit with a message.', category: 'git_vcs', riskLevel: 'medium', schema: { type: 'object', properties: { message: { type: 'string', description: 'Commit message' }, files: { type: 'string', description: 'Files to stage (space-separated, or "." for all)' } }, required: ['message'] }, composable: true, source: 'builtin' },
  { id: 'git_add', name: 'Git Add', description: 'Stage files', modelDescription: 'Stage files for commit.', category: 'git_vcs', riskLevel: 'low', schema: { type: 'object', properties: { files: { type: 'string', description: 'Files to stage (space-separated, or ".")' } }, required: ['files'] }, composable: true, source: 'builtin' },
  { id: 'git_branch', name: 'Git Branch', description: 'Manage branches', modelDescription: 'List, create, or delete branches.', category: 'git_vcs', riskLevel: 'medium', schema: { type: 'object', properties: { name: { type: 'string', description: 'Branch name (omit to list)' }, delete: { type: 'boolean', description: 'Delete branch' } }, required: [] }, composable: true, source: 'builtin' },
  { id: 'git_checkout', name: 'Git Checkout', description: 'Switch branches', modelDescription: 'Switch to a branch, tag, or commit.', category: 'git_vcs', riskLevel: 'medium', schema: { type: 'object', properties: { target: { type: 'string', description: 'Branch/tag/commit' } }, required: ['target'] }, composable: true, source: 'builtin' },
  { id: 'git_stash', name: 'Git Stash', description: 'Stash changes', modelDescription: 'Stash or restore changes. Actions: push, pop, list, drop.', category: 'git_vcs', riskLevel: 'medium', schema: { type: 'object', properties: { action: { type: 'string', description: 'Action: push, pop, list, drop (default: push)' } }, required: [] }, composable: true, source: 'builtin' },
  { id: 'git_blame', name: 'Git Blame', description: 'Show line authorship', modelDescription: 'Show who last modified each line. Optional line range.', category: 'git_vcs', riskLevel: 'low', schema: { type: 'object', properties: { file: { type: 'string', description: 'File path' }, startLine: { type: 'number', description: 'Start line' }, endLine: { type: 'number', description: 'End line' } }, required: ['file'] }, composable: true, source: 'builtin' },
  { id: 'git_show', name: 'Git Show', description: 'Show commit details', modelDescription: 'Show commit message, author, and changed files.', category: 'git_vcs', riskLevel: 'low', schema: { type: 'object', properties: { ref: { type: 'string', description: 'Commit ref (default: HEAD)' } }, required: [] }, composable: true, source: 'builtin' },
  { id: 'git_push', name: 'Git Push', description: 'Push commits to remote', modelDescription: 'Push local commits to a remote repository.', category: 'git_vcs', riskLevel: 'high', schema: { type: 'object', properties: { remote: { type: 'string', description: 'Remote name (default: origin)' }, branch: { type: 'string', description: 'Branch to push (default: current)' } }, required: [] }, composable: true, source: 'builtin' },
  { id: 'git_pull', name: 'Git Pull', description: 'Pull changes from remote', modelDescription: 'Pull and merge changes from remote.', category: 'git_vcs', riskLevel: 'medium', schema: { type: 'object', properties: { remote: { type: 'string', description: 'Remote name (default: origin)' }, branch: { type: 'string', description: 'Branch to pull (default: current)' } }, required: [] }, composable: true, source: 'builtin' },
  { id: 'git_merge', name: 'Git Merge', description: 'Merge a branch', modelDescription: 'Merge another branch into the current branch.', category: 'git_vcs', riskLevel: 'high', schema: { type: 'object', properties: { branch: { type: 'string', description: 'Branch to merge' }, no_ff: { type: 'boolean', description: 'No fast-forward (create merge commit)' } }, required: ['branch'] }, composable: true, source: 'builtin' },

  // ═══ CODE INTELLIGENCE ═══
  { id: 'code_search', name: 'Search Code', description: 'Search for text/regex in code', modelDescription: 'Search code files for a pattern. Returns matching lines with paths and line numbers.', category: 'code_intelligence', riskLevel: 'low', schema: { type: 'object', properties: { pattern: { type: 'string', description: 'Search pattern' }, path: { type: 'string', description: 'Directory (default: .)' }, glob: { type: 'string', description: 'File glob (e.g. "*.ts")' } }, required: ['pattern'] }, composable: true, source: 'builtin' },
  { id: 'code_replace', name: 'Replace in File', description: 'Find and replace in a file', modelDescription: 'Replace a unique string in a file. Must match exactly once.', category: 'code_intelligence', riskLevel: 'medium', schema: { type: 'object', properties: { path: { type: 'string', description: 'File path' }, search: { type: 'string', description: 'Text to find (unique)' }, replace: { type: 'string', description: 'Replacement text' } }, required: ['path', 'search', 'replace'] }, composable: true, source: 'builtin' },
  { id: 'code_insert', name: 'Insert in File', description: 'Insert text at a line', modelDescription: 'Insert content at a line number. Line 0 = beginning.', category: 'code_intelligence', riskLevel: 'medium', schema: { type: 'object', properties: { file: { type: 'string', description: 'File path' }, line: { type: 'number', description: 'Line number (0-based)' }, content: { type: 'string', description: 'Content to insert' } }, required: ['file', 'line', 'content'] }, composable: true, source: 'builtin' },
  { id: 'code_definitions', name: 'Find Definitions', description: 'List definitions in a file', modelDescription: 'Scan a source file for top-level definitions. Supports TS, JS, Python, Rust, Go.', category: 'code_intelligence', riskLevel: 'low', schema: { type: 'object', properties: { file: { type: 'string', description: 'File path' } }, required: ['file'] }, composable: true, source: 'builtin' },
  { id: 'code_symbols', name: 'List Symbols', description: 'List all symbols in a file', modelDescription: 'List code symbols with kind and line number.', category: 'code_intelligence', riskLevel: 'low', schema: { type: 'object', properties: { file: { type: 'string', description: 'File path' } }, required: ['file'] }, composable: true, source: 'builtin' },
  { id: 'file_patch', name: 'Multi-Edit File', description: 'Apply multiple edits to a file atomically', modelDescription: 'Apply multiple search-and-replace edits to a single file. Each edit must have a unique search string. More efficient than multiple code_replace calls.', category: 'code_intelligence', riskLevel: 'medium', schema: { type: 'object', properties: { file: { type: 'string', description: 'File path' }, edits: { type: 'array', description: 'Array of {search, replace} objects' } }, required: ['file', 'edits'] }, composable: true, source: 'builtin' },

  // ═══ DOCUMENTS ═══
  { id: 'csv_create', name: 'Create CSV', description: 'Create a CSV file', modelDescription: 'Create a CSV file. Provide headers + rows, or raw content.', category: 'documents', riskLevel: 'medium', schema: { type: 'object', properties: { file: { type: 'string', description: 'Output path' }, headers: { type: 'array', description: 'Column headers' }, rows: { type: 'array', description: 'Row arrays' }, content: { type: 'string', description: 'Raw CSV (alternative)' } }, required: ['file'] }, composable: true, source: 'builtin' },
  { id: 'pdf_create', name: 'Create PDF', description: 'Create a PDF document', modelDescription: 'Create a PDF with text content. Supports title, author.', category: 'documents', riskLevel: 'medium', schema: { type: 'object', properties: { file: { type: 'string', description: 'Output path' }, title: { type: 'string', description: 'Title' }, content: { type: 'string', description: 'Text content' }, author: { type: 'string', description: 'Author' } }, required: ['file', 'content'] }, composable: true, source: 'builtin' },
  { id: 'docx_create', name: 'Create Word Doc', description: 'Create a DOCX document', modelDescription: 'Create a .docx Word document.', category: 'documents', riskLevel: 'medium', schema: { type: 'object', properties: { file: { type: 'string', description: 'Output path' }, title: { type: 'string', description: 'Title' }, content: { type: 'string', description: 'Text content' }, author: { type: 'string', description: 'Author' } }, required: ['file', 'content'] }, composable: true, source: 'builtin' },
  { id: 'pptx_create', name: 'Create Presentation', description: 'Create a PPTX presentation', modelDescription: 'Create a .pptx with slides [{title, content}].', category: 'documents', riskLevel: 'medium', schema: { type: 'object', properties: { file: { type: 'string', description: 'Output path' }, title: { type: 'string', description: 'Presentation title' }, slides: { type: 'array', description: 'Array of {title, content}' } }, required: ['file', 'slides'] }, composable: true, source: 'builtin' },
  { id: 'xlsx_create', name: 'Create Spreadsheet', description: 'Create an XLSX spreadsheet', modelDescription: 'Create a .xlsx with headers and rows.', category: 'documents', riskLevel: 'medium', schema: { type: 'object', properties: { file: { type: 'string', description: 'Output path' }, sheet_name: { type: 'string', description: 'Sheet name' }, headers: { type: 'array', description: 'Column headers' }, rows: { type: 'array', description: 'Row arrays' } }, required: ['file', 'headers', 'rows'] }, composable: true, source: 'builtin' },

  // ═══ SCHEDULER ═══
  { id: 'reminder_set', name: 'Set Reminder', description: 'Set a reminder or recurring task', modelDescription: 'Set a reminder. One-time: delay_seconds. Recurring: interval_seconds (for sub-minute) or interval_minutes. Use interval_seconds for anything less than 60s.', category: 'scheduler', riskLevel: 'low', schema: { type: 'object', properties: { name: { type: 'string', description: 'Short name' }, message: { type: 'string', description: 'Reminder message' }, delay_seconds: { type: 'number', description: 'Seconds until fire (one-time)' }, interval_seconds: { type: 'number', description: 'Interval in seconds (recurring, sub-minute)' }, interval_minutes: { type: 'number', description: 'Interval in minutes (recurring)' }, cron: { type: 'string', description: 'Cron expression (advanced)' } }, required: ['name', 'message'] }, composable: true, source: 'builtin' },
  { id: 'reminder_list', name: 'List Reminders', description: 'List active reminders', modelDescription: 'Show all active reminders and recurring tasks.', category: 'scheduler', riskLevel: 'low', schema: { type: 'object', properties: {}, required: [] }, composable: true, source: 'builtin' },
  { id: 'reminder_cancel', name: 'Cancel Reminder', description: 'Cancel a reminder', modelDescription: 'Remove a reminder by ID or name.', category: 'scheduler', riskLevel: 'low', schema: { type: 'object', properties: { id: { type: 'string', description: 'Reminder ID' }, name: { type: 'string', description: 'Reminder name (partial match)' } }, required: [] }, composable: true, source: 'builtin' },

  // ═══ SUB-AGENTS ═══
  { id: 'sub_agent_spawn', name: 'Spawn Sub-Agent', description: 'Delegate a task to a background sub-agent', modelDescription: 'Spawn a background sub-agent to handle a complex task independently. Use for research, analysis, or any task that can run in parallel. The sub-agent gets its own LLM context.', category: 'agent_orchestration', riskLevel: 'medium', schema: { type: 'object', properties: { instruction: { type: 'string', description: 'Detailed instruction for the sub-agent' }, tools: { type: 'string', description: 'Comma-separated tool IDs the sub-agent can use' }, timeout: { type: 'number', description: 'Timeout in ms (default: 60000)' } }, required: ['instruction'] }, composable: true, source: 'builtin' },
  { id: 'sub_agent_status', name: 'Sub-Agent Status', description: 'Check status of running sub-agents', modelDescription: 'Check status of a specific sub-agent by ID, or list all running sub-agents.', category: 'agent_orchestration', riskLevel: 'low', schema: { type: 'object', properties: { agent_id: { type: 'string', description: 'Agent ID (optional — omit to list all)' } }, required: [] }, composable: true, source: 'builtin' },
  { id: 'sub_agent_cancel', name: 'Cancel Sub-Agent', description: 'Cancel a running sub-agent', modelDescription: 'Cancel and abort a running sub-agent by its ID.', category: 'agent_orchestration', riskLevel: 'low', schema: { type: 'object', properties: { agent_id: { type: 'string', description: 'Agent ID to cancel' } }, required: ['agent_id'] }, composable: true, source: 'builtin' },

  // ═══ BROWSER ═══
  { id: 'browser_open', name: 'Open Web Page', description: 'Open URL in headless browser', modelDescription: 'Open a URL, return page title and text content.', category: 'browser_automation', riskLevel: 'medium', schema: { type: 'object', properties: { url: { type: 'string', description: 'URL to open' } }, required: ['url'] }, composable: true, source: 'builtin' },
  { id: 'browser_screenshot', name: 'Screenshot Page', description: 'Screenshot a web page', modelDescription: 'Capture full-page screenshot of a URL.', category: 'browser_automation', riskLevel: 'medium', schema: { type: 'object', properties: { url: { type: 'string', description: 'URL' }, output: { type: 'string', description: 'Output file (default: screenshot.png)' } }, required: ['url'] }, composable: true, source: 'builtin' },
  { id: 'browser_click', name: 'Click Element', description: 'Click an element on a page', modelDescription: 'Navigate to URL and click a CSS selector.', category: 'browser_automation', riskLevel: 'medium', schema: { type: 'object', properties: { url: { type: 'string', description: 'URL' }, selector: { type: 'string', description: 'CSS selector' } }, required: ['url', 'selector'] }, composable: true, source: 'builtin' },
  { id: 'browser_eval', name: 'Evaluate JS', description: 'Run JavaScript on a page', modelDescription: 'Evaluate a JS expression in page context.', category: 'browser_automation', riskLevel: 'high', schema: { type: 'object', properties: { url: { type: 'string', description: 'URL' }, expression: { type: 'string', description: 'JS expression' } }, required: ['url', 'expression'] }, composable: true, source: 'builtin' },

  // ═══ CONTAINERS ═══
  { id: 'container_list', name: 'List Containers', description: 'List Docker containers', modelDescription: 'List all Docker containers with status and ports.', category: 'containers_infra', riskLevel: 'low', schema: { type: 'object', properties: {}, required: [] }, composable: true, source: 'builtin' },
  { id: 'container_logs', name: 'Container Logs', description: 'View container logs', modelDescription: 'Get logs from a Docker container.', category: 'containers_infra', riskLevel: 'low', schema: { type: 'object', properties: { name: { type: 'string', description: 'Container name/ID' }, tail: { type: 'number', description: 'Lines (default: 50)' } }, required: ['name'] }, composable: true, source: 'builtin' },
  { id: 'container_start', name: 'Start Container', description: 'Start a container', modelDescription: 'Start a stopped Docker container.', category: 'containers_infra', riskLevel: 'medium', schema: { type: 'object', properties: { name: { type: 'string', description: 'Container name/ID' } }, required: ['name'] }, composable: true, source: 'builtin' },
  { id: 'container_stop', name: 'Stop Container', description: 'Stop a container', modelDescription: 'Stop a running Docker container.', category: 'containers_infra', riskLevel: 'medium', schema: { type: 'object', properties: { name: { type: 'string', description: 'Container name/ID' } }, required: ['name'] }, composable: true, source: 'builtin' },
  { id: 'container_exec', name: 'Exec in Container', description: 'Run command in container', modelDescription: 'Execute a command inside a running container.', category: 'containers_infra', riskLevel: 'high', schema: { type: 'object', properties: { name: { type: 'string', description: 'Container name/ID' }, command: { type: 'string', description: 'Command' } }, required: ['name', 'command'] }, composable: true, source: 'builtin' },
  { id: 'container_run', name: 'Run Container', description: 'Run new container from image', modelDescription: 'Start a new container from a Docker image with port/env config.', category: 'containers_infra', riskLevel: 'high', schema: { type: 'object', properties: { image: { type: 'string', description: 'Docker image' }, name: { type: 'string', description: 'Container name' }, ports: { type: 'string', description: 'Port mapping (e.g. "8080:80")' }, env: { type: 'string', description: 'Env vars (KEY=VAL,KEY=VAL)' }, detach: { type: 'boolean', description: 'Background (default: true)' } }, required: ['image'] }, composable: true, source: 'builtin' },
  { id: 'container_compose', name: 'Docker Compose', description: 'Run docker compose commands', modelDescription: 'Docker compose: up, down, ps, logs, restart.', category: 'containers_infra', riskLevel: 'medium', schema: { type: 'object', properties: { action: { type: 'string', description: 'Action: up, down, ps, logs, restart' }, services: { type: 'string', description: 'Services (space-separated)' } }, required: ['action'] }, composable: true, source: 'builtin' },
  { id: 'container_images', name: 'List Images', description: 'List Docker images', modelDescription: 'List locally available Docker images.', category: 'containers_infra', riskLevel: 'low', schema: { type: 'object', properties: {}, required: [] }, composable: true, source: 'builtin' },

  // ═══ DATA PROCESSING ═══
  { id: 'json_parse', name: 'Parse JSON', description: 'Parse JSON from file or string', modelDescription: 'Parse and pretty-print JSON from a file or raw string.', category: 'data_processing', riskLevel: 'low', schema: { type: 'object', properties: { file: { type: 'string', description: 'JSON file path' }, input: { type: 'string', description: 'Raw JSON string' } }, required: [] }, composable: true, source: 'builtin' },
  { id: 'json_query', name: 'Query JSON', description: 'Query value from JSON by path', modelDescription: 'Extract a value from JSON using dot notation.', category: 'data_processing', riskLevel: 'low', schema: { type: 'object', properties: { file: { type: 'string', description: 'JSON file' }, path: { type: 'string', description: 'Dot path (e.g. "users.0.name")' } }, required: ['file', 'path'] }, composable: true, source: 'builtin' },
  { id: 'json_set', name: 'Set JSON Value', description: 'Set a value in a JSON file', modelDescription: 'Set a value at a dot-notation path in a JSON file.', category: 'data_processing', riskLevel: 'medium', schema: { type: 'object', properties: { file: { type: 'string', description: 'JSON file' }, path: { type: 'string', description: 'Dot path' }, value: { type: 'string', description: 'Value (JSON-encoded)' } }, required: ['file', 'path', 'value'] }, composable: true, source: 'builtin' },
  { id: 'csv_parse', name: 'Parse CSV', description: 'Parse a CSV file', modelDescription: 'Parse CSV into structured data with headers and rows.', category: 'data_processing', riskLevel: 'low', schema: { type: 'object', properties: { file: { type: 'string', description: 'CSV file path' }, delimiter: { type: 'string', description: 'Delimiter (default: ,)' }, limit: { type: 'number', description: 'Max rows' } }, required: ['file'] }, composable: true, source: 'builtin' },
  { id: 'text_transform', name: 'Transform Text', description: 'Apply text transformations', modelDescription: 'Transform text: uppercase, lowercase, trim, lines, words, chars, reverse, base64_encode, base64_decode.', category: 'data_processing', riskLevel: 'low', schema: { type: 'object', properties: { input: { type: 'string', description: 'Text input' }, operation: { type: 'string', description: 'Operation name' } }, required: ['input', 'operation'] }, composable: true, source: 'builtin' },

  // ═══ DATABASE ═══
  { id: 'db_query', name: 'Database Query', description: 'Execute SQL on SQLite', modelDescription: 'Run a SQL query against a SQLite database file.', category: 'database', riskLevel: 'medium', schema: { type: 'object', properties: { database: { type: 'string', description: 'Path to .db file' }, query: { type: 'string', description: 'SQL query' } }, required: ['database', 'query'] }, composable: true, source: 'builtin' },
  { id: 'db_schema', name: 'Database Schema', description: 'Inspect database schema', modelDescription: 'Show tables and schema of a SQLite database.', category: 'database', riskLevel: 'low', schema: { type: 'object', properties: { database: { type: 'string', description: 'Path to .db file' }, table: { type: 'string', description: 'Table name (optional)' } }, required: ['database'] }, composable: true, source: 'builtin' },
  { id: 'db_export', name: 'Database Export', description: 'Export table to CSV/TSV', modelDescription: 'Export a table to CSV or TSV format.', category: 'database', riskLevel: 'low', schema: { type: 'object', properties: { database: { type: 'string', description: 'Path to .db file' }, table: { type: 'string', description: 'Table name' }, format: { type: 'string', description: 'csv or tsv' } }, required: ['database', 'table'] }, composable: true, source: 'builtin' },
  { id: 'env_read', name: 'Read .env', description: 'Read .env file', modelDescription: 'Read a .env file (values masked for security).', category: 'database', riskLevel: 'low', schema: { type: 'object', properties: { file: { type: 'string', description: '.env file path (default: .env)' } }, required: [] }, composable: true, source: 'builtin' },

  // ═══ GITHUB ═══
  { id: 'gh_issue_list', name: 'List Issues', description: 'List GitHub issues', modelDescription: 'List GitHub issues. Requires gh CLI.', category: 'communication', riskLevel: 'low', schema: { type: 'object', properties: { state: { type: 'string', description: 'open, closed, all' }, limit: { type: 'number', description: 'Max results' } }, required: [] }, composable: true, source: 'builtin' },
  { id: 'gh_issue_create', name: 'Create Issue', description: 'Create GitHub issue', modelDescription: 'Create a new GitHub issue.', category: 'communication', riskLevel: 'medium', schema: { type: 'object', properties: { title: { type: 'string', description: 'Issue title' }, body: { type: 'string', description: 'Issue body' } }, required: ['title'] }, composable: true, source: 'builtin' },
  { id: 'gh_pr_list', name: 'List PRs', description: 'List pull requests', modelDescription: 'List pull requests for the repo.', category: 'communication', riskLevel: 'low', schema: { type: 'object', properties: { state: { type: 'string', description: 'open, closed, merged, all' }, limit: { type: 'number', description: 'Max results' } }, required: [] }, composable: true, source: 'builtin' },
  { id: 'gh_pr_create', name: 'Create PR', description: 'Create pull request', modelDescription: 'Create a PR from current branch.', category: 'communication', riskLevel: 'medium', schema: { type: 'object', properties: { title: { type: 'string', description: 'PR title' }, body: { type: 'string', description: 'PR description' }, base: { type: 'string', description: 'Base branch (default: main)' } }, required: ['title'] }, composable: true, source: 'builtin' },
  { id: 'gh_pr_view', name: 'View PR', description: 'View pull request details', modelDescription: 'Get details of a PR by number.', category: 'communication', riskLevel: 'low', schema: { type: 'object', properties: { number: { type: 'number', description: 'PR number' } }, required: ['number'] }, composable: true, source: 'builtin' },
  { id: 'gh_repo_view', name: 'View Repo', description: 'View repository info', modelDescription: 'Show current repository info.', category: 'communication', riskLevel: 'low', schema: { type: 'object', properties: {}, required: [] }, composable: true, source: 'builtin' },
  { id: 'gh_workflow_list', name: 'Workflow Runs', description: 'List CI/CD runs', modelDescription: 'Show recent GitHub Actions workflow runs.', category: 'communication', riskLevel: 'low', schema: { type: 'object', properties: {}, required: [] }, composable: true, source: 'builtin' },
  { id: 'gh_release', name: 'Releases', description: 'List releases', modelDescription: 'List GitHub releases.', category: 'communication', riskLevel: 'low', schema: { type: 'object', properties: { action: { type: 'string', description: 'Action (default: list)' } }, required: [] }, composable: true, source: 'builtin' },

  // ═══ MCP ═══
  { id: 'mcp_call', name: 'MCP Tool Call', description: 'Call tool on MCP server', modelDescription: 'Call a tool on an external MCP server via stdio.', category: 'mcp_integration', riskLevel: 'medium', schema: { type: 'object', properties: { command: { type: 'string', description: 'MCP server command' }, args: { type: 'array', description: 'Command arguments' }, server: { type: 'string', description: 'Server name' }, method: { type: 'string', description: 'Method (e.g. tools/call)' }, params: { type: 'object', description: 'Method params' } }, required: ['command', 'method'] }, composable: true, source: 'builtin' },
  { id: 'mcp_list_tools', name: 'MCP List Tools', description: 'List MCP server tools', modelDescription: 'Discover tools on an MCP server.', category: 'mcp_integration', riskLevel: 'low', schema: { type: 'object', properties: { command: { type: 'string', description: 'MCP server command' }, args: { type: 'array', description: 'Command arguments' } }, required: ['command'] }, composable: true, source: 'builtin' },

  // ═══ PACKAGES ═══
  { id: 'package_install', name: 'Install Packages', description: 'Install dependencies', modelDescription: 'Install packages (auto-detects npm/pnpm/yarn).', category: 'package_managers', riskLevel: 'medium', schema: { type: 'object', properties: { packages: { type: 'string', description: 'Package names (space-separated)' }, dev: { type: 'boolean', description: 'As devDependency' } }, required: [] }, composable: true, source: 'builtin' },
  { id: 'package_remove', name: 'Remove Package', description: 'Remove a dependency', modelDescription: 'Uninstall packages from the project.', category: 'package_managers', riskLevel: 'medium', schema: { type: 'object', properties: { packages: { type: 'string', description: 'Packages to remove' } }, required: ['packages'] }, composable: true, source: 'builtin' },
  { id: 'package_list', name: 'List Dependencies', description: 'List project deps', modelDescription: 'Show all dependencies from package.json.', category: 'package_managers', riskLevel: 'low', schema: { type: 'object', properties: {}, required: [] }, composable: true, source: 'builtin' },
  { id: 'package_outdated', name: 'Outdated Packages', description: 'Check outdated deps', modelDescription: 'Show packages with newer versions available.', category: 'package_managers', riskLevel: 'low', schema: { type: 'object', properties: {}, required: [] }, composable: true, source: 'builtin' },
  { id: 'package_run', name: 'Run Script', description: 'Run package.json script', modelDescription: 'Run a script from package.json.', category: 'package_managers', riskLevel: 'medium', schema: { type: 'object', properties: { script: { type: 'string', description: 'Script name' } }, required: ['script'] }, composable: true, source: 'builtin' },

  // ═══ SYSTEM ═══
  { id: 'system_info', name: 'System Info', description: 'Get system information', modelDescription: 'Show OS, CPU, memory, Node.js version.', category: 'system_os', riskLevel: 'low', schema: { type: 'object', properties: {}, required: [] }, composable: true, source: 'builtin' },
  { id: 'system_disk', name: 'Disk Space', description: 'Show disk usage', modelDescription: 'Show filesystem disk space.', category: 'system_os', riskLevel: 'low', schema: { type: 'object', properties: {}, required: [] }, composable: true, source: 'builtin' },
  { id: 'system_env', name: 'Env Variables', description: 'List environment variables', modelDescription: 'List env vars (secrets masked). Supports filtering.', category: 'system_os', riskLevel: 'low', schema: { type: 'object', properties: { filter: { type: 'string', description: 'Filter substring' } }, required: [] }, composable: true, source: 'builtin' },
  { id: 'system_which', name: 'Which Command', description: 'Find command path', modelDescription: 'Check if a command exists and show its path.', category: 'system_os', riskLevel: 'low', schema: { type: 'object', properties: { command: { type: 'string', description: 'Command to find' } }, required: ['command'] }, composable: true, source: 'builtin' },
  { id: 'system_ports', name: 'Listening Ports', description: 'Show ports in use', modelDescription: 'List ports in use and their processes.', category: 'system_os', riskLevel: 'low', schema: { type: 'object', properties: {}, required: [] }, composable: true, source: 'builtin' },
  { id: 'system_tree_size', name: 'Directory Sizes', description: 'Show directory sizes', modelDescription: 'Show disk usage of directories.', category: 'system_os', riskLevel: 'low', schema: { type: 'object', properties: { path: { type: 'string', description: 'Path (default: .)' } }, required: [] }, composable: true, source: 'builtin' },
  { id: 'security_audit', name: 'Security Audit', description: 'Audit dependencies', modelDescription: 'Run npm/pnpm audit for vulnerabilities.', category: 'system_os', riskLevel: 'low', schema: { type: 'object', properties: { target: { type: 'string', description: 'Target path' } }, required: [] }, composable: true, source: 'builtin' },
  { id: 'security_secrets', name: 'Scan Secrets', description: 'Scan for leaked secrets', modelDescription: 'Grep codebase for API keys, tokens, passwords.', category: 'system_os', riskLevel: 'low', schema: { type: 'object', properties: {}, required: [] }, composable: true, source: 'builtin' },
  { id: 'file_checksum', name: 'File Checksum', description: 'Calculate file hash', modelDescription: 'Generate sha256/md5/sha1 checksum for a file.', category: 'system_os', riskLevel: 'low', schema: { type: 'object', properties: { file: { type: 'string', description: 'File path' }, algorithm: { type: 'string', description: 'sha256, md5, sha1 (default: sha256)' } }, required: ['file'] }, composable: true, source: 'builtin' },

  // ═══ TESTING ═══
  { id: 'test_run', name: 'Run Tests', description: 'Run test suite', modelDescription: 'Run tests (vitest). Optional file or pattern filter.', category: 'testing', riskLevel: 'low', schema: { type: 'object', properties: { file: { type: 'string', description: 'Test file' }, pattern: { type: 'string', description: 'Test name pattern' } }, required: [] }, composable: true, source: 'builtin' },
  { id: 'test_watch', name: 'Run Test File', description: 'Run single test file', modelDescription: 'Run a specific test file.', category: 'testing', riskLevel: 'low', schema: { type: 'object', properties: { file: { type: 'string', description: 'Test file path' } }, required: [] }, composable: true, source: 'builtin' },
  { id: 'test_coverage', name: 'Test Coverage', description: 'Run tests with coverage', modelDescription: 'Run tests and generate coverage report.', category: 'testing', riskLevel: 'low', schema: { type: 'object', properties: {}, required: [] }, composable: true, source: 'builtin' },
  { id: 'test_create', name: 'Generate Test', description: 'Scaffold test file', modelDescription: 'Generate a test file with stubs for a source file.', category: 'testing', riskLevel: 'medium', schema: { type: 'object', properties: { sourceFile: { type: 'string', description: 'Source file to test' } }, required: ['sourceFile'] }, composable: true, source: 'builtin' },

  // ═══ WEB & NETWORK ═══
  { id: 'http_get', name: 'HTTP GET', description: 'Make GET request', modelDescription: 'Fetch data from a URL via GET.', category: 'web_network', riskLevel: 'medium', schema: { type: 'object', properties: { url: { type: 'string', description: 'URL' }, headers: { type: 'object', description: 'Custom headers' } }, required: ['url'] }, composable: true, source: 'builtin' },
  { id: 'http_post', name: 'HTTP POST', description: 'Make POST request', modelDescription: 'Send a POST request with body.', category: 'web_network', riskLevel: 'medium', schema: { type: 'object', properties: { url: { type: 'string', description: 'URL' }, body: { type: 'string', description: 'Request body (JSON)' }, headers: { type: 'object', description: 'Custom headers' } }, required: ['url'] }, composable: true, source: 'builtin' },
  { id: 'http_request', name: 'HTTP Request', description: 'Generic HTTP request', modelDescription: 'HTTP request with any method. Returns status, headers, body.', category: 'web_network', riskLevel: 'medium', schema: { type: 'object', properties: { url: { type: 'string', description: 'URL' }, method: { type: 'string', description: 'HTTP method' }, headers: { type: 'object', description: 'Headers' }, body: { type: 'string', description: 'Body' } }, required: ['url', 'method'] }, composable: true, source: 'builtin' },
  { id: 'web_scrape', name: 'Scrape Page', description: 'Extract text from web page', modelDescription: 'Fetch page and extract text (HTML stripped).', category: 'web_network', riskLevel: 'medium', schema: { type: 'object', properties: { url: { type: 'string', description: 'URL' }, selector: { type: 'string', description: 'CSS selector (optional)' } }, required: ['url'] }, composable: true, source: 'builtin' },
  { id: 'web_search', name: 'Web Search', description: 'Search the web', modelDescription: 'Search the web via DuckDuckGo. Returns snippets and URLs.', category: 'web_network', riskLevel: 'low', schema: { type: 'object', properties: { query: { type: 'string', description: 'Search query' } }, required: ['query'] }, composable: true, source: 'builtin' },

  // ═══ IMAGE ═══
  { id: 'image_view', name: 'Image Info', description: 'Get image metadata', modelDescription: 'Show image dimensions, format, and file size.', category: 'media_image', riskLevel: 'low', schema: { type: 'object', properties: { file: { type: 'string', description: 'Image file path' } }, required: ['file'] }, composable: true, source: 'builtin' },
  { id: 'image_resize', name: 'Resize Image', description: 'Resize an image', modelDescription: 'Resize an image to specified width (and optionally height). Uses sips (macOS) or ImageMagick.', category: 'media_image', riskLevel: 'medium', schema: { type: 'object', properties: { file: { type: 'string', description: 'Image file path' }, width: { type: 'number', description: 'Target width in pixels' }, height: { type: 'number', description: 'Target height (optional, maintains aspect ratio)' }, output: { type: 'string', description: 'Output file path (default: overwrite)' } }, required: ['file', 'width'] }, composable: true, source: 'builtin' },
  { id: 'image_convert', name: 'Convert Image', description: 'Convert image format', modelDescription: 'Convert an image to a different format (png, jpg, webp, gif, bmp).', category: 'media_image', riskLevel: 'medium', schema: { type: 'object', properties: { file: { type: 'string', description: 'Source image path' }, format: { type: 'string', description: 'Target format: png, jpg, webp, gif, bmp' }, output: { type: 'string', description: 'Output path (optional)' } }, required: ['file', 'format'] }, composable: true, source: 'builtin' },

  // ═══ PROJECT ═══
  { id: 'project_detect', name: 'Detect Project', description: 'Auto-detect project type and tools', modelDescription: 'Detect language, framework, package manager, build tool, and test framework from project files.', category: 'project_management', riskLevel: 'low', schema: { type: 'object', properties: {}, required: [] }, composable: true, source: 'builtin' },
];

/**
 * Creates a fully configured toolkit with registry + executor + handlers.
 */
export function createDefaultToolkit(scopePath: string): { registry: ToolRegistry; executor: ToolExecutor } {
  const registry = new ToolRegistry();
  const executor = new ToolExecutor(registry, scopePath);

  // Register all tool definitions
  for (const tool of CORE_TOOLS) {
    registry.register(tool);
  }

  // ═══ Filesystem ═══
  executor.registerHandler('file_read', fs.fileRead);
  executor.registerHandler('file_write', fs.fileWrite);
  executor.registerHandler('file_delete', fs.fileDelete);
  executor.registerHandler('folder_create', fs.folderCreate);
  executor.registerHandler('folder_delete', fs.folderDelete);
  executor.registerHandler('folder_list', fs.folderList);
  executor.registerHandler('folder_move', fs.folderMove);
  executor.registerHandler('file_find', fs.fileFind);

  // ═══ Shell & Process ═══
  executor.registerHandler('shell_exec', shell.shellExec);
  executor.registerHandler('shell_background', shell.shellBackground);
  executor.registerHandler('process_kill', shell.processKill);
  executor.registerHandler('process_list', shell.processList);

  // ═══ Git ═══
  executor.registerHandler('git_status', git.gitStatus);
  executor.registerHandler('git_diff', git.gitDiff);
  executor.registerHandler('git_log', git.gitLog);
  executor.registerHandler('git_commit', git.gitCommit);
  executor.registerHandler('git_add', git.gitAdd);
  executor.registerHandler('git_branch', git.gitBranch);
  executor.registerHandler('git_checkout', git.gitCheckout);
  executor.registerHandler('git_stash', git.gitStash);
  executor.registerHandler('git_blame', git.gitBlame);
  executor.registerHandler('git_show', git.gitShow);
  executor.registerHandler('git_push', git.gitPush);
  executor.registerHandler('git_pull', git.gitPull);
  executor.registerHandler('git_merge', git.gitMerge);

  // ═══ Code Intelligence ═══
  executor.registerHandler('code_search', code.codeSearch);
  executor.registerHandler('code_replace', code.codeReplace);
  executor.registerHandler('code_insert', code.codeInsert);
  executor.registerHandler('code_definitions', code.codeDefinitions);
  executor.registerHandler('code_symbols', code.codeSymbols);
  executor.registerHandler('file_patch', code.filePatch);

  // ═══ Documents ═══
  executor.registerHandler('csv_create', documents.csvCreate);
  executor.registerHandler('pdf_create', documents.pdfCreate);
  executor.registerHandler('docx_create', documents.docxCreate);
  executor.registerHandler('pptx_create', documents.pptxCreate);
  executor.registerHandler('xlsx_create', documents.xlsxCreate);

  // ═══ Scheduler ═══
  executor.registerHandler('reminder_set', scheduler.reminderSet);
  executor.registerHandler('reminder_list', scheduler.reminderList);
  executor.registerHandler('reminder_cancel', scheduler.reminderCancel);

  // ═══ Sub-Agents ═══
  executor.registerHandler('sub_agent_spawn', subagent.subAgentSpawn);
  executor.registerHandler('sub_agent_status', subagent.subAgentStatus);
  executor.registerHandler('sub_agent_cancel', subagent.subAgentCancel);

  // ═══ Browser ═══
  executor.registerHandler('browser_open', browser.browserOpen);
  executor.registerHandler('browser_screenshot', browser.browserScreenshot);
  executor.registerHandler('browser_click', browser.browserClick);
  executor.registerHandler('browser_eval', browser.browserEval);

  // ═══ Containers ═══
  executor.registerHandler('container_list', containers.containerList);
  executor.registerHandler('container_logs', containers.containerLogs);
  executor.registerHandler('container_start', containers.containerStart);
  executor.registerHandler('container_stop', containers.containerStop);
  executor.registerHandler('container_exec', containers.containerExec);
  executor.registerHandler('container_run', containers.containerRun);
  executor.registerHandler('container_compose', containers.containerCompose);
  executor.registerHandler('container_images', containers.containerImages);

  // ═══ Data Processing ═══
  executor.registerHandler('json_parse', data.jsonParse);
  executor.registerHandler('json_query', data.jsonQuery);
  executor.registerHandler('json_set', data.jsonSet);
  executor.registerHandler('csv_parse', data.csvParse);
  executor.registerHandler('text_transform', data.textTransform);

  // ═══ Database ═══
  executor.registerHandler('db_query', database.dbQuery);
  executor.registerHandler('db_schema', database.dbSchema);
  executor.registerHandler('db_export', database.dbExport);
  executor.registerHandler('env_read', database.envRead);

  // ═══ GitHub ═══
  executor.registerHandler('gh_issue_list', github.ghIssueList);
  executor.registerHandler('gh_issue_create', github.ghIssueCreate);
  executor.registerHandler('gh_pr_list', github.ghPrList);
  executor.registerHandler('gh_pr_create', github.ghPrCreate);
  executor.registerHandler('gh_pr_view', github.ghPrView);
  executor.registerHandler('gh_repo_view', github.ghRepoView);
  executor.registerHandler('gh_workflow_list', github.ghWorkflowList);
  executor.registerHandler('gh_release', github.ghRelease);

  // ═══ MCP ═══
  executor.registerHandler('mcp_call', mcp.mcpCall);
  executor.registerHandler('mcp_list_tools', mcp.mcpListTools);

  // ═══ Packages ═══
  executor.registerHandler('package_install', packages.packageInstall);
  executor.registerHandler('package_remove', packages.packageRemove);
  executor.registerHandler('package_list', packages.packageList);
  executor.registerHandler('package_outdated', packages.packageOutdated);
  executor.registerHandler('package_run', packages.packageRun);

  // ═══ System ═══
  executor.registerHandler('system_info', system.systemInfo);
  executor.registerHandler('system_disk', system.systemDiskSpace);
  executor.registerHandler('system_env', system.systemEnv);
  executor.registerHandler('system_which', system.systemWhich);
  executor.registerHandler('system_ports', system.systemPorts);
  executor.registerHandler('system_tree_size', system.systemTreeSize);
  executor.registerHandler('security_audit', system.securityAudit);
  executor.registerHandler('security_secrets', system.securitySecrets);
  executor.registerHandler('file_checksum', system.fileChecksum);

  // ═══ Testing ═══
  executor.registerHandler('test_run', testing.testRun);
  executor.registerHandler('test_watch', testing.testWatch);
  executor.registerHandler('test_coverage', testing.testCoverage);
  executor.registerHandler('test_create', testing.testCreate);

  // ═══ Web ═══
  executor.registerHandler('http_get', web.httpGet);
  executor.registerHandler('http_post', web.httpPost);
  executor.registerHandler('http_request', web.httpRequest);
  executor.registerHandler('web_scrape', web.webScrape);
  executor.registerHandler('web_search', web.webSearch);

  // ═══ Image ═══
  executor.registerHandler('image_view', image.imageView);
  executor.registerHandler('image_resize', image.imageResize);
  executor.registerHandler('image_convert', image.imageConvert);

  // ═══ Project ═══
  executor.registerHandler('project_detect', project.projectDetect);

  return { registry, executor };
}

export { CORE_TOOLS };
