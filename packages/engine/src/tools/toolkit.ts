import type { ToolDefinition } from '@agentx/shared';
import { ToolRegistry } from './ToolRegistry.js';
import { ToolExecutor } from './ToolExecutor.js';
import * as fs from './builtin/filesystem.js';
import * as shell from './builtin/shell.js';
import * as git from './builtin/git.js';
import * as code from './builtin/code.js';
import * as documents from './builtin/documents.js';
import * as automation from './builtin/automation.js';
import * as agentXOverview from './builtin/agent-x-overview.js';
import * as channelPermissions from './builtin/channel-permissions.js';
import * as subagent from './builtin/subagent.js';
import * as crewdelegate from './builtin/delegate-to-crew.js';
import * as spawncrew from './builtin/spawn-crew-workers.js';
import * as crewmessage from './builtin/crew-message.js';
import * as searchcrewhub from './builtin/search-crew-hub.js';
import * as browser from './builtin/browser.js';
import * as containers from './builtin/containers.js';
import * as data from './builtin/data.js';
import * as database from './builtin/database.js';
import * as github from './builtin/github.js';
import * as packages from './builtin/packages.js';
import * as system from './builtin/system.js';
import * as testing from './builtin/testing.js';
import * as web from './builtin/web.js';
import * as deepWeb from './builtin/deep-web-search.js';
import * as image from './builtin/image.js';
import * as project from './builtin/project.js';
import * as ai from './builtin/ai.js';
import * as notifications from './builtin/notifications.js';
import * as markdownTool from './builtin/markdown.js';
import * as security from './builtin/security.js';
import * as ssh from './builtin/ssh.js';
import * as media from './builtin/media.js';
import * as build from './builtin/build.js';
import * as script from './builtin/script.js';
import * as aliases from './builtin/aliases.js';
import * as todo from './builtin/todo.js';
import { SUBAGENT_TYPES } from '../agent/subagent-types.js';

// All tool definitions with schemas the model uses to invoke them
const CORE_TOOLS: ToolDefinition[] = [
  // ═══ FILESYSTEM ═══
  { id: 'file_read', name: 'Read File', description: 'Read the contents of a file', modelDescription: 'Read file contents with line-level paging. Aliases: read_file, read, cat. Use offset/limit for sections.', category: 'filesystem', riskLevel: 'low', schema: { type: 'object', properties: { path: { type: 'string', description: 'File path relative to project root' }, offset: { type: 'number', description: 'Starting line number (0-based, default: 0)' }, limit: { type: 'number', description: 'Number of lines to return (default: all)' } }, required: ['path'] }, composable: true, source: 'builtin' },
  { id: 'read_file', name: 'Read File (alias)', description: 'Read file contents', modelDescription: 'Alias for file_read — read a file with optional line offset/limit.', category: 'filesystem', riskLevel: 'low', schema: { type: 'object', properties: { path: { type: 'string', description: 'File path' }, target_file: { type: 'string', description: 'File path (alias)' }, offset: { type: 'number', description: 'Start line (0-based)' }, limit: { type: 'number', description: 'Line count' } }, required: [] }, composable: true, source: 'builtin' },
  { id: 'read', name: 'Read', description: 'Read file (shorthand)', modelDescription: 'Shorthand alias for file_read.', category: 'filesystem', riskLevel: 'low', schema: { type: 'object', properties: { path: { type: 'string', description: 'File path' } }, required: ['path'] }, composable: true, source: 'builtin' },
  { id: 'cat', name: 'Cat File', description: 'Print file contents', modelDescription: 'Alias for file_read — like shell cat.', category: 'filesystem', riskLevel: 'low', schema: { type: 'object', properties: { path: { type: 'string', description: 'File path' } }, required: ['path'] }, composable: true, source: 'builtin' },
  { id: 'file_read_batch', name: 'Read Files (Batch)', description: 'Read many files at once with truncation', modelDescription: 'Read multiple files in a single call with per-file character limit. Returns a structured summary table and per-file contents (truncated to maxCharsPerFile). Use this when processing many files — it avoids exhausting context by limiting each file. After reviewing the summary, use file_read for full content of important files.', category: 'filesystem', riskLevel: 'low', schema: { type: 'object', properties: { paths: { type: 'array', items: { type: 'string', description: 'A file path' }, description: 'Array of file paths to read' }, maxCharsPerFile: { type: 'number', description: 'Max characters per file (default: 400, max: 2000)' }, maxFiles: { type: 'number', description: 'Max files to read (default: 50, max: 200)' } }, required: ['paths'] }, composable: true, source: 'builtin' },
  { id: 'file_write', name: 'Write File', description: 'Write content to a file', modelDescription: 'Write/create or append to a file. Alias: write_file.', category: 'filesystem', riskLevel: 'medium', schema: { type: 'object', properties: { path: { type: 'string', description: 'File path' }, content: { type: 'string', description: 'File content' }, mode: { type: 'string', description: 'Write mode: "overwrite" (default) or "append"' } }, required: ['path', 'content'] }, composable: true, source: 'builtin' },
  { id: 'write_file', name: 'Write File (alias)', description: 'Write file contents', modelDescription: 'Alias for file_write.', category: 'filesystem', riskLevel: 'medium', schema: { type: 'object', properties: { path: { type: 'string', description: 'File path' }, content: { type: 'string', description: 'Content to write' } }, required: ['path', 'content'] }, composable: true, source: 'builtin' },
  { id: 'file_delete', name: 'Delete File', description: 'Delete a file', modelDescription: 'Delete a file. Alias: delete_file.', category: 'filesystem', riskLevel: 'high', schema: { type: 'object', properties: { path: { type: 'string', description: 'File path to delete' } }, required: ['path'] }, composable: true, source: 'builtin' },
  { id: 'delete_file', name: 'Delete File (alias)', description: 'Delete a file', modelDescription: 'Alias for file_delete.', category: 'filesystem', riskLevel: 'high', schema: { type: 'object', properties: { path: { type: 'string', description: 'File path' } }, required: ['path'] }, composable: true, source: 'builtin' },
  { id: 'folder_create', name: 'Create Folder', description: 'Create a directory (recursive)', modelDescription: 'Create directory recursively. Alias: create_dir.', category: 'filesystem', riskLevel: 'low', schema: { type: 'object', properties: { path: { type: 'string', description: 'Directory path' } }, required: ['path'] }, composable: true, source: 'builtin' },
  { id: 'create_dir', name: 'Create Directory (alias)', description: 'Create a directory', modelDescription: 'Alias for folder_create.', category: 'filesystem', riskLevel: 'low', schema: { type: 'object', properties: { path: { type: 'string', description: 'Directory path' } }, required: ['path'] }, composable: true, source: 'builtin' },
  { id: 'folder_list', name: 'List Directory', description: 'List contents of a directory', modelDescription: 'List directory contents. Alias: list_dir.', category: 'filesystem', riskLevel: 'low', schema: { type: 'object', properties: { path: { type: 'string', description: 'Directory path (default: current directory)' } }, required: [] }, composable: true, source: 'builtin' },
  { id: 'list_dir', name: 'List Directory (alias)', description: 'List directory contents', modelDescription: 'Alias for folder_list.', category: 'filesystem', riskLevel: 'low', schema: { type: 'object', properties: { path: { type: 'string', description: 'Directory path' }, target_directory: { type: 'string', description: 'Directory path (alias)' } }, required: [] }, composable: true, source: 'builtin' },
  { id: 'folder_delete', name: 'Delete Folder', description: 'Delete a directory recursively', modelDescription: 'Delete a directory and all its contents.', category: 'filesystem', riskLevel: 'critical', schema: { type: 'object', properties: { path: { type: 'string', description: 'Directory path' } }, required: ['path'] }, composable: true, source: 'builtin' },
  { id: 'folder_move', name: 'Move/Rename', description: 'Move or rename a file or directory', modelDescription: 'Move or rename a file or directory.', category: 'filesystem', riskLevel: 'medium', schema: { type: 'object', properties: { from: { type: 'string', description: 'Source path' }, to: { type: 'string', description: 'Destination path' } }, required: ['from', 'to'] }, composable: true, source: 'builtin' },
  { id: 'file_find', name: 'Find Files', description: 'Find files by name pattern (case-insensitive)', modelDescription: 'Search for files by glob name pattern (e.g. "*.ts", "config*"). Case-insensitive. Excludes node_modules and .git. Alias: glob.', category: 'filesystem', riskLevel: 'low', schema: { type: 'object', properties: { pattern: { type: 'string', description: 'File name glob (e.g. "*.ts", "README*")' }, path: { type: 'string', description: 'Directory to search (default: .)' } }, required: ['pattern'] }, composable: true, source: 'builtin' },
  { id: 'glob', name: 'Glob Files', description: 'Find files matching a glob pattern', modelDescription: 'Find files by glob pattern (e.g. "**/*.ts", "src/**/*.tsx"). Same as file_find — use for discovering files by name. Read-only.', category: 'filesystem', riskLevel: 'low', schema: { type: 'object', properties: { pattern: { type: 'string', description: 'Glob pattern (e.g. "*.ts", "**/test/**")' }, path: { type: 'string', description: 'Directory to search (default: .)' } }, required: ['pattern'] }, composable: true, source: 'builtin' },
  { id: 'search_files', name: 'Search Files', description: 'Find files by glob or search contents', modelDescription: 'Smart search: glob patterns → file_find; text/regex → code_search.', category: 'filesystem', riskLevel: 'low', schema: { type: 'object', properties: { pattern: { type: 'string', description: 'Glob or search pattern' }, path: { type: 'string', description: 'Directory (default: .)' }, glob: { type: 'string', description: 'File type filter' } }, required: ['pattern'] }, composable: true, source: 'builtin' },
  { id: 'file_copy', name: 'Copy File', description: 'Copy a file or directory', modelDescription: 'Copy a file or directory from source to destination.', category: 'filesystem', riskLevel: 'medium', schema: { type: 'object', properties: { from: { type: 'string', description: 'Source path' }, to: { type: 'string', description: 'Destination path' } }, required: ['from', 'to'] }, composable: true, source: 'builtin' },
  { id: 'file_diff', name: 'Diff Files', description: 'Compare two files', modelDescription: 'Show line-by-line diff between two files.', category: 'filesystem', riskLevel: 'low', schema: { type: 'object', properties: { file1: { type: 'string', description: 'First file path' }, file2: { type: 'string', description: 'Second file path' } }, required: ['file1', 'file2'] }, composable: true, source: 'builtin' },
  { id: 'file_metadata', name: 'File Metadata', description: 'Show file/directory metadata', modelDescription: 'Show file size, permissions, modified time. Alias: file_info.', category: 'filesystem', riskLevel: 'low', schema: { type: 'object', properties: { path: { type: 'string', description: 'File or directory path' } }, required: ['path'] }, composable: true, source: 'builtin' },
  { id: 'file_info', name: 'File Info (alias)', description: 'Show file metadata', modelDescription: 'Alias for file_metadata.', category: 'filesystem', riskLevel: 'low', schema: { type: 'object', properties: { path: { type: 'string', description: 'File path' } }, required: ['path'] }, composable: true, source: 'builtin' },
  { id: 'file_open', name: 'Open File', description: 'Open a file in default editor', modelDescription: 'Open a file in the system default editor/application.', category: 'filesystem', riskLevel: 'medium', schema: { type: 'object', properties: { path: { type: 'string', description: 'File path to open' } }, required: ['path'] }, composable: true, source: 'builtin' },
  { id: 'folder_tree', name: 'Directory Tree', description: 'Show directory tree', modelDescription: 'Display a tree view of the directory structure with Unicode tree-drawing characters. Shows files and folders with proper indentation and nesting. Use this to understand the full project layout at a glance.', category: 'filesystem', riskLevel: 'low', schema: { type: 'object', properties: { path: { type: 'string', description: 'Directory path (default: current directory)' }, depth: { type: 'number', description: 'Max depth to traverse (default: 3, max: 6)' } }, required: [] }, composable: true, source: 'builtin' },
  { id: 'folder_open', name: 'Open Folder', description: 'Open directory in file manager', modelDescription: 'Open a directory in the system file manager (Finder, Explorer, Nautilus).', category: 'filesystem', riskLevel: 'medium', schema: { type: 'object', properties: { path: { type: 'string', description: 'Directory path' } }, required: ['path'] }, composable: true, source: 'builtin' },
  { id: 'archive_create', name: 'Create Archive', description: 'Create a tar/zip archive', modelDescription: 'Create a tar.gz or zip archive from files and directories.', category: 'filesystem', riskLevel: 'medium', schema: { type: 'object', properties: { output: { type: 'string', description: 'Archive path (.tar.gz or .zip)' }, source: { type: 'string', description: 'Source files/directories (space-separated)' }, format: { type: 'string', description: 'Format: tar.gz, zip (default: tar.gz)' } }, required: ['output', 'source'] }, composable: true, source: 'builtin' },
  { id: 'archive_extract', name: 'Extract Archive', description: 'Extract a tar/zip archive', modelDescription: 'Extract a tar.gz or zip archive to a directory.', category: 'filesystem', riskLevel: 'medium', schema: { type: 'object', properties: { archive: { type: 'string', description: 'Archive file path' }, output: { type: 'string', description: 'Output directory (default: same name as archive)' } }, required: ['archive'] }, composable: true, source: 'builtin' },

  // ═══ SHELL & PROCESS ═══
  { id: 'shell_exec', name: 'Execute Command', description: 'Run a shell command', modelDescription: 'Run shell commands. Aliases: bash, run_command, execute. For snippets use script_run.', category: 'shell_process', riskLevel: 'high', schema: { type: 'object', properties: { command: { type: 'string', description: 'Shell command' }, cwd: { type: 'string', description: 'Working directory (optional)' }, timeout: { type: 'number', description: 'Timeout ms (default: 30000, max: 600000)' }, maxLength: { type: 'number', description: 'Max output chars (default: 30000)' } }, required: ['command'] }, composable: true, source: 'builtin' },
  { id: 'bash', name: 'Bash (alias)', description: 'Run a shell command', modelDescription: 'Alias for shell_exec.', category: 'shell_process', riskLevel: 'high', schema: { type: 'object', properties: { command: { type: 'string', description: 'Shell command' }, cwd: { type: 'string', description: 'Working directory' } }, required: ['command'] }, composable: true, source: 'builtin' },
  { id: 'run_command', name: 'Run Command (alias)', description: 'Run a shell command', modelDescription: 'Alias for shell_exec.', category: 'shell_process', riskLevel: 'high', schema: { type: 'object', properties: { command: { type: 'string', description: 'Command' }, cmd: { type: 'string', description: 'Command (alias)' } }, required: [] }, composable: true, source: 'builtin' },
  { id: 'execute', name: 'Execute (alias)', description: 'Run a shell command', modelDescription: 'Alias for shell_exec.', category: 'shell_process', riskLevel: 'high', schema: { type: 'object', properties: { command: { type: 'string', description: 'Command' } }, required: ['command'] }, composable: true, source: 'builtin' },
  { id: 'shell_background', name: 'Background Process', description: 'Start a long-running background process', modelDescription: 'Start a detached background process (dev server, watcher). Returns PID.', category: 'shell_process', riskLevel: 'high', schema: { type: 'object', properties: { command: { type: 'string', description: 'Command to run' }, cwd: { type: 'string', description: 'Working directory' } }, required: ['command'] }, composable: true, source: 'builtin' },
  { id: 'process_kill', name: 'Kill Process', description: 'Kill a process by PID', modelDescription: 'Send signal to terminate a process.', category: 'shell_process', riskLevel: 'high', schema: { type: 'object', properties: { pid: { type: 'number', description: 'Process ID' }, signal: { type: 'string', description: 'Signal (default: SIGTERM)' } }, required: ['pid'] }, composable: true, source: 'builtin' },
  { id: 'process_list', name: 'List Processes', description: 'List running processes', modelDescription: 'Show running processes with PID, CPU%, MEM%, and command.', category: 'shell_process', riskLevel: 'low', schema: { type: 'object', properties: {}, required: [] }, composable: true, source: 'builtin' },
  { id: 'shell_exec_streaming', name: 'Stream Command Output', description: 'Run command with streaming output', modelDescription: 'Execute a shell command and stream output in real-time as it runs. Use for long-running commands where you want to see progress.', category: 'shell_process', riskLevel: 'high', schema: { type: 'object', properties: { command: { type: 'string', description: 'Shell command' }, cwd: { type: 'string', description: 'Working directory (optional)' }, maxLength: { type: 'number', description: 'Max output chars (default: 30000)' } }, required: ['command'] }, composable: false, source: 'builtin' },

  // ═══ SSH ═══
  { id: 'ssh_exec', name: 'SSH Execute Command', description: 'Run a command on a remote host via SSH', modelDescription: 'Execute a shell command on a remote server via SSH. Supports key-based auth. Use this to manage remote servers, deploy code, run diagnostics, or execute maintenance tasks.', category: 'shell_process', riskLevel: 'critical', schema: { type: 'object', properties: { host: { type: 'string', description: 'Remote hostname or IP address' }, command: { type: 'string', description: 'Shell command to execute on the remote host' }, user: { type: 'string', description: 'SSH user (default: root)' }, keyPath: { type: 'string', description: 'Path to SSH private key (default: ~/.ssh/id_ed25519 or id_rsa)' }, port: { type: 'number', description: 'SSH port (default: 22)' }, timeout: { type: 'number', description: 'Timeout in ms (default: 30000, max: 120000)' } }, required: ['host', 'command'] }, composable: true, source: 'builtin' },
  { id: 'ssh_scp', name: 'SSH File Transfer', description: 'Copy files to/from a remote host via SCP', modelDescription: 'Transfer files between local and remote hosts over SSH using SCP. Use direction "upload" (local→remote) or "download" (remote→local).', category: 'shell_process', riskLevel: 'critical', schema: { type: 'object', properties: { host: { type: 'string', description: 'Remote hostname or IP address' }, source: { type: 'string', description: 'Source file path' }, dest: { type: 'string', description: 'Destination file path' }, user: { type: 'string', description: 'SSH user (default: root)' }, keyPath: { type: 'string', description: 'Path to SSH private key' }, direction: { type: 'string', description: '"upload" (local→remote) or "download" (remote→local)' }, port: { type: 'number', description: 'SSH port (default: 22)' }, timeout: { type: 'number', description: 'Timeout in ms (default: 60000, max: 300000)' } }, required: ['host', 'source', 'dest'] }, composable: false, source: 'builtin' },
  { id: 'ssh_key_add', name: 'SSH Key Add', description: 'Configure an SSH key for remote access', modelDescription: 'Add or configure an SSH private key for authenticating to remote servers. Can either write a new key from content or ensure an existing key has correct permissions.', category: 'shell_process', riskLevel: 'high', schema: { type: 'object', properties: { keyPath: { type: 'string', description: 'Path to SSH private key' }, keyContent: { type: 'string', description: 'SSH private key content (optional — writes the file if provided)' } }, required: ['keyPath'] }, composable: false, source: 'builtin' },

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
  { id: 'git_init', name: 'Git Init', description: 'Initialize a git repository', modelDescription: 'Initialize a new git repository in the current directory.', category: 'git_vcs', riskLevel: 'low', schema: { type: 'object', properties: { bare: { type: 'boolean', description: 'Create bare repo' } }, required: [] }, composable: true, source: 'builtin' },
  { id: 'git_clone', name: 'Git Clone', description: 'Clone a remote repository', modelDescription: 'Clone a repository from a URL. Supports git, https, and ssh URLs.', category: 'git_vcs', riskLevel: 'medium', schema: { type: 'object', properties: { url: { type: 'string', description: 'Repository URL' }, directory: { type: 'string', description: 'Target directory (optional)' } }, required: ['url'] }, composable: true, source: 'builtin' },
  { id: 'git_remote', name: 'Git Remote', description: 'Manage remotes', modelDescription: 'List, add, remove, or get/set the URL of a remote repository.', category: 'git_vcs', riskLevel: 'medium', schema: { type: 'object', properties: { action: { type: 'string', description: 'Action: list, add, remove, set-url, get-url' }, name: { type: 'string', description: 'Remote name' }, url: { type: 'string', description: 'Remote URL (for add/set-url)' } }, required: [] }, composable: true, source: 'builtin' },
  { id: 'git_tag', name: 'Git Tag', description: 'Manage tags', modelDescription: 'List, create, or delete tags. Use message for annotated tags.', category: 'git_vcs', riskLevel: 'medium', schema: { type: 'object', properties: { name: { type: 'string', description: 'Tag name' }, message: { type: 'string', description: 'Tag message (for annotated tags)' }, delete: { type: 'boolean', description: 'Delete the tag' } }, required: [] }, composable: true, source: 'builtin' },
  { id: 'git_reset', name: 'Git Reset', description: 'Reset HEAD or working directory', modelDescription: 'Reset to a previous commit. Mode: soft (keep changes staged), mixed (keep changes unstaged), hard (discard changes).', category: 'git_vcs', riskLevel: 'high', schema: { type: 'object', properties: { target: { type: 'string', description: 'Target ref (default: HEAD)' }, mode: { type: 'string', description: 'Reset mode: soft, mixed, hard (default: mixed)' }, file: { type: 'string', description: 'File to unstage (optional)' } }, required: [] }, composable: true, source: 'builtin' },
  { id: 'git_cherry_pick', name: 'Git Cherry-Pick', description: 'Apply specific commits', modelDescription: 'Apply changes from specific commits to the current branch.', category: 'git_vcs', riskLevel: 'medium', schema: { type: 'object', properties: { commits: { type: 'string', description: 'Commit hash(es) to cherry-pick (space-separated)' } }, required: ['commits'] }, composable: true, source: 'builtin' },
  { id: 'git_rebase', name: 'Git Rebase', description: 'Rebase current branch', modelDescription: 'Reapply commits on top of another branch.', category: 'git_vcs', riskLevel: 'high', schema: { type: 'object', properties: { branch: { type: 'string', description: 'Branch to rebase onto' }, interactive: { type: 'boolean', description: 'Interactive rebase' } }, required: ['branch'] }, composable: true, source: 'builtin' },
  { id: 'git_config', name: 'Git Config', description: 'Get/set git config', modelDescription: 'Read or write git configuration values.', category: 'git_vcs', riskLevel: 'low', schema: { type: 'object', properties: { key: { type: 'string', description: 'Config key (omit to list all)' }, value: { type: 'string', description: 'Value to set (omit to read)' }, global: { type: 'boolean', description: 'Use global config' } }, required: [] }, composable: true, source: 'builtin' },

  // ═══ CODE INTELLIGENCE ═══
  { id: 'code_search', name: 'Search Code', description: 'Search for text/regex in code', modelDescription: 'Search code files for a pattern. Returns matching lines with paths and line numbers.', category: 'code_intelligence', riskLevel: 'low', schema: { type: 'object', properties: { pattern: { type: 'string', description: 'Search pattern' }, path: { type: 'string', description: 'Directory (default: .)' }, glob: { type: 'string', description: 'File glob (e.g. "*.ts")' } }, required: ['pattern'] }, composable: true, source: 'builtin' },
  { id: 'code_replace', name: 'Replace in File', description: 'Find and replace in a file', modelDescription: 'Replace a unique string in a file. Must match exactly once.', category: 'code_intelligence', riskLevel: 'medium', schema: { type: 'object', properties: { path: { type: 'string', description: 'File path' }, search: { type: 'string', description: 'Text to find (unique)' }, replace: { type: 'string', description: 'Replacement text' } }, required: ['path', 'search', 'replace'] }, composable: true, source: 'builtin' },
  { id: 'code_insert', name: 'Insert in File', description: 'Insert text at a line', modelDescription: 'Insert content at a line number. Line 0 = beginning.', category: 'code_intelligence', riskLevel: 'medium', schema: { type: 'object', properties: { file: { type: 'string', description: 'File path' }, line: { type: 'number', description: 'Line number (0-based)' }, content: { type: 'string', description: 'Content to insert' } }, required: ['file', 'line', 'content'] }, composable: true, source: 'builtin' },
  { id: 'code_definitions', name: 'Find Definitions', description: 'List definitions in a file', modelDescription: 'Scan a source file for top-level definitions. Supports TS, JS, Python, Rust, Go.', category: 'code_intelligence', riskLevel: 'low', schema: { type: 'object', properties: { file: { type: 'string', description: 'File path' } }, required: ['file'] }, composable: true, source: 'builtin' },
  { id: 'code_symbols', name: 'List Symbols', description: 'List all symbols in a file', modelDescription: 'List code symbols with kind and line number.', category: 'code_intelligence', riskLevel: 'low', schema: { type: 'object', properties: { file: { type: 'string', description: 'File path' } }, required: ['file'] }, composable: true, source: 'builtin' },
  { id: 'file_patch', name: 'Multi-Edit File', description: 'Apply multiple edits to a file atomically', modelDescription: 'Apply multiple search/replace edits. Alias: apply_patch (with edits or patch text).', category: 'code_intelligence', riskLevel: 'medium', schema: { type: 'object', properties: { file: { type: 'string', description: 'File path' }, edits: { type: 'array', description: 'Array of {search, replace} objects' } }, required: ['file', 'edits'] }, composable: true, source: 'builtin' },
  { id: 'apply_patch', name: 'Apply Patch (alias)', description: 'Apply a patch to a file', modelDescription: 'Apply patch hunks or {search,replace} edits. Cursor *** Begin Patch format supported.', category: 'code_intelligence', riskLevel: 'medium', schema: { type: 'object', properties: { path: { type: 'string', description: 'File path' }, patch: { type: 'string', description: 'Patch text (Cursor format or +/- hunks)' }, edits: { type: 'array', description: 'Edits array (alternative)' } }, required: [] }, composable: true, source: 'builtin' },
  { id: 'file_edit', name: 'Edit File (alias)', description: 'Replace text in a file', modelDescription: 'Alias for code_replace — old_string/new_string single edit.', category: 'code_intelligence', riskLevel: 'medium', schema: { type: 'object', properties: { path: { type: 'string', description: 'File path' }, old_string: { type: 'string', description: 'Text to find (unique)' }, new_string: { type: 'string', description: 'Replacement text' } }, required: ['path', 'old_string', 'new_string'] }, composable: true, source: 'builtin' },
  { id: 'code_range', name: 'Range Edit', description: 'Replace a range of lines in a file', modelDescription: 'Replace lines from startLine to endLine (inclusive, 0-based) with new content. Use to modify a specific section of a file without exact string matching. Set replacement to empty string to delete the range.', category: 'code_intelligence', riskLevel: 'medium', schema: { type: 'object', properties: { path: { type: 'string', description: 'File path' }, startLine: { type: 'number', description: 'First line to replace (0-based, inclusive)' }, endLine: { type: 'number', description: 'Last line to replace (0-based, inclusive, defaults to startLine)' }, replacement: { type: 'string', description: 'New content to insert (empty to delete the range)' } }, required: ['path', 'startLine'] }, composable: true, source: 'builtin' },
  { id: 'code_grep', name: 'Grep Code', description: 'Extended code search with context lines', modelDescription: 'Search file CONTENTS with regex + context lines. Alias: grep. Use glob/grep (not python_rpc) for exploration. For ad-hoc computation use script_run.', category: 'code_intelligence', riskLevel: 'low', schema: { type: 'object', properties: { pattern: { type: 'string', description: 'Regex pattern to search for' }, path: { type: 'string', description: 'Directory to search (default: current directory)' }, context: { type: 'number', description: 'Context lines before/after match (default: 2)' }, glob: { type: 'string', description: 'File glob filter (e.g. "*.ts", "*.{ts,js}"). Defaults to common source extensions.' } }, required: ['pattern'] }, composable: true, source: 'builtin' },
  { id: 'grep', name: 'Grep', description: 'Search file contents by regex', modelDescription: 'Search file contents with regex (alias for code_grep). Returns path:line:content with context. Prefer over python_rpc for searching code.', category: 'code_intelligence', riskLevel: 'low', schema: { type: 'object', properties: { pattern: { type: 'string', description: 'Regex or text pattern' }, path: { type: 'string', description: 'Directory (default: .)' }, context: { type: 'number', description: 'Context lines (default: 2)' }, glob: { type: 'string', description: 'File glob filter' } }, required: ['pattern'] }, composable: true, source: 'builtin' },
  { id: 'code_references', name: 'Find References', description: 'Find all references to a symbol', modelDescription: 'Search for all references/usages of a given symbol name in the codebase.', category: 'code_intelligence', riskLevel: 'low', schema: { type: 'object', properties: { symbol: { type: 'string', description: 'Symbol name to find' }, path: { type: 'string', description: 'Directory (default: .)' }, glob: { type: 'string', description: 'File glob (e.g. "*.ts")' } }, required: ['symbol'] }, composable: true, source: 'builtin' },
  { id: 'code_format', name: 'Format Code', description: 'Format source code with prettier/dprint', modelDescription: 'Format code files using Prettier (if available) in the project.', category: 'code_intelligence', riskLevel: 'medium', schema: { type: 'object', properties: { path: { type: 'string', description: 'File or directory path' } }, required: [] }, composable: true, source: 'builtin' },
  { id: 'code_lint', name: 'Lint Code', description: 'Run linter on code', modelDescription: 'Run ESLint (or project linter) on files. Returns lint results.', category: 'code_intelligence', riskLevel: 'low', schema: { type: 'object', properties: { path: { type: 'string', description: 'File or directory path (default: .)' }, fix: { type: 'boolean', description: 'Auto-fix fixable issues' } }, required: [] }, composable: true, source: 'builtin' },
  { id: 'code_fix', name: 'Fix Code', description: 'Auto-fix lint issues', modelDescription: 'Run linter with auto-fix to correct fixable issues in code.', category: 'code_intelligence', riskLevel: 'medium', schema: { type: 'object', properties: { path: { type: 'string', description: 'File or directory path (default: .)' } }, required: [] }, composable: true, source: 'builtin' },
  { id: 'code_typecheck', name: 'Type Check', description: 'Run TypeScript type checker', modelDescription: 'Run tsc --noEmit to check TypeScript types in the project.', category: 'code_intelligence', riskLevel: 'low', schema: { type: 'object', properties: { path: { type: 'string', description: 'Project path (default: .)' } }, required: [] }, composable: true, source: 'builtin' },
  { id: 'code_analyze', name: 'Analyze Code', description: 'Analyze code complexity and structure', modelDescription: 'Analyze a source file for structural metrics: functions, classes, imports, complexity indicators.', category: 'code_intelligence', riskLevel: 'low', schema: { type: 'object', properties: { file: { type: 'string', description: 'Source file path' } }, required: ['file'] }, composable: true, source: 'builtin' },

  // ═══ DOCUMENTS ═══
  { id: 'csv_create', name: 'Create CSV', description: 'Create a CSV file', modelDescription: 'Create a CSV file. Provide headers + rows, or raw content.', category: 'documents', riskLevel: 'medium', schema: { type: 'object', properties: { file: { type: 'string', description: 'Output path' }, headers: { type: 'array', description: 'Column headers' }, rows: { type: 'array', description: 'Row arrays' }, content: { type: 'string', description: 'Raw CSV (alternative)' } }, required: ['file'] }, composable: true, source: 'builtin' },
  { id: 'pdf_create', name: 'Create PDF', description: 'Create a PDF document', modelDescription: 'Create a PDF with text content. Supports title, author.', category: 'documents', riskLevel: 'medium', schema: { type: 'object', properties: { file: { type: 'string', description: 'Output path' }, title: { type: 'string', description: 'Title' }, content: { type: 'string', description: 'Text content' }, author: { type: 'string', description: 'Author' } }, required: ['file', 'content'] }, composable: true, source: 'builtin' },
  { id: 'docx_create', name: 'Create Word Doc', description: 'Create a DOCX document', modelDescription: 'Create a .docx Word document.', category: 'documents', riskLevel: 'medium', schema: { type: 'object', properties: { file: { type: 'string', description: 'Output path' }, title: { type: 'string', description: 'Title' }, content: { type: 'string', description: 'Text content' }, author: { type: 'string', description: 'Author' } }, required: ['file', 'content'] }, composable: true, source: 'builtin' },
  { id: 'pptx_create', name: 'Create Presentation', description: 'Create a PPTX presentation', modelDescription: 'Create a .pptx with slides [{title, content}].', category: 'documents', riskLevel: 'medium', schema: { type: 'object', properties: { file: { type: 'string', description: 'Output path' }, title: { type: 'string', description: 'Presentation title' }, slides: { type: 'array', description: 'Array of {title, content}' } }, required: ['file', 'slides'] }, composable: true, source: 'builtin' },
  { id: 'xlsx_create', name: 'Create Spreadsheet', description: 'Create an XLSX spreadsheet', modelDescription: 'Create a .xlsx with headers and rows.', category: 'documents', riskLevel: 'medium', schema: { type: 'object', properties: { file: { type: 'string', description: 'Output path' }, sheet_name: { type: 'string', description: 'Sheet name' }, headers: { type: 'array', description: 'Column headers' }, rows: { type: 'array', description: 'Row arrays' } }, required: ['file', 'headers', 'rows'] }, composable: true, source: 'builtin' },
  { id: 'pdf_read', name: 'Read PDF', description: 'Extract text from a PDF file', modelDescription: 'Read and extract text content from a PDF file. Use this to analyze PDF documents.', category: 'documents', riskLevel: 'low', schema: { type: 'object', properties: { path: { type: 'string', description: 'Path to the PDF file' } }, required: ['path'] }, composable: true, source: 'builtin' },
  { id: 'docx_read', name: 'Read Word Doc', description: 'Extract text from a DOCX file', modelDescription: 'Read and extract text from a Word (.docx) document.', category: 'documents', riskLevel: 'low', schema: { type: 'object', properties: { path: { type: 'string', description: 'Path to the DOCX file' } }, required: ['path'] }, composable: true, source: 'builtin' },
  { id: 'xlsx_read', name: 'Read Spreadsheet', description: 'Extract data from an XLSX file', modelDescription: 'Read and extract data from an Excel (.xlsx) spreadsheet. Returns tab-separated values.', category: 'documents', riskLevel: 'low', schema: { type: 'object', properties: { path: { type: 'string', description: 'Path to the XLSX file' } }, required: ['path'] }, composable: true, source: 'builtin' },
  { id: 'pptx_read', name: 'Read Presentation', description: 'Extract text from a PPTX file', modelDescription: 'Read and extract text from a PowerPoint (.pptx) presentation.', category: 'documents', riskLevel: 'low', schema: { type: 'object', properties: { path: { type: 'string', description: 'Path to the PPTX file' } }, required: ['path'] }, composable: true, source: 'builtin' },
  { id: 'doc_markdown', name: 'Generate Markdown', description: 'Generate a Markdown document', modelDescription: 'Create a Markdown (.md) document from structured content.', category: 'documents', riskLevel: 'low', schema: { type: 'object', properties: { file: { type: 'string', description: 'Output file path' }, title: { type: 'string', description: 'Document title' }, sections: { type: 'array', description: 'Array of {heading, content, code} objects' } }, required: ['file', 'sections'] }, composable: true, source: 'builtin' },
  { id: 'doc_html', name: 'Generate HTML', description: 'Generate an HTML document', modelDescription: 'Create an HTML file with optional CSS styling.', category: 'documents', riskLevel: 'low', schema: { type: 'object', properties: { file: { type: 'string', description: 'Output file path' }, title: { type: 'string', description: 'Page title' }, body: { type: 'string', description: 'HTML body content' }, style: { type: 'string', description: 'CSS styles (optional)' } }, required: ['file', 'body'] }, composable: true, source: 'builtin' },
  { id: 'doc_json', name: 'Generate JSON Doc', description: 'Generate a JSON document', modelDescription: 'Write structured data as a formatted JSON file.', category: 'documents', riskLevel: 'low', schema: { type: 'object', properties: { file: { type: 'string', description: 'Output file path' }, data: { type: 'object', description: 'JSON data to write' } }, required: ['file', 'data'] }, composable: true, source: 'builtin' },
  { id: 'doc_yaml', name: 'Generate YAML', description: 'Generate a YAML document', modelDescription: 'Write structured data as a YAML file.', category: 'documents', riskLevel: 'low', schema: { type: 'object', properties: { file: { type: 'string', description: 'Output file path' }, data: { type: 'object', description: 'Data to write as YAML' } }, required: ['file', 'data'] }, composable: true, source: 'builtin' },
  { id: 'doc_diagram', name: 'Generate Diagram', description: 'Generate a Mermaid diagram', modelDescription: 'Create a Mermaid diagram (.mmd) file from diagram definition text.', category: 'documents', riskLevel: 'low', schema: { type: 'object', properties: { file: { type: 'string', description: 'Output .mmd file path' }, definition: { type: 'string', description: 'Mermaid diagram definition' } }, required: ['file', 'definition'] }, composable: true, source: 'builtin' },
  { id: 'doc_latex', name: 'Generate LaTeX', description: 'Generate a LaTeX document', modelDescription: 'Create a LaTeX (.tex) document with preamble and body.', category: 'documents', riskLevel: 'low', schema: { type: 'object', properties: { file: { type: 'string', description: 'Output .tex file path' }, title: { type: 'string', description: 'Document title' }, author: { type: 'string', description: 'Author name' }, sections: { type: 'array', description: 'Array of {heading, content} objects' } }, required: ['file', 'sections'] }, composable: true, source: 'builtin' },

  // ═══ AUTOMATION (pg-boss) — sole scheduling path in all modes ═══
  { id: 'automation_register', name: 'Register Automation', description: 'Schedule a one-time or recurring agent task', modelDescription: 'Register a durable automation (reminders, pings, recurring checks, research, reports — all scheduling uses this). Works in Plan and Agent mode. Prompts the user to approve any tools the job will need (notifications, shell, writes) before scheduling. One-time: schedule_type=once + delay_seconds (preferred for "in 5 minutes") OR run_at (ISO 8601 from [CURRENT_TIME]). Recurring: schedule_type=recurring + cron (5-field). Set required_tools when you know extra tools beyond what instruction/notify_channels imply. For simple reminders, instruction = the reminder text. Use task_key to update an existing logical task.', category: 'scheduler', riskLevel: 'medium', schema: { type: 'object', properties: { title: { type: 'string', description: 'Short task title' }, instruction: { type: 'string', description: 'Full instruction for the agent to execute when the job fires' }, schedule_type: { type: 'string', enum: ['once', 'recurring'], description: 'once or recurring' }, run_at: { type: 'string', description: 'ISO 8601 datetime for one-time tasks' }, delay_seconds: { type: 'number', description: 'Seconds from now for one-time tasks (preferred for relative delays)' }, cron: { type: 'string', description: '5-field cron for recurring tasks' }, timezone: { type: 'string', description: 'IANA timezone (default UTC)' }, task_key: { type: 'string', description: 'Stable key for updates/debounce' }, notify_channels: { type: 'array', items: { type: 'string' }, description: 'in_app, desktop, telegram' }, required_tools: { type: 'array', items: { type: 'string' }, description: 'Tool IDs the job will need (merged with inferred tools from instruction)' }, source_channel: { type: 'string', description: 'web, telegram, etc.' } }, required: ['title', 'instruction', 'schedule_type'] }, composable: true, source: 'builtin' },
  { id: 'automation_list', name: 'List Automations', description: 'List registered automation tasks', modelDescription: 'List durable automation tasks. On messaging channel super-sessions, returns ALL automations across Agent-X (not limited to the channel). On web sessions, returns tasks for the current session. Use agent_x_overview for a richer fleet snapshot.', category: 'scheduler', riskLevel: 'low', schema: { type: 'object', properties: {}, required: [] }, composable: true, source: 'builtin' },
  { id: 'automation_cancel', name: 'Cancel Automation', description: 'Cancel a registered automation', modelDescription: 'Cancel automation by id or task_key. On messaging channel super-sessions, can cancel any automation in the fleet.', category: 'scheduler', riskLevel: 'medium', schema: { type: 'object', properties: { id: { type: 'string', description: 'Task ID' }, task_key: { type: 'string', description: 'Task key' } }, required: [] }, composable: true, source: 'builtin' },
  { id: 'agent_x_overview', name: 'Agent-X Overview', description: 'Fleet-wide snapshot of sessions, automations, notifications, and settings', modelDescription: 'Messaging channel super-session only. Returns live Agent-X state: summary (default), sessions, automations, notifications, settings, or session_detail (requires session_id). Use before answering questions about other sessions, automations, private chats, or configuration.', category: 'agent_meta', riskLevel: 'low', schema: { type: 'object', properties: { view: { type: 'string', enum: ['summary', 'sessions', 'automations', 'notifications', 'settings', 'session_detail'], description: 'Which snapshot to return (default summary)' }, session_id: { type: 'string', description: 'Required when view=session_detail' } }, required: [] }, composable: true, source: 'builtin' },
  { id: 'save_to_markdown', name: 'Save to Markdown', description: 'Save a markdown document', modelDescription: 'Persist a polished markdown document for reports, audits, comparisons, itineraries, and saved deliverables. Use when the user asks to save/convert to markdown, or after offering to save and they accept. Pass content (markdown) with headings, tables, lists, fenced code, blockquotes, and links. Use ```chart fences for metrics. Always pass title — a short descriptive name (3–8 words) for the sidebar and PDF export. Stored internally; user opens Markdown in the sidebar to view/export PDF.', category: 'documents', riskLevel: 'low', schema: { type: 'object', properties: { content: { type: 'string', description: 'Markdown body (preferred)' }, markdown: { type: 'string', description: 'Alias for content' }, title: { type: 'string', description: 'Short descriptive document title (3–8 words)' }, message_id: { type: 'string', description: 'Source chat message id' }, source_role: { type: 'string', enum: ['user', 'assistant', 'system'] } }, required: [] }, composable: false, source: 'builtin' },

  // ═══ SUB-AGENTS ═══
  { id: 'sub_agent_spawn', name: 'Spawn Sub-Agent', description: 'Delegate a task to a background sub-agent', modelDescription: 'Spawn a background sub-agent to handle a complex task independently. Use for research, analysis, or any task that can run in parallel. The sub-agent gets its own LLM context.', category: 'agent_orchestration', riskLevel: 'medium', schema: { type: 'object', properties: { instruction: { type: 'string', description: 'Detailed instruction for the sub-agent' }, tools: { type: 'string', description: 'Comma-separated tool IDs the sub-agent can use' }, timeout: { type: 'number', description: 'Timeout in ms (default: 60000)' } }, required: ['instruction'] }, composable: true, source: 'builtin' },
  { id: 'sub_agent_status', name: 'Sub-Agent Status', description: 'Check status of running sub-agents', modelDescription: 'Check status of a specific sub-agent by ID, or list all running sub-agents.', category: 'agent_orchestration', riskLevel: 'low', schema: { type: 'object', properties: { agent_id: { type: 'string', description: 'Agent ID (optional — omit to list all)' } }, required: [] }, composable: true, source: 'builtin' },
  { id: 'sub_agent_cancel', name: 'Cancel Sub-Agent', description: 'Cancel a running sub-agent', modelDescription: 'Cancel and abort a running sub-agent by its ID.', category: 'agent_orchestration', riskLevel: 'low', schema: { type: 'object', properties: { agent_id: { type: 'string', description: 'Agent ID to cancel' } }, required: ['agent_id'] }, composable: true, source: 'builtin' },
  { id: 'delegate_to_crew', name: 'Delegate to Crew', description: 'Delegate a specific sub-task to an expert crew member', modelDescription: 'Delegate ONLY when you (Agent-X) have determined the task clearly requires a crew member\'s documented specialty and you cannot adequately handle it yourself. Do NOT use for general questions, system info, research, or coding you can do with tools. The crew name must match exactly — available crews are listed in the system prompt.', category: 'agent_orchestration', riskLevel: 'low', schema: { type: 'object', properties: { crew: { type: 'string', description: 'Crew member name or @callsign to delegate to (e.g. "Jordan Taylor" or "jordan_taylor")' }, task: { type: 'string', description: 'Specific, scoped task description for the crew to execute' } }, required: ['crew', 'task'] }, composable: true, source: 'builtin' },
  { id: 'spawn_crew_workers', name: 'Spawn Crew Workers', description: 'Spawn parallel crew workers with full personas and tools', modelDescription: 'Spawn crew workers ONLY when you (Agent-X) have reasoned that specialist domain expertise is required and you should not handle this alone. Not for general assistance. Each operative posts their response in chat. After calling, do NOT repeat their analysis. Pass crew callsigns (comma-separated) or omit to use all enabled crews.', category: 'agent_orchestration', riskLevel: 'medium', schema: { type: 'object', properties: { task: { type: 'string', description: 'Mission task description' }, crews: { type: 'string', description: 'Comma-separated crew callsigns (optional — uses all enabled if omitted)' } }, required: ['task'] }, composable: true, source: 'builtin' },
  { id: 'crew_message', name: 'Crew Message', description: 'Send a message to another crew member', modelDescription: 'Send a message to another crew member by callsign or ID. Use this to coordinate with other specialists on multi-disciplinary tasks. The target crew member will receive your message and respond.', category: 'agent_orchestration', riskLevel: 'low', schema: { type: 'object', properties: { to: { type: 'string', description: 'Target crew member callsign or ID' }, message: { type: 'string', description: 'Message content to send' } }, required: ['to', 'message'] }, composable: false, source: 'builtin' },
  { id: 'crew_response', name: 'Crew Response', description: 'Reply to a message from another crew member', modelDescription: 'Reply to another crew member. Use replyToMessageId+content for threaded replies, or to+message to respond directly by callsign.', category: 'agent_orchestration', riskLevel: 'low', schema: { type: 'object', properties: { replyToMessageId: { type: 'string', description: 'ID of the message being replied to' }, content: { type: 'string', description: 'Reply content' }, to: { type: 'string', description: 'Target crew callsign (alternative to replyToMessageId)' }, message: { type: 'string', description: 'Reply message (alternative to content)' } } }, composable: false, source: 'builtin' },
  { id: 'search_crew_hub', name: 'Search Crew Hub', description: 'Search Crew Hub catalog and session roster for specialists', modelDescription: 'Search the Crew Hub catalog and enabled session roster by skills, certifications, job titles, or domain keywords. Use when the user needs specialists/workforce help and [CREW_ROSTER_HINT] is missing or you need a refined query. Returns callsigns, titles, match scores, and expertise.', category: 'agent_orchestration', riskLevel: 'low', schema: { type: 'object', properties: { query: { type: 'string', description: 'Skills, certification, role, or domain to search for' }, limit: { type: 'number', description: 'Max results (1-10, default 5)' } }, required: ['query'] }, composable: true, source: 'builtin' },

  // ═══ BROWSER ═══
  { id: 'browser_open', name: 'Open Web Page', description: 'Open URL in headless browser', modelDescription: 'Open a URL, return page title and text content.', category: 'browser_automation', riskLevel: 'medium', schema: { type: 'object', properties: { url: { type: 'string', description: 'URL to open' } }, required: ['url'] }, composable: true, source: 'builtin' },
  { id: 'browser_screenshot', name: 'Screenshot Page', description: 'Screenshot a web page', modelDescription: 'Capture full-page screenshot of a URL.', category: 'browser_automation', riskLevel: 'medium', schema: { type: 'object', properties: { url: { type: 'string', description: 'URL' }, output: { type: 'string', description: 'Output file (default: screenshot.png)' } }, required: ['url'] }, composable: true, source: 'builtin' },
  { id: 'browser_click', name: 'Click Element', description: 'Click an element on a page', modelDescription: 'Navigate to URL and click a CSS selector.', category: 'browser_automation', riskLevel: 'medium', schema: { type: 'object', properties: { url: { type: 'string', description: 'URL' }, selector: { type: 'string', description: 'CSS selector' } }, required: ['url', 'selector'] }, composable: true, source: 'builtin' },
  { id: 'browser_eval', name: 'Evaluate JS', description: 'Run JavaScript on a page', modelDescription: 'Evaluate a JS expression in page context.', category: 'browser_automation', riskLevel: 'high', schema: { type: 'object', properties: { url: { type: 'string', description: 'URL' }, expression: { type: 'string', description: 'JS expression' } }, required: ['url', 'expression'] }, composable: true, source: 'builtin' },
  { id: 'browser_type', name: 'Type Text', description: 'Type text into an input field', modelDescription: 'Navigate to URL and type text into a CSS selector field.', category: 'browser_automation', riskLevel: 'medium', schema: { type: 'object', properties: { url: { type: 'string', description: 'URL' }, selector: { type: 'string', description: 'CSS selector' }, text: { type: 'string', description: 'Text to type' } }, required: ['url', 'selector', 'text'] }, composable: true, source: 'builtin' },
  { id: 'browser_extract', name: 'Extract Elements', description: 'Extract text from CSS selectors', modelDescription: 'Open a page and extract text content from all elements matching a CSS selector.', category: 'browser_automation', riskLevel: 'medium', schema: { type: 'object', properties: { url: { type: 'string', description: 'URL' }, selector: { type: 'string', description: 'CSS selector' } }, required: ['url', 'selector'] }, composable: true, source: 'builtin' },

  // ═══ CONTAINERS ═══
  { id: 'container_list', name: 'List Containers', description: 'List Docker containers', modelDescription: 'List all Docker containers with status and ports.', category: 'containers_infra', riskLevel: 'low', schema: { type: 'object', properties: {}, required: [] }, composable: true, source: 'builtin' },
  { id: 'container_logs', name: 'Container Logs', description: 'View container logs', modelDescription: 'Get logs from a Docker container.', category: 'containers_infra', riskLevel: 'low', schema: { type: 'object', properties: { name: { type: 'string', description: 'Container name/ID' }, tail: { type: 'number', description: 'Lines (default: 50)' } }, required: ['name'] }, composable: true, source: 'builtin' },
  { id: 'container_start', name: 'Start Container', description: 'Start a container', modelDescription: 'Start a stopped Docker container.', category: 'containers_infra', riskLevel: 'medium', schema: { type: 'object', properties: { name: { type: 'string', description: 'Container name/ID' } }, required: ['name'] }, composable: true, source: 'builtin' },
  { id: 'container_stop', name: 'Stop Container', description: 'Stop a container', modelDescription: 'Stop a running Docker container.', category: 'containers_infra', riskLevel: 'medium', schema: { type: 'object', properties: { name: { type: 'string', description: 'Container name/ID' } }, required: ['name'] }, composable: true, source: 'builtin' },
  { id: 'container_exec', name: 'Exec in Container', description: 'Run command in container', modelDescription: 'Execute a command inside a running container.', category: 'containers_infra', riskLevel: 'high', schema: { type: 'object', properties: { name: { type: 'string', description: 'Container name/ID' }, command: { type: 'string', description: 'Command' } }, required: ['name', 'command'] }, composable: true, source: 'builtin' },
  { id: 'container_run', name: 'Run Container', description: 'Run new container from image', modelDescription: 'Start a new container from a Docker image with port/env config.', category: 'containers_infra', riskLevel: 'high', schema: { type: 'object', properties: { image: { type: 'string', description: 'Docker image' }, name: { type: 'string', description: 'Container name' }, ports: { type: 'string', description: 'Port mapping (e.g. "8080:80")' }, env: { type: 'string', description: 'Env vars (KEY=VAL,KEY=VAL)' }, detach: { type: 'boolean', description: 'Background (default: true)' } }, required: ['image'] }, composable: true, source: 'builtin' },
  { id: 'container_compose', name: 'Docker Compose', description: 'Run docker compose commands', modelDescription: 'Docker compose: up, down, ps, logs, restart.', category: 'containers_infra', riskLevel: 'medium', schema: { type: 'object', properties: { action: { type: 'string', description: 'Action: up, down, ps, logs, restart' }, services: { type: 'string', description: 'Services (space-separated)' } }, required: ['action'] }, composable: true, source: 'builtin' },
  { id: 'container_images', name: 'List Images', description: 'List Docker images', modelDescription: 'List locally available Docker images.', category: 'containers_infra', riskLevel: 'low', schema: { type: 'object', properties: {}, required: [] }, composable: true, source: 'builtin' },
  { id: 'docker_build', name: 'Build Docker Image', description: 'Build a Docker image from Dockerfile', modelDescription: 'Build a Docker image from a Dockerfile in the specified directory.', category: 'containers_infra', riskLevel: 'medium', schema: { type: 'object', properties: { path: { type: 'string', description: 'Directory with Dockerfile (default: .)' }, tag: { type: 'string', description: 'Image tag (e.g. myapp:latest)' }, dockerfile: { type: 'string', description: 'Dockerfile name (default: Dockerfile)' } }, required: ['tag'] }, composable: true, source: 'builtin' },

  // ═══ DATA PROCESSING ═══
  { id: 'json_parse', name: 'Parse JSON', description: 'Parse JSON from file or string', modelDescription: 'Parse and pretty-print JSON from a file or raw string.', category: 'data_processing', riskLevel: 'low', schema: { type: 'object', properties: { file: { type: 'string', description: 'JSON file path' }, input: { type: 'string', description: 'Raw JSON string' } }, required: [] }, composable: true, source: 'builtin' },
  { id: 'json_query', name: 'Query JSON', description: 'Query value from JSON by path', modelDescription: 'Extract a value from JSON using dot notation.', category: 'data_processing', riskLevel: 'low', schema: { type: 'object', properties: { file: { type: 'string', description: 'JSON file' }, path: { type: 'string', description: 'Dot path (e.g. "users.0.name")' } }, required: ['file', 'path'] }, composable: true, source: 'builtin' },
  { id: 'json_set', name: 'Set JSON Value', description: 'Set a value in a JSON file', modelDescription: 'Set a value at a dot-notation path in a JSON file.', category: 'data_processing', riskLevel: 'medium', schema: { type: 'object', properties: { file: { type: 'string', description: 'JSON file' }, path: { type: 'string', description: 'Dot path' }, value: { type: 'string', description: 'Value (JSON-encoded)' } }, required: ['file', 'path', 'value'] }, composable: true, source: 'builtin' },
  { id: 'csv_parse', name: 'Parse CSV', description: 'Parse a CSV file', modelDescription: 'Parse CSV into structured data with headers and rows.', category: 'data_processing', riskLevel: 'low', schema: { type: 'object', properties: { file: { type: 'string', description: 'CSV file path' }, delimiter: { type: 'string', description: 'Delimiter (default: ,)' }, limit: { type: 'number', description: 'Max rows' } }, required: ['file'] }, composable: true, source: 'builtin' },
  { id: 'text_transform', name: 'Transform Text', description: 'Apply text transformations', modelDescription: 'Transform text: uppercase, lowercase, trim, lines, words, chars, reverse, base64_encode, base64_decode.', category: 'data_processing', riskLevel: 'low', schema: { type: 'object', properties: { input: { type: 'string', description: 'Text input' }, operation: { type: 'string', description: 'Operation name' } }, required: ['input', 'operation'] }, composable: true, source: 'builtin' },
  { id: 'regex_match', name: 'Regex Match', description: 'Match regex against text', modelDescription: 'Apply a regex pattern to text and return matched groups and positions.', category: 'data_processing', riskLevel: 'low', schema: { type: 'object', properties: { text: { type: 'string', description: 'Text to search in' }, pattern: { type: 'string', description: 'Regex pattern' }, flags: { type: 'string', description: 'Regex flags (g, i, m, etc.)' } }, required: ['text', 'pattern'] }, composable: true, source: 'builtin' },
  { id: 'text_diff', name: 'Diff Text', description: 'Compare two text strings', modelDescription: 'Show line-by-line diff between two text strings.', category: 'data_processing', riskLevel: 'low', schema: { type: 'object', properties: { text1: { type: 'string', description: 'First text' }, text2: { type: 'string', description: 'Second text' } }, required: ['text1', 'text2'] }, composable: true, source: 'builtin' },
  { id: 'validate_schema', name: 'Validate Schema', description: 'Validate data against JSON Schema', modelDescription: 'Validate a JSON object against a JSON Schema specification.', category: 'data_processing', riskLevel: 'low', schema: { type: 'object', properties: { data: { type: 'object', description: 'Data to validate' }, schema: { type: 'object', description: 'JSON Schema to validate against' } }, required: ['data', 'schema'] }, composable: true, source: 'builtin' },
  { id: 'render_chart', name: 'Render Chart', description: 'Validate a chat chart spec', modelDescription: 'Validate and normalize a ChartSpec for chat display. Prefer also emitting a ```chart JSON fence in the assistant reply. Spec fields: type, title, data (or nodes/links, tasks, mermaid). Supported types include bar, line, pie, sankey, gantt, network, mermaid, and other chart types from the chat chart catalog.', category: 'data_processing', riskLevel: 'low', schema: { type: 'object', properties: { spec: { type: 'object', description: 'ChartSpec object (v, type, title, data, …)' }, chart: { type: 'object', description: 'Alias for spec' } }, required: [] }, composable: true, source: 'builtin' },

  // ═══ DATABASE ═══
  { id: 'db_query', name: 'Database Query', description: 'Execute SQL on SQLite', modelDescription: 'Run a SQL query against a SQLite database file.', category: 'database', riskLevel: 'medium', schema: { type: 'object', properties: { database: { type: 'string', description: 'Path to .db file' }, query: { type: 'string', description: 'SQL query' } }, required: ['database', 'query'] }, composable: true, source: 'builtin' },
  { id: 'db_schema', name: 'Database Schema', description: 'Inspect database schema', modelDescription: 'Show tables and schema of a SQLite database.', category: 'database', riskLevel: 'low', schema: { type: 'object', properties: { database: { type: 'string', description: 'Path to .db file' }, table: { type: 'string', description: 'Table name (optional)' } }, required: ['database'] }, composable: true, source: 'builtin' },
  { id: 'db_export', name: 'Database Export', description: 'Export table to CSV/TSV', modelDescription: 'Export a table to CSV or TSV format.', category: 'database', riskLevel: 'low', schema: { type: 'object', properties: { database: { type: 'string', description: 'Path to .db file' }, table: { type: 'string', description: 'Table name' }, format: { type: 'string', description: 'csv or tsv' } }, required: ['database', 'table'] }, composable: true, source: 'builtin' },
  { id: 'env_read', name: 'Read .env', description: 'Read .env file', modelDescription: 'Read a .env file (values masked for security).', category: 'database', riskLevel: 'low', schema: { type: 'object', properties: { file: { type: 'string', description: '.env file path (default: .env)' } }, required: [] }, composable: true, source: 'builtin' },
  { id: 'db_migrate', name: 'Database Migration', description: 'Run SQL migration files', modelDescription: 'Run SQL migration files against a SQLite database. Migrations are tracked in a _migrations table.', category: 'database', riskLevel: 'high', schema: { type: 'object', properties: { database: { type: 'string', description: 'Path to .db file' }, migrationsDir: { type: 'string', description: 'Directory containing .sql migration files' } }, required: ['database', 'migrationsDir'] }, composable: true, source: 'builtin' },

  // ═══ GITHUB ═══
  { id: 'gh_issue_list', name: 'List Issues', description: 'List GitHub issues', modelDescription: 'List GitHub issues. Requires gh CLI.', category: 'communication', riskLevel: 'low', schema: { type: 'object', properties: { state: { type: 'string', description: 'open, closed, all' }, limit: { type: 'number', description: 'Max results' } }, required: [] }, composable: true, source: 'builtin' },
  { id: 'gh_issue_create', name: 'Create Issue', description: 'Create GitHub issue', modelDescription: 'Create a new GitHub issue.', category: 'communication', riskLevel: 'medium', schema: { type: 'object', properties: { title: { type: 'string', description: 'Issue title' }, body: { type: 'string', description: 'Issue body' } }, required: ['title'] }, composable: true, source: 'builtin' },
  { id: 'gh_pr_list', name: 'List PRs', description: 'List pull requests', modelDescription: 'List pull requests for the repo.', category: 'communication', riskLevel: 'low', schema: { type: 'object', properties: { state: { type: 'string', description: 'open, closed, merged, all' }, limit: { type: 'number', description: 'Max results' } }, required: [] }, composable: true, source: 'builtin' },
  { id: 'gh_pr_create', name: 'Create PR', description: 'Create pull request', modelDescription: 'Create a PR from current branch.', category: 'communication', riskLevel: 'medium', schema: { type: 'object', properties: { title: { type: 'string', description: 'PR title' }, body: { type: 'string', description: 'PR description' }, base: { type: 'string', description: 'Base branch (default: main)' } }, required: ['title'] }, composable: true, source: 'builtin' },
  { id: 'gh_pr_view', name: 'View PR', description: 'View pull request details', modelDescription: 'Get details of a PR by number.', category: 'communication', riskLevel: 'low', schema: { type: 'object', properties: { number: { type: 'number', description: 'PR number' } }, required: ['number'] }, composable: true, source: 'builtin' },
  { id: 'gh_repo_view', name: 'View Repo', description: 'View repository info', modelDescription: 'Show current repository info.', category: 'communication', riskLevel: 'low', schema: { type: 'object', properties: {}, required: [] }, composable: true, source: 'builtin' },
  { id: 'gh_workflow_list', name: 'Workflow Runs', description: 'List CI/CD runs', modelDescription: 'Show recent GitHub Actions workflow runs.', category: 'communication', riskLevel: 'low', schema: { type: 'object', properties: {}, required: [] }, composable: true, source: 'builtin' },
  { id: 'gh_release', name: 'Releases', description: 'List releases', modelDescription: 'List GitHub releases.', category: 'communication', riskLevel: 'low', schema: { type: 'object', properties: { action: { type: 'string', description: 'Action (default: list)' } }, required: [] }, composable: true, source: 'builtin' },
  { id: 'gh_pr_review', name: 'Review PR', description: 'Add review to a pull request', modelDescription: 'Submit a review on a pull request (approve, comment, or request changes).', category: 'communication', riskLevel: 'high', schema: { type: 'object', properties: { number: { type: 'number', description: 'PR number' }, body: { type: 'string', description: 'Review body/comment' }, event: { type: 'string', description: 'APPROVE, COMMENT, REQUEST_CHANGES (default: COMMENT)' } }, required: ['number'] }, composable: true, source: 'builtin' },

  // ═══ PACKAGES ═══
  { id: 'package_install', name: 'Install Packages', description: 'Install dependencies', modelDescription: 'Install packages (auto-detects npm/pnpm/yarn).', category: 'package_managers', riskLevel: 'medium', schema: { type: 'object', properties: { packages: { type: 'string', description: 'Package names (space-separated)' }, dev: { type: 'boolean', description: 'As devDependency' } }, required: [] }, composable: true, source: 'builtin' },
  { id: 'package_remove', name: 'Remove Package', description: 'Remove a dependency', modelDescription: 'Uninstall packages from the project.', category: 'package_managers', riskLevel: 'medium', schema: { type: 'object', properties: { packages: { type: 'string', description: 'Packages to remove' } }, required: ['packages'] }, composable: true, source: 'builtin' },
  { id: 'package_list', name: 'List Dependencies', description: 'List project deps', modelDescription: 'Show all dependencies from package.json.', category: 'package_managers', riskLevel: 'low', schema: { type: 'object', properties: {}, required: [] }, composable: true, source: 'builtin' },
  { id: 'package_outdated', name: 'Outdated Packages', description: 'Check outdated deps', modelDescription: 'Show packages with newer versions available.', category: 'package_managers', riskLevel: 'low', schema: { type: 'object', properties: {}, required: [] }, composable: true, source: 'builtin' },
  { id: 'package_run', name: 'Run Script', description: 'Run package.json script', modelDescription: 'Run a script from package.json.', category: 'package_managers', riskLevel: 'medium', schema: { type: 'object', properties: { script: { type: 'string', description: 'Script name' } }, required: ['script'] }, composable: true, source: 'builtin' },
  { id: 'pkg_update', name: 'Update Packages', description: 'Update dependencies to latest', modelDescription: 'Update all packages to latest compatible versions per semver range.', category: 'package_managers', riskLevel: 'medium', schema: { type: 'object', properties: { packages: { type: 'string', description: 'Specific packages to update (space-separated, optional)' } }, required: [] }, composable: true, source: 'builtin' },
  { id: 'pkg_audit', name: 'Audit Packages', description: 'Audit packages for vulnerabilities', modelDescription: 'Run npm audit or pnpm audit to find vulnerabilities in dependencies.', category: 'package_managers', riskLevel: 'low', schema: { type: 'object', properties: {}, required: [] }, composable: true, source: 'builtin' },
  { id: 'pkg_search', name: 'Search Packages', description: 'Search npm registry for packages', modelDescription: 'Search the npm registry for packages matching a query.', category: 'package_managers', riskLevel: 'low', schema: { type: 'object', properties: { query: { type: 'string', description: 'Search query' }, limit: { type: 'number', description: 'Max results (default: 10)' } }, required: ['query'] }, composable: true, source: 'builtin' },

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
  { id: 'system_monitor', name: 'System Monitor', description: 'Monitor system resources', modelDescription: 'Show real-time system resource usage: CPU, memory, disk I/O, network.', category: 'system_os', riskLevel: 'low', schema: { type: 'object', properties: {}, required: [] }, composable: true, source: 'builtin' },
  { id: 'cron_create', name: 'Create Cron Job', description: 'Schedule a cron job', modelDescription: 'Create a cron job. Adds entry to crontab for the current user.', category: 'system_os', riskLevel: 'high', schema: { type: 'object', properties: { expression: { type: 'string', description: 'Cron expression (e.g. "0 9 * * *")' }, command: { type: 'string', description: 'Command to run' }, label: { type: 'string', description: 'Label/comment for the job' } }, required: ['expression', 'command'] }, composable: true, source: 'builtin' },
  { id: 'open_app', name: 'Open Application', description: 'Open an application or file', modelDescription: 'Open a file/URL/application in the default system application.', category: 'system_os', riskLevel: 'medium', schema: { type: 'object', properties: { target: { type: 'string', description: 'File path, URL, or app name to open' } }, required: ['target'] }, composable: true, source: 'builtin' },

  // ═══ TESTING ═══
  { id: 'test_run', name: 'Run Tests', description: 'Run test suite', modelDescription: 'Run tests (vitest). Optional file or pattern filter.', category: 'testing', riskLevel: 'low', schema: { type: 'object', properties: { file: { type: 'string', description: 'Test file' }, pattern: { type: 'string', description: 'Test name pattern' } }, required: [] }, composable: true, source: 'builtin' },
  { id: 'test_watch', name: 'Run Test File', description: 'Run single test file', modelDescription: 'Run a specific test file.', category: 'testing', riskLevel: 'low', schema: { type: 'object', properties: { file: { type: 'string', description: 'Test file path' } }, required: [] }, composable: true, source: 'builtin' },
  { id: 'test_coverage', name: 'Test Coverage', description: 'Run tests with coverage', modelDescription: 'Run tests and generate coverage report.', category: 'testing', riskLevel: 'low', schema: { type: 'object', properties: {}, required: [] }, composable: true, source: 'builtin' },
  { id: 'test_create', name: 'Generate Test', description: 'Scaffold test file', modelDescription: 'Generate a test file with stubs for a source file.', category: 'testing', riskLevel: 'medium', schema: { type: 'object', properties: { sourceFile: { type: 'string', description: 'Source file to test' } }, required: ['sourceFile'] }, composable: true, source: 'builtin' },
  { id: 'benchmark_run', name: 'Run Benchmark', description: 'Run performance benchmarks', modelDescription: 'Run benchmark tests. Supports vitest, cargo bench, go test -bench, pytest-benchmark.', category: 'testing', riskLevel: 'low', schema: { type: 'object', properties: { file: { type: 'string', description: 'Benchmark file (optional)' } }, required: [] }, composable: true, source: 'builtin' },

  // ═══ BUILD — Cross-Language Compilation ═══
  { id: 'build', name: 'Build Project', description: 'Compile/build the project', modelDescription: 'Build/compile the project. Auto-detects: cargo build (Rust), go build (Go), tsc (TypeScript), npm/pnpm/yarn build, make, cmake.', category: 'code_intelligence', riskLevel: 'low', schema: { type: 'object', properties: { target: { type: 'string', description: 'Build target (optional)' }, release: { type: 'boolean', description: 'Release mode' } }, required: [] }, composable: true, source: 'builtin' },
  { id: 'build_run', name: 'Build & Run', description: 'Build and execute the project', modelDescription: 'Build and run in one step. Auto-detects: cargo run, go run, npm/pnpm/yarn start, make run.', category: 'code_intelligence', riskLevel: 'low', schema: { type: 'object', properties: { args: { type: 'string', description: 'Command-line arguments' }, release: { type: 'boolean', description: 'Release mode' } }, required: [] }, composable: true, source: 'builtin' },
  { id: 'build_check', name: 'Check for Errors', description: 'Fast compilation check', modelDescription: 'Check for compilation errors without producing artifacts: cargo check, go vet, tsc --noEmit.', category: 'code_intelligence', riskLevel: 'low', schema: { type: 'object', properties: {}, required: [] }, composable: true, source: 'builtin' },
  { id: 'build_clean', name: 'Clean Build', description: 'Remove build artifacts', modelDescription: 'Remove build output and caches: cargo clean, go clean, rm -rf dist.', category: 'code_intelligence', riskLevel: 'low', schema: { type: 'object', properties: {}, required: [] }, composable: true, source: 'builtin' },

  // ═══ WEB & NETWORK ═══
  { id: 'http_get', name: 'HTTP GET', description: 'Make GET request', modelDescription: 'Fetch URL content via GET. Alias: web_fetch. For rendered JS pages use web_browse.', category: 'web_network', riskLevel: 'low', schema: { type: 'object', properties: { url: { type: 'string', description: 'URL' }, headers: { type: 'object', description: 'Custom headers' } }, required: ['url'] }, composable: true, source: 'builtin' },
  { id: 'web_fetch', name: 'Fetch URL', description: 'Fetch web page or API content', modelDescription: 'Fetch a single URL and return body text/JSON. Use when you already have a URL. For discovering URLs, use deep_web_search or web_search first. For JS-rendered pages use web_browse.', category: 'web_network', riskLevel: 'low', schema: { type: 'object', properties: { url: { type: 'string', description: 'URL to fetch' }, headers: { type: 'object', description: 'Optional HTTP headers' } }, required: ['url'] }, composable: true, source: 'builtin' },
  { id: 'http_post', name: 'HTTP POST', description: 'Make POST request', modelDescription: 'Send a POST request with body.', category: 'web_network', riskLevel: 'medium', schema: { type: 'object', properties: { url: { type: 'string', description: 'URL' }, body: { type: 'string', description: 'Request body (JSON)' }, headers: { type: 'object', description: 'Custom headers' } }, required: ['url'] }, composable: true, source: 'builtin' },
  { id: 'http_request', name: 'HTTP Request', description: 'Generic HTTP request', modelDescription: 'HTTP request with any method. Returns status, headers, body.', category: 'web_network', riskLevel: 'medium', schema: { type: 'object', properties: { url: { type: 'string', description: 'URL' }, method: { type: 'string', description: 'HTTP method' }, headers: { type: 'object', description: 'Headers' }, body: { type: 'string', description: 'Body' } }, required: ['url', 'method'] }, composable: true, source: 'builtin' },
  { id: 'web_scrape', name: 'Scrape Page', description: 'Extract text from web page', modelDescription: 'Fetch one page and extract plain text (HTML stripped). Use after web_search/deep_web_search when you need full page text from a known URL.', category: 'web_network', riskLevel: 'low', schema: { type: 'object', properties: { url: { type: 'string', description: 'URL' }, selector: { type: 'string', description: 'CSS selector (optional)' } }, required: ['url'] }, composable: true, source: 'builtin' },
  { id: 'web_search', name: 'Web Search', description: 'Quick web search', modelDescription: 'Fast SERP snippets from configured providers (DuckDuckGo free by default; optional BYOK Brave/Exa/Tavily from Settings). Use for quick lookups. For multi-query research with fetch, scoring, and rich result cards, prefer deep_web_search.', category: 'web_network', riskLevel: 'low', schema: { type: 'object', properties: { query: { type: 'string', description: 'Search query' } }, required: ['query'] }, composable: true, source: 'builtin' },
  { id: 'deep_web_search', name: 'Deep Web Search', description: 'Multi-source ranked web research', modelDescription: 'Primary research tool: plans multiple queries, searches via configured providers (DuckDuckGo + optional BYOK Brave/Exa/Tavily), fetches and scores top pages, returns structured ranked results with rich UI cards. Prefer over web_search for research, comparisons, news, and factual questions. Args: query (required), depth (quick|standard|deep), maxResults (optional). After results, use web_fetch/web_scrape on specific URLs if deeper page content is needed.', category: 'web_network', riskLevel: 'low', schema: { type: 'object', properties: { query: { type: 'string', description: 'Research question or search topic' }, depth: { type: 'string', enum: ['quick', 'standard', 'deep'], description: 'Search depth (default: standard)' }, maxResults: { type: 'number', description: 'Max ranked results to return' } }, required: ['query'] }, composable: true, source: 'builtin', timeoutMs: 120000 },
  { id: 'http_download', name: 'HTTP Download', description: 'Download a file from URL', modelDescription: 'Download a file from a URL and save it to disk.', category: 'web_network', riskLevel: 'medium', schema: { type: 'object', properties: { url: { type: 'string', description: 'File URL to download' }, output: { type: 'string', description: 'Output file path' } }, required: ['url', 'output'] }, composable: true, source: 'builtin' },
  { id: 'web_browse', name: 'Browse Web', description: 'Browse a URL with browser rendering', modelDescription: 'Browse a URL with Playwright for JavaScript-rendered SPAs. Use when web_fetch/web_scrape return empty or incomplete content. Not for discovery — search first with deep_web_search.', category: 'web_network', riskLevel: 'low', schema: { type: 'object', properties: { url: { type: 'string', description: 'URL to browse' } }, required: ['url'] }, composable: true, source: 'builtin' },

  // ═══ IMAGE ═══
  { id: 'image_view', name: 'Image Info', description: 'Get image metadata', modelDescription: 'Show image dimensions, format, and file size.', category: 'media_image', riskLevel: 'low', schema: { type: 'object', properties: { file: { type: 'string', description: 'Image file path' } }, required: ['file'] }, composable: true, source: 'builtin' },
  { id: 'image_resize', name: 'Resize Image', description: 'Resize an image', modelDescription: 'Resize an image to specified width (and optionally height). Uses sips (macOS) or ImageMagick.', category: 'media_image', riskLevel: 'medium', schema: { type: 'object', properties: { file: { type: 'string', description: 'Image file path' }, width: { type: 'number', description: 'Target width in pixels' }, height: { type: 'number', description: 'Target height (optional, maintains aspect ratio)' }, output: { type: 'string', description: 'Output file path (default: overwrite)' } }, required: ['file', 'width'] }, composable: true, source: 'builtin' },
  { id: 'image_convert', name: 'Convert Image', description: 'Convert image format', modelDescription: 'Convert an image to a different format (png, jpg, webp, gif, bmp).', category: 'media_image', riskLevel: 'medium', schema: { type: 'object', properties: { file: { type: 'string', description: 'Source image path' }, format: { type: 'string', description: 'Target format: png, jpg, webp, gif, bmp' }, output: { type: 'string', description: 'Output path (optional)' } }, required: ['file', 'format'] }, composable: true, source: 'builtin' },
  { id: 'image_ocr', name: 'Image OCR', description: 'Extract text from an image', modelDescription: 'Extract text from an image using OCR (Tesseract). Use this to read text from screenshots, photos of documents, scanned pages, etc.', category: 'media_image', riskLevel: 'low', schema: { type: 'object', properties: { path: { type: 'string', description: 'Path to the image file' } }, required: ['path'] }, composable: true, source: 'builtin' },

  // ═══ PROJECT ═══
  { id: 'project_detect', name: 'Detect Project', description: 'Auto-detect project type and tools', modelDescription: 'Detect language, framework, package manager, build tool, and test framework from project files.', category: 'project_management', riskLevel: 'low', schema: { type: 'object', properties: {}, required: [] }, composable: true, source: 'builtin' },

  // ═══ AI META-TOOLS ═══
  { id: 'ai_complete', name: 'AI Complete', description: 'Get AI code completion', modelDescription: 'Get AI-powered code completion suggestions for a given context.', category: 'ai_meta', riskLevel: 'low', schema: { type: 'object', properties: { prompt: { type: 'string', description: 'Code context / prompt for completion' }, maxTokens: { type: 'number', description: 'Max tokens (default: 256)' } }, required: ['prompt'] }, composable: true, source: 'builtin' },
  { id: 'ai_embed', name: 'AI Embed', description: 'Generate text embeddings', modelDescription: 'Generate embeddings for text input using the configured LLM provider.', category: 'ai_meta', riskLevel: 'low', schema: { type: 'object', properties: { text: { type: 'string', description: 'Text to embed' } }, required: ['text'] }, composable: true, source: 'builtin' },
  { id: 'ai_summarize', name: 'AI Summarize', description: 'Summarize text using AI', modelDescription: 'Summarize text content using the configured AI provider.', category: 'ai_meta', riskLevel: 'low', schema: { type: 'object', properties: { text: { type: 'string', description: 'Text to summarize' }, maxLength: { type: 'number', description: 'Max summary length (default: 200)' } }, required: ['text'] }, composable: true, source: 'builtin' },
  { id: 'ai_classify', name: 'AI Classify', description: 'Classify text into categories', modelDescription: 'Classify input text into predefined categories using AI.', category: 'ai_meta', riskLevel: 'low', schema: { type: 'object', properties: { text: { type: 'string', description: 'Text to classify' }, categories: { type: 'string', description: 'Comma-separated category list' } }, required: ['text', 'categories'] }, composable: true, source: 'builtin' },
  { id: 'ai_extract', name: 'AI Extract', description: 'Extract structured data from text', modelDescription: 'Extract structured information from unstructured text using AI.', category: 'ai_meta', riskLevel: 'low', schema: { type: 'object', properties: { text: { type: 'string', description: 'Text to extract from' }, schema: { type: 'string', description: 'Description of what to extract (JSON-like)' } }, required: ['text', 'schema'] }, composable: true, source: 'builtin' },
  { id: 'memory_store', name: 'Memory Store', description: 'Store a value in agent memory', modelDescription: 'Store a key-value pair in the agent\'s persistent memory.', category: 'ai_meta', riskLevel: 'low', schema: { type: 'object', properties: { key: { type: 'string', description: 'Memory key' }, value: { type: 'string', description: 'Value to store' } }, required: ['key', 'value'] }, composable: true, source: 'builtin' },
  { id: 'memory_recall', name: 'Memory Recall', description: 'Recall a value from agent memory', modelDescription: 'Retrieve a value from the agent\'s persistent memory by key. Alias: memory_read.', category: 'ai_meta', riskLevel: 'low', schema: { type: 'object', properties: { key: { type: 'string', description: 'Memory key' } }, required: ['key'] }, composable: true, source: 'builtin' },
  { id: 'memory_read', name: 'Memory Read', description: 'Read agent memory by key', modelDescription: 'Read persistent agent memory by key (alias for memory_recall).', category: 'ai_meta', riskLevel: 'low', schema: { type: 'object', properties: { key: { type: 'string', description: 'Memory key' } }, required: ['key'] }, composable: true, source: 'builtin' },
  { id: 'memory_search', name: 'Memory Search', description: 'Search agent memory by keyword', modelDescription: 'Search stored agent memories by key or value substring. Read-only.', category: 'ai_meta', riskLevel: 'low', schema: { type: 'object', properties: { query: { type: 'string', description: 'Search keyword' } }, required: ['query'] }, composable: true, source: 'builtin' },
  { id: 'rag_search', name: 'RAG Search', description: 'Semantic search over indexed codebase', modelDescription: 'Search indexed codebase chunks by meaning (requires /index or rag.enabled). Read-only — use for @codebase-style context.', category: 'ai_meta', riskLevel: 'low', schema: { type: 'object', properties: { query: { type: 'string', description: 'Natural language search query' }, limit: { type: 'number', description: 'Max results (default: 8)' } }, required: ['query'] }, composable: true, source: 'builtin' },
  { id: 'memory_fabric_search', name: 'Memory Fabric Search', description: 'Semantic search over ingested RAG Studio documents', modelDescription: 'Search documents uploaded via RAG Studio (PDFs, text files, web distillations) by semantic meaning. Returns relevant chunks, extracted entities, and graph-walked related context. Use this when the user asks about content from uploaded documents. Read-only.', category: 'ai_meta', riskLevel: 'low', schema: { type: 'object', properties: { query: { type: 'string', description: 'Natural language search query' }, limit: { type: 'number', description: 'Max results (default: 8)' }, includeChunks: { type: 'boolean', description: 'Include raw document chunks in results (default: true)' } }, required: ['query'] }, composable: true, source: 'builtin' },

  // ═══ COMMUNICATION ═══
  { id: 'notify_desktop', name: 'Desktop Notification', description: 'Send a desktop notification', modelDescription: 'Display a desktop notification to the user. Works on macOS, Linux, and Windows.', category: 'communication', riskLevel: 'low', schema: { type: 'object', properties: { title: { type: 'string', description: 'Notification title' }, message: { type: 'string', description: 'Notification message body' } }, required: ['title', 'message'] }, composable: true, source: 'builtin' },
  { id: 'notify_telegram', name: 'Telegram Notification', description: 'Send a Telegram message', modelDescription: 'Send a notification/message via Telegram bot.', category: 'communication', riskLevel: 'low', schema: { type: 'object', properties: { message: { type: 'string', description: 'Message text' } }, required: ['message'] }, composable: true, source: 'builtin' },
  { id: 'notify_slack', name: 'Slack Notification', description: 'Send a Slack message', modelDescription: 'Send a notification/message via Slack webhook.', category: 'communication', riskLevel: 'low', schema: { type: 'object', properties: { message: { type: 'string', description: 'Message text' } }, required: ['message'] }, composable: true, source: 'builtin' },
  { id: 'notify_email', name: 'Email Notification', description: 'Send an email notification', modelDescription: 'Send a notification via configured SMTP (Settings → Channels).', category: 'communication', riskLevel: 'low', schema: { type: 'object', properties: { message: { type: 'string', description: 'Message body' }, subject: { type: 'string', description: 'Email subject' } }, required: ['message'] }, composable: true, source: 'builtin' },
  { id: 'notify_discord', name: 'Discord Notification', description: 'Send a Discord message', modelDescription: 'Send a notification via Discord webhook (Settings → Channels).', category: 'communication', riskLevel: 'low', schema: { type: 'object', properties: { message: { type: 'string', description: 'Message text' } }, required: ['message'] }, composable: true, source: 'builtin' },
  { id: 'clipboard_read', name: 'Read Clipboard', description: 'Read text from clipboard', modelDescription: 'Read the current text content from the system clipboard.', category: 'communication', riskLevel: 'medium', schema: { type: 'object', properties: {}, required: [] }, composable: true, source: 'builtin' },
  { id: 'clipboard_write', name: 'Write Clipboard', description: 'Copy text to clipboard', modelDescription: 'Write text to the system clipboard.', category: 'communication', riskLevel: 'low', schema: { type: 'object', properties: { text: { type: 'string', description: 'Text to copy' } }, required: ['text'] }, composable: true, source: 'builtin' },

  // ═══ SECURITY ═══
  { id: 'encrypt_file', name: 'Encrypt File', description: 'Encrypt a file with AES-256', modelDescription: 'Encrypt a file using AES-256-GCM with a passphrase.', category: 'security_crypto', riskLevel: 'critical', schema: { type: 'object', properties: { file: { type: 'string', description: 'File to encrypt' }, passphrase: { type: 'string', description: 'Encryption passphrase' } }, required: ['file', 'passphrase'] }, composable: true, source: 'builtin' },
  { id: 'decrypt_file', name: 'Decrypt File', description: 'Decrypt a file with AES-256', modelDescription: 'Decrypt a file encrypted with AES-256-GCM using the passphrase.', category: 'security_crypto', riskLevel: 'critical', schema: { type: 'object', properties: { file: { type: 'string', description: 'File to decrypt (.enc)' }, passphrase: { type: 'string', description: 'Decryption passphrase' } }, required: ['file', 'passphrase'] }, composable: true, source: 'builtin' },
  { id: 'jwt_decode', name: 'Decode JWT', description: 'Decode a JWT token', modelDescription: 'Decode a JWT token and show its header and payload (no signature verification).', category: 'security_crypto', riskLevel: 'low', schema: { type: 'object', properties: { token: { type: 'string', description: 'JWT token string' } }, required: ['token'] }, composable: true, source: 'builtin' },
  { id: 'secret_generate', name: 'Generate Secret', description: 'Generate a cryptographically secure secret', modelDescription: 'Generate a random secret key with configurable length and encoding.', category: 'security_crypto', riskLevel: 'low', schema: { type: 'object', properties: { length: { type: 'number', description: 'Length (default: 32)' }, encoding: { type: 'string', description: 'hex, base64, base64url (default: hex)' } }, required: [] }, composable: true, source: 'builtin' },

  // ═══ MEDIA ═══
  { id: 'chart_generate', name: 'Generate Chart', description: 'Generate a chart/plot as image', modelDescription: 'Create a chart or plot as an image file (bar, line, pie) from data.', category: 'media_image', riskLevel: 'medium', schema: { type: 'object', properties: { file: { type: 'string', description: 'Output file path (.png)' }, type: { type: 'string', description: 'Chart type: bar, line, pie' }, title: { type: 'string', description: 'Chart title' }, labels: { type: 'array', description: 'X-axis labels' }, datasets: { type: 'array', description: 'Array of {label, data, color} objects' }, width: { type: 'number', description: 'Chart width (default: 800)' }, height: { type: 'number', description: 'Chart height (default: 600)' } }, required: ['file', 'type', 'labels', 'datasets'] }, composable: true, source: 'builtin' },
  { id: 'qr_generate', name: 'Generate QR Code', description: 'Generate a QR code image', modelDescription: 'Create a QR code PNG image from text/URL data.', category: 'media_image', riskLevel: 'low', schema: { type: 'object', properties: { file: { type: 'string', description: 'Output file path (.png)' }, data: { type: 'string', description: 'Data to encode in QR code' }, size: { type: 'number', description: 'QR code size in pixels (default: 256)' } }, required: ['file', 'data'] }, composable: true, source: 'builtin' },

  // ═══ TELEGRAM ═══
  { id: 'telegram_send_message', name: 'Send Message via Telegram', description: 'Send a text message or progress update to the user on Telegram', modelDescription: 'Send a message to the user via Telegram. Use this to notify the user of progress, ask a quick question, or send a status update when the user is not actively watching the terminal or web UI. Only use if the user previously agreed to receive Telegram updates.', category: 'communication', riskLevel: 'low', schema: { type: 'object', properties: { message: { type: 'string', description: 'The message text to send to the user' } }, required: ['message'] }, composable: true, source: 'builtin' },
  { id: 'telegram_send_file', name: 'Send File via Telegram', description: 'Upload and send a file to the user via Telegram', modelDescription: 'Send/upload a file to the user via Telegram. Use this when the user asks you to share, send, or upload a file. The file must exist on disk.', category: 'communication', riskLevel: 'medium', schema: { type: 'object', properties: { path: { type: 'string', description: 'Path to the file to send' }, caption: { type: 'string', description: 'Optional caption/description for the file' } }, required: ['path'] }, composable: true, source: 'builtin' },

  // ═══ AGENT META-TOOLS ═══
  { id: 'todo_write', name: 'Write Todos', description: 'Create or update session task list', modelDescription: 'Update the TASKS panel. merge:false replaces all; merge:true updates by id. Status: pending, in_progress, completed.', category: 'agent_meta', riskLevel: 'low', schema: { type: 'object', properties: { merge: { type: 'boolean', description: 'Merge with existing (default: false)' }, todos: { type: 'array', description: 'Array of {id?, content, status?}' } }, required: ['todos'] }, composable: false, source: 'builtin' },
  { id: 'todo_read', name: 'Read Todos', description: 'List session tasks', modelDescription: 'Read current todos from the TASKS panel.', category: 'agent_meta', riskLevel: 'low', schema: { type: 'object', properties: {}, required: [] }, composable: true, source: 'builtin' },
  { id: 'todo_delete', name: 'Delete Todo', description: 'Remove a todo or clear all', modelDescription: 'Delete todo by id or clear:true for all.', category: 'agent_meta', riskLevel: 'low', schema: { type: 'object', properties: { id: { type: 'number', description: 'Todo id to delete' }, clear: { type: 'boolean', description: 'Clear all todos' } }, required: [] }, composable: true, source: 'builtin' },
  { id: 'ask_clarification', name: 'Ask Clarifying Question', description: 'Present structured choice options via questionnaire UI (web/Telegram buttons)', modelDescription: 'ONLY for single_choice or multi_choice — structured options rendered as UI buttons/checkboxes. NEVER for open-ended or custom-text questions (ask those in plain assistant message text instead). DEFAULT: one choice question per call. Wait for the answer before calling again. Types allowed: single_choice (max 5 + custom via chat), multi_choice (max 5 + custom via chat). Do NOT use type "text" — rejected at runtime. Legacy question+options shape works when options are provided.', category: 'agent_meta', riskLevel: 'low', schema: { type: 'object', properties: { title: { type: 'string', description: 'Optional heading — mainly for multi-question forms' }, questions: { type: 'array', description: 'Usually ONE question (default). Use 2+ only for bundled complex intake.', items: { type: 'object', properties: { id: { type: 'string', description: 'Stable question id (optional)' }, prompt: { type: 'string', description: 'Question text shown to the user' }, type: { type: 'string', enum: ['text', 'single_choice', 'multi_choice'], description: 'Question input type' }, options: { type: 'array', maxItems: 5, items: { type: 'string', description: 'Choice label' }, description: 'Up to 5 choices for single/multi choice' }, allowCustom: { type: 'boolean', description: 'Allow typed custom answer (default true for choice types)' }, required: { type: 'boolean', description: 'Whether answer is required (default true)' }, placeholder: { type: 'string', description: 'Placeholder for text questions' }, multiline: { type: 'boolean', description: 'Use textarea for text questions' }, recommended: { type: 'string', description: 'Suggested option (must match an option value)' } }, required: ['prompt', 'type'] } }, question: { type: 'string', description: 'Legacy single question text' }, options: { type: 'array', maxItems: 5, items: { type: 'string', description: 'A choice option' }, description: 'Legacy choice strings (max 5)' }, multiple: { type: 'boolean', description: 'Legacy: true = multi choice checkboxes' }, allowFreeform: { type: 'boolean', description: 'Legacy: allow custom text answer on choice questions (default true)' }, recommended: { type: 'string', description: 'Legacy recommended option' }, fields: { type: 'array', items: { type: 'object', properties: { key: { type: 'string' }, label: { type: 'string' }, placeholder: { type: 'string' }, type: { type: 'string' }, required: { type: 'boolean' } }, required: ['key', 'label'] }, description: 'Legacy structured fields (each becomes a text question)' } }, required: [] }, composable: false, source: 'builtin' },
  { id: 'channel_permissions', name: 'Channel Permissions', description: 'List or revoke remembered tool permissions on messaging channels', modelDescription: 'On Telegram/messaging channel sessions only. action "list" shows always-allowed and denied tools. action "revoke" with tools[] revokes specific tools; revoke_all:true clears all remembered permissions. Use when the user asks what is allowed/denied or wants to revoke permissions.', category: 'agent_meta', riskLevel: 'low', schema: { type: 'object', properties: { action: { type: 'string', enum: ['list', 'revoke'], description: 'list or revoke' }, tools: { type: 'array', items: { type: 'string' }, description: 'Tool ids to revoke' }, revoke_all: { type: 'boolean', description: 'Revoke all remembered permissions' } }, required: ['action'] }, composable: false, source: 'builtin' },
  { id: 'delegate_to_subagent', name: 'Delegate to Sub-Agent', description: 'Spawn a specialist sub-agent to handle a parallel task', modelDescription: 'Delegate work to an isolated sub-agent that executes with its own tools and memory. For BATCH processing, provide "items" (array of strings) and "batchSize" — the tool will auto-parallelize across multiple sub-agents. For single tasks, use "mission". Set "background":true to return immediately while the sub-agent works async.', category: 'agent_meta', riskLevel: 'low', schema: { type: 'object', properties: { mission: { type: 'string', description: 'Clear, specific mission. Use for single tasks. Ignored if "items" is provided.' },           items: { type: 'array', items: { type: 'string', description: 'An item to process' }, description: 'Array of items to process in parallel. Each item gets its own sub-agent (or chunked by batchSize).' }, batchSize: { type: 'number', description: 'Number of items per sub-agent (default: 10). Only used with "items".' }, tools: { type: 'array', description: 'Optional list of tool IDs the sub-agent can use. If omitted, all tools are available.' }, timeout: { type: 'number', description: 'Timeout in milliseconds per sub-agent (default: 120000)' }, background: { type: 'boolean', description: 'Run in background — return immediately, results accessible via task API (default: false)' } }, required: [] }, composable: false, source: 'builtin' },
  { id: 'script_run', name: 'Run Script', description: 'Execute a script snippet in Node/TS/Python/Bash', modelDescription: 'PRIMARY tool for ad-hoc scripts. language: auto (default — matches project: JS/TS for package.json repos, Python for pyproject). Args in `args` object, available as __args (JS) or __args dict (Python). Prefer over python_rpc in JS/TS projects. mode: file (default) or eval (short JS only).', category: 'agent_meta', riskLevel: 'medium', schema: { type: 'object', properties: { script: { type: 'string', description: 'Script source code' }, language: { type: 'string', description: 'auto | javascript | typescript | python | bash' }, args: { type: 'object', description: 'JSON args passed to script' }, timeout: { type: 'number', description: 'Timeout ms (default: 60000)' }, mode: { type: 'string', description: 'file (default) or eval (short JS snippets)' } }, required: ['script'] }, composable: false, source: 'builtin' },
  { id: 'node_rpc', name: 'Run JavaScript/TypeScript', description: 'Execute JS/TS in Node (no Python required)', modelDescription: 'Run JavaScript or TypeScript snippets via Node/tsx. Use for data transforms, JSON processing, quick logic in JS/TS repos. Args via `args` → __args in script. Prefer this over python_rpc when the project uses Node.', category: 'agent_meta', riskLevel: 'medium', schema: { type: 'object', properties: { script: { type: 'string', description: 'JS/TS code to execute' }, language: { type: 'string', description: 'javascript (default) or typescript' }, args: { type: 'object', description: 'Arguments as JSON object' }, timeout: { type: 'number', description: 'Timeout ms (default: 60000)' } }, required: ['script'] }, composable: false, source: 'builtin' },
  { id: 'python_rpc', name: 'Execute Python Script', description: 'Run Python code in an isolated subprocess', modelDescription: 'Python-only scripts when Python libs are needed (pandas, numpy, etc.). Requires Python runtime. For JS/TS projects use script_run or node_rpc instead. Args via PYTHON_RPC_ARGS env / __args in script.', category: 'agent_meta', riskLevel: 'medium', schema: { type: 'object', properties: { script: { type: 'string', description: 'Python code to execute' }, args: { type: 'object', description: 'Arguments to pass to the script (accessible via os.environ)' }, timeout: { type: 'number', description: 'Timeout in ms (default: 60000)' } }, required: ['script'] }, composable: false, source: 'builtin' },

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
  executor.registerHandler('read_file', aliases.readFile);
  executor.registerHandler('read', aliases.read);
  executor.registerHandler('cat', aliases.cat);
  executor.registerHandler('file_read_batch', fs.fileReadBatch);
  executor.registerHandler('file_write', fs.fileWrite);
  executor.registerHandler('write_file', aliases.writeFile);
  executor.registerHandler('file_delete', fs.fileDelete);
  executor.registerHandler('delete_file', aliases.deleteFile);
  executor.registerHandler('folder_create', fs.folderCreate);
  executor.registerHandler('create_dir', aliases.createDir);
  executor.registerHandler('folder_delete', fs.folderDelete);
  executor.registerHandler('folder_list', fs.folderList);
  executor.registerHandler('list_dir', aliases.listDir);
  executor.registerHandler('folder_move', fs.folderMove);
  executor.registerHandler('file_find', fs.fileFind);
  executor.registerHandler('glob', aliases.glob);
  executor.registerHandler('search_files', aliases.searchFiles);
  executor.registerHandler('file_copy', fs.fileCopy);
  executor.registerHandler('file_diff', fs.fileDiff);
  executor.registerHandler('file_metadata', fs.fileMetadata);
  executor.registerHandler('file_info', aliases.fileInfo);
  executor.registerHandler('file_open', fs.fileOpen);
  executor.registerHandler('folder_tree', fs.folderTree);
  executor.registerHandler('folder_open', fs.folderOpen);
  executor.registerHandler('archive_create', fs.archiveCreate);
  executor.registerHandler('archive_extract', fs.archiveExtract);

  // ═══ Shell & Process ═══
  executor.registerHandler('shell_exec', shell.shellExec);
  executor.registerHandler('bash', aliases.bash);
  executor.registerHandler('run_command', aliases.runCommand);
  executor.registerHandler('execute', aliases.execute);
  executor.registerHandler('shell_background', shell.shellBackground);
  executor.registerHandler('process_kill', shell.processKill);
  executor.registerHandler('process_list', shell.processList);
  executor.registerHandler('shell_exec_streaming', shell.shellExecStreaming);

  // ═══ SSH ═══
  executor.registerHandler('ssh_exec', ssh.sshExec);
  executor.registerHandler('ssh_scp', ssh.sshScp);
  executor.registerHandler('ssh_key_add', ssh.sshKeyAdd);

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
  executor.registerHandler('git_init', git.gitInit);
  executor.registerHandler('git_clone', git.gitClone);
  executor.registerHandler('git_remote', git.gitRemote);
  executor.registerHandler('git_tag', git.gitTag);
  executor.registerHandler('git_reset', git.gitReset);
  executor.registerHandler('git_cherry_pick', git.gitCherryPick);
  executor.registerHandler('git_rebase', git.gitRebase);
  executor.registerHandler('git_config', git.gitConfig);

  // ═══ Code Intelligence ═══
  executor.registerHandler('code_search', code.codeSearch);
  executor.registerHandler('code_replace', code.codeReplace);
  executor.registerHandler('code_insert', code.codeInsert);
  executor.registerHandler('code_definitions', code.codeDefinitions);
  executor.registerHandler('code_symbols', code.codeSymbols);
  executor.registerHandler('file_patch', code.filePatch);
  executor.registerHandler('apply_patch', aliases.applyPatch);
  executor.registerHandler('file_edit', aliases.fileEdit);
  executor.registerHandler('code_range', code.codeRange);
  executor.registerHandler('code_grep', code.codeGrep);
  executor.registerHandler('grep', aliases.grep);
  executor.registerHandler('code_references', code.codeReferences);
  executor.registerHandler('code_format', code.codeFormat);
  executor.registerHandler('code_lint', code.codeLint);
  executor.registerHandler('code_fix', code.codeFix);
  executor.registerHandler('code_typecheck', code.codeTypecheck);
  executor.registerHandler('code_analyze', code.codeAnalyze);

  // ═══ Documents ═══
  executor.registerHandler('csv_create', documents.csvCreate);
  executor.registerHandler('pdf_create', documents.pdfCreate);
  executor.registerHandler('docx_create', documents.docxCreate);
  executor.registerHandler('pptx_create', documents.pptxCreate);
  executor.registerHandler('xlsx_create', documents.xlsxCreate);
  executor.registerHandler('pdf_read', documents.pdfRead);
  executor.registerHandler('docx_read', documents.docxRead);
  executor.registerHandler('xlsx_read', documents.xlsxRead);
  executor.registerHandler('pptx_read', documents.pptxRead);
  executor.registerHandler('doc_markdown', documents.docMarkdown);
  executor.registerHandler('doc_html', documents.docHtml);
  executor.registerHandler('doc_json', documents.docJson);
  executor.registerHandler('doc_yaml', documents.docYaml);
  executor.registerHandler('doc_diagram', documents.docDiagram);
  executor.registerHandler('doc_latex', documents.docLatex);

  // ═══ Automation (scheduling) ═══
  executor.registerHandler('automation_register', automation.automationRegister);
  executor.registerHandler('automation_list', automation.automationList);
  executor.registerHandler('automation_cancel', automation.automationCancel);
  executor.registerHandler('agent_x_overview', agentXOverview.agentXOverview);
  executor.registerHandler('channel_permissions', channelPermissions.channelPermissions);

  // ═══ Sub-Agents ═══
  executor.registerHandler('sub_agent_spawn', subagent.subAgentSpawn);
  executor.registerHandler('sub_agent_status', subagent.subAgentStatus);
  executor.registerHandler('sub_agent_cancel', subagent.subAgentCancel);

  // ═══ Crew Delegation ═══
  executor.registerHandler('delegate_to_crew', crewdelegate.delegateToCrew);
  executor.registerHandler('spawn_crew_workers', spawncrew.spawnCrewWorkers);
  executor.registerHandler('crew_message', crewmessage.crewMessage);
  executor.registerHandler('crew_response', crewmessage.crewResponse);
  executor.registerHandler('search_crew_hub', searchcrewhub.searchCrewHub);

  // ═══ Browser ═══
  executor.registerHandler('browser_open', browser.browserOpen);
  executor.registerHandler('browser_screenshot', browser.browserScreenshot);
  executor.registerHandler('browser_click', browser.browserClick);
  executor.registerHandler('browser_eval', browser.browserEval);
  executor.registerHandler('browser_type', browser.browserType);
  executor.registerHandler('browser_extract', browser.browserExtract);

  // ═══ Containers ═══
  executor.registerHandler('container_list', containers.containerList);
  executor.registerHandler('container_logs', containers.containerLogs);
  executor.registerHandler('container_start', containers.containerStart);
  executor.registerHandler('container_stop', containers.containerStop);
  executor.registerHandler('container_exec', containers.containerExec);
  executor.registerHandler('container_run', containers.containerRun);
  executor.registerHandler('container_compose', containers.containerCompose);
  executor.registerHandler('container_images', containers.containerImages);
  executor.registerHandler('docker_build', containers.dockerBuild);

  // ═══ Data Processing ═══
  executor.registerHandler('json_parse', data.jsonParse);
  executor.registerHandler('json_query', data.jsonQuery);
  executor.registerHandler('json_set', data.jsonSet);
  executor.registerHandler('csv_parse', data.csvParse);
  executor.registerHandler('text_transform', data.textTransform);
  executor.registerHandler('regex_match', data.regexMatch);
  executor.registerHandler('text_diff', data.textDiff);
  executor.registerHandler('validate_schema', data.validateSchema);
  executor.registerHandler('render_chart', data.renderChart);

  // ═══ Database ═══
  executor.registerHandler('db_query', database.dbQuery);
  executor.registerHandler('db_schema', database.dbSchema);
  executor.registerHandler('db_export', database.dbExport);
  executor.registerHandler('env_read', database.envRead);
  executor.registerHandler('db_migrate', database.dbMigrate);

  // ═══ GitHub ═══
  executor.registerHandler('gh_issue_list', github.ghIssueList);
  executor.registerHandler('gh_issue_create', github.ghIssueCreate);
  executor.registerHandler('gh_pr_list', github.ghPrList);
  executor.registerHandler('gh_pr_create', github.ghPrCreate);
  executor.registerHandler('gh_pr_view', github.ghPrView);
  executor.registerHandler('gh_repo_view', github.ghRepoView);
  executor.registerHandler('gh_workflow_list', github.ghWorkflowList);
  executor.registerHandler('gh_release', github.ghRelease);
  executor.registerHandler('gh_pr_review', github.ghPrReview);

  // ═══ Packages ═══
  executor.registerHandler('package_install', packages.packageInstall);
  executor.registerHandler('package_remove', packages.packageRemove);
  executor.registerHandler('package_list', packages.packageList);
  executor.registerHandler('package_outdated', packages.packageOutdated);
  executor.registerHandler('package_run', packages.packageRun);
  executor.registerHandler('pkg_update', packages.pkgUpdate);
  executor.registerHandler('pkg_audit', packages.pkgAudit);
  executor.registerHandler('pkg_search', packages.pkgSearch);

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
  executor.registerHandler('system_monitor', system.systemMonitor);
  executor.registerHandler('cron_create', system.cronCreate);
  executor.registerHandler('open_app', system.openApp);

  // ═══ Testing ═══
  executor.registerHandler('test_run', testing.testRun);
  executor.registerHandler('test_watch', testing.testWatch);
  executor.registerHandler('test_coverage', testing.testCoverage);
  executor.registerHandler('test_create', testing.testCreate);
  executor.registerHandler('benchmark_run', testing.benchmarkRun);

  // ═══ Build ═══
  executor.registerHandler('build', build.build);
  executor.registerHandler('build_run', build.buildRun);
  executor.registerHandler('build_check', build.buildCheck);
  executor.registerHandler('build_clean', build.buildClean);

  // ═══ Web ═══
  executor.registerHandler('http_get', web.httpGet);
  executor.registerHandler('web_fetch', aliases.webFetch);
  executor.registerHandler('http_post', web.httpPost);
  executor.registerHandler('http_request', web.httpRequest);
  executor.registerHandler('web_scrape', web.webScrape);
  executor.registerHandler('web_search', web.webSearch);
  executor.registerHandler('deep_web_search', deepWeb.deepWebSearch);
  executor.registerHandler('http_download', web.httpDownload);
  executor.registerHandler('web_browse', web.webBrowse);

  // ═══ Image ═══
  executor.registerHandler('image_view', image.imageView);
  executor.registerHandler('image_resize', image.imageResize);
  executor.registerHandler('image_convert', image.imageConvert);
  executor.registerHandler('image_ocr', image.imageOcr);

  // ═══ Project ═══
  executor.registerHandler('project_detect', project.projectDetect);

  // ═══ AI Meta-Tools ═══
  executor.registerHandler('ai_complete', ai.aiComplete);
  executor.registerHandler('ai_embed', ai.aiEmbed);
  executor.registerHandler('ai_summarize', ai.aiSummarize);
  executor.registerHandler('ai_classify', ai.aiClassify);
  executor.registerHandler('ai_extract', ai.aiExtract);
  executor.registerHandler('memory_store', ai.memoryStore);
  executor.registerHandler('memory_recall', ai.memoryRecall);
  executor.registerHandler('memory_read', aliases.memoryRead);
  executor.registerHandler('memory_search', aliases.memorySearch);
  executor.registerHandler('rag_search', aliases.ragSearch);
  executor.registerHandler('memory_fabric_search', aliases.memoryFabricSearch);

  // ═══ Communication ═══
  executor.registerHandler('notify_desktop', notifications.notifyDesktop);
  executor.registerHandler('notify_telegram', notifications.notifyTelegram);
  executor.registerHandler('notify_slack', notifications.notifySlack);
  executor.registerHandler('notify_email', notifications.notifyEmail);
  executor.registerHandler('notify_discord', notifications.notifyDiscord);
  executor.registerHandler('clipboard_read', notifications.clipboardRead);
  executor.registerHandler('clipboard_write', notifications.clipboardWrite);
  executor.registerHandler('save_to_markdown', markdownTool.saveToMarkdown);

  // ═══ Security ═══
  executor.registerHandler('encrypt_file', security.encryptFile);
  executor.registerHandler('decrypt_file', security.decryptFile);
  executor.registerHandler('jwt_decode', security.jwtDecode);
  executor.registerHandler('secret_generate', security.secretGenerate);

  // ═══ Media ═══
  executor.registerHandler('chart_generate', media.chartGenerate);
  executor.registerHandler('qr_generate', media.qrGenerate);

  // ═══ Agent Meta-Tools ═══
  executor.registerHandler('todo_write', todo.todoWrite);
  executor.registerHandler('todo_read', todo.todoRead);
  executor.registerHandler('todo_delete', todo.todoDelete);
  executor.registerHandler('ask_clarification', async () => ({
    success: false,
    output: 'ask_clarification must run via the AI SDK tool path (createAiSdkTools), not ToolExecutor directly.',
    error: 'USE_AISDK_PATH',
  }));
  executor.registerHandler('delegate_to_subagent', async () => ({
    success: false,
    output: 'delegate_to_subagent must run via the AI SDK tool path (createAiSdkTools), not ToolExecutor directly.',
    error: 'USE_AISDK_PATH',
  }));
  executor.registerHandler('script_run', script.scriptRun);
  executor.registerHandler('node_rpc', script.nodeRpc);
  executor.registerHandler('python_rpc', script.pythonRpc);

  // ═══ Telegram ═══
  // Uses global TelegramBridge instance if active (set by daemon on bridge creation)
  // Falls back to NOT_AVAILABLE if no bridge is running
  executor.registerHandler('telegram_send_message', async (args) => {
    const { getActiveTelegramBridge } = await import('../telegram/index.js');
    const bridge = getActiveTelegramBridge();
    if (!bridge || !bridge.isRunning()) {
      return {
        success: false,
        output: 'Telegram is not active. Start it with /telegram start in daemon mode.',
        error: 'NOT_AVAILABLE',
      };
    }
    const message = args['message'] as string | undefined;
    if (!message) {
      return { success: false, output: 'No message provided.', error: 'MISSING_ARG' };
    }
    try {
      // Bridge remembers the last active chat internally
      await bridge.sendMessage(0, message);
      return { success: true, output: 'Message sent via Telegram' };
    } catch (err) {
      return { success: false, output: `Telegram send failed: ${err instanceof Error ? err.message : String(err)}`, error: 'SEND_FAILED' };
    }
  });

  executor.registerHandler('telegram_send_file', async (args) => {
    // Dynamic import to avoid circular dependency
    const { getActiveTelegramBridge } = await import('../telegram/index.js');
    const bridge = getActiveTelegramBridge();
    if (!bridge || !bridge.isRunning()) {
      return {
        success: false,
        output: 'Telegram is not active. Start it with /telegram start in daemon mode.',
        error: 'NOT_AVAILABLE',
      };
    }
    const filePath = args['path'] as string | undefined;
    const chatId = args['chatId'] as string | undefined;
    if (!filePath) {
      return { success: false, output: 'No file path provided.', error: 'MISSING_ARG' };
    }
    try {
      const targetChatId = chatId ? Number(chatId) : 0;
      const result = await bridge.sendDocumentToChat(targetChatId, filePath);
      return { success: result.ok, output: result.ok ? `File sent via Telegram` : (result.description ?? 'Failed to send file') };
    } catch (err) {
      return { success: false, output: `Telegram send failed: ${err instanceof Error ? err.message : String(err)}`, error: 'SEND_FAILED' };
    }
  });

  return { registry, executor };
}

export { CORE_TOOLS, SUBAGENT_TYPES };
