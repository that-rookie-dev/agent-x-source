# Agentic AI Tools — Comprehensive Reference

**Purpose**: Catalog of all possible tools an AI agent can leverage. Use as a building roadmap for Agent-X.  
**Date**: 2026-05-22  
**Status**: Reference document for future implementation phases

---

## 1. Filesystem Tools

| Tool | Description | Risk Level |
|------|-------------|------------|
| `file-read` | Read file contents (full or range) | Low |
| `file-write` | Create or overwrite a file | Medium |
| `file-edit` | Replace specific content in a file (surgical edit) | Medium |
| `file-delete` | Delete a file | High |
| `file-move` | Move/rename a file | Medium |
| `file-copy` | Duplicate a file | Low |
| `file-search` | Search for files by name/glob pattern | Low |
| `file-diff` | Show diff between two files or versions | Low |
| `file-patch` | Apply a unified diff/patch to a file | Medium |
| `file-watch` | Watch a file for changes (event-driven) | Low |
| `file-permissions` | Change file permissions (chmod) | High |
| `file-metadata` | Get file stats (size, modified, type, encoding) | Low |
| `file-open` | Open file in system default editor/viewer | Low |
| `folder-create` | Create directories (recursive) | Low |
| `folder-delete` | Remove directories | High |
| `folder-list` | List directory contents (with filters) | Low |
| `folder-tree` | Recursive directory tree visualization | Low |
| `folder-move` | Move/rename directories | High |
| `folder-open` | Open folder in system file explorer | Low |
| `folder-size` | Calculate directory size | Low |
| `symlink-create` | Create symbolic links | Medium |
| `archive-create` | Create zip/tar archives | Low |
| `archive-extract` | Extract archives | Medium |

---

## 2. Code Intelligence Tools

| Tool | Description | Risk Level |
|------|-------------|------------|
| `code-search` | Semantic code search (AST-aware) | Low |
| `code-grep` | Regex/text search across codebase | Low |
| `code-symbols` | List functions, classes, exports in a file | Low |
| `code-references` | Find all usages of a symbol | Low |
| `code-definition` | Go to definition of a symbol | Low |
| `code-rename` | Rename symbol across all references | High |
| `code-refactor` | Apply refactoring patterns (extract, inline, etc.) | High |
| `code-format` | Format code with project formatter | Low |
| `code-lint` | Run linter and return diagnostics | Low |
| `code-fix` | Auto-fix lint/compile errors | Medium |
| `code-typecheck` | Run type checker (tsc, mypy, etc.) | Low |
| `code-analyze` | Static analysis (complexity, dependencies) | Low |
| `code-generate` | Generate code from description/template | Medium |
| `code-explain` | Explain what a code block does | Low |
| `code-test-generate` | Generate unit tests for a function | Medium |
| `ast-parse` | Parse file into AST for inspection | Low |
| `ast-transform` | Transform AST nodes programmatically | High |
| `dependency-graph` | Build and query project dependency graph | Low |
| `import-organize` | Sort and optimize imports | Low |

---

## 3. Shell & Process Tools

| Tool | Description | Risk Level |
|------|-------------|------------|
| `shell-exec` | Execute shell command (with timeout) | High |
| `shell-exec-streaming` | Execute with real-time stdout/stderr streaming | High |
| `shell-background` | Start long-running background process | High |
| `shell-kill` | Kill a running process by PID/name | High |
| `shell-status` | Check if a background process is alive | Low |
| `shell-send-input` | Send input to an interactive process (stdin) | High |
| `process-list` | List running processes | Low |
| `port-check` | Check if a port is in use / wait for port | Low |
| `env-get` | Read environment variables | Low |
| `env-set` | Set environment variables (session-scoped) | Medium |

---

## 4. Git & Version Control Tools

| Tool | Description | Risk Level |
|------|-------------|------------|
| `git-status` | Show working tree status | Low |
| `git-diff` | Show uncommitted changes | Low |
| `git-log` | View commit history | Low |
| `git-add` | Stage files for commit | Low |
| `git-commit` | Create a commit | Medium |
| `git-branch` | Create/list/delete branches | Medium |
| `git-checkout` | Switch branches or restore files | Medium |
| `git-merge` | Merge branches | High |
| `git-rebase` | Rebase commits | High |
| `git-push` | Push to remote | High |
| `git-pull` | Pull from remote | Medium |
| `git-stash` | Stash/restore changes | Medium |
| `git-blame` | Show line-by-line authorship | Low |
| `git-cherry-pick` | Apply specific commits | Medium |
| `git-reset` | Reset HEAD to a commit | High |
| `git-tag` | Create/list tags | Medium |
| `git-clone` | Clone a repository | Medium |
| `git-conflict-resolve` | Detect and resolve merge conflicts | High |

---

## 5. Package Manager Tools

| Tool | Description | Risk Level |
|------|-------------|------------|
| `pkg-install` | Install dependencies (npm/pip/cargo/etc.) | Medium |
| `pkg-uninstall` | Remove a dependency | Medium |
| `pkg-update` | Update dependencies | Medium |
| `pkg-list` | List installed packages | Low |
| `pkg-outdated` | Check for outdated packages | Low |
| `pkg-audit` | Run security audit on dependencies | Low |
| `pkg-search` | Search package registry | Low |
| `pkg-info` | Get package metadata from registry | Low |
| `pkg-publish` | Publish a package to registry | High |
| `pkg-init` | Initialize a new package.json/pyproject.toml | Medium |
| `lockfile-update` | Regenerate lock file | Medium |

---

## 6. Web & Network Tools

| Tool | Description | Risk Level |
|------|-------------|------------|
| `http-request` | Make HTTP requests (GET/POST/PUT/DELETE) | Medium |
| `http-download` | Download file from URL | Medium |
| `web-scrape` | Extract content from a web page | Medium |
| `web-search` | Search the web (Google/Bing/DuckDuckGo) | Low |
| `web-browse` | Navigate and interact with web pages (headless) | Medium |
| `web-screenshot` | Take screenshot of a web page | Low |
| `api-call` | Call a structured API endpoint | Medium |
| `graphql-query` | Execute GraphQL queries | Medium |
| `websocket-connect` | Connect to WebSocket for real-time data | Medium |
| `dns-lookup` | Resolve domain names | Low |
| `ping` | Check host availability | Low |
| `curl` | Raw HTTP with full header control | Medium |
| `rss-read` | Parse and read RSS/Atom feeds | Low |

---

## 7. Database Tools

| Tool | Description | Risk Level |
|------|-------------|------------|
| `db-query` | Execute SQL query (SELECT only) | Low |
| `db-execute` | Execute SQL mutation (INSERT/UPDATE/DELETE) | High |
| `db-schema` | Inspect database schema | Low |
| `db-migrate` | Run database migrations | High |
| `db-seed` | Seed database with data | Medium |
| `db-backup` | Create database backup | Low |
| `db-restore` | Restore from backup | High |
| `db-connect` | Connect to remote database | Medium |
| `redis-get` | Read from Redis/cache | Low |
| `redis-set` | Write to Redis/cache | Medium |
| `vector-search` | Query vector database (Pinecone/Chroma/etc.) | Low |
| `vector-upsert` | Insert/update vectors | Medium |

---

## 8. Document Generation Tools

| Tool | Description | Risk Level |
|------|-------------|------------|
| `doc-markdown` | Generate Markdown documents | Low |
| `doc-pdf` | Generate PDF documents | Low |
| `doc-html` | Generate HTML pages | Low |
| `doc-csv` | Generate CSV/spreadsheet data | Low |
| `doc-json` | Generate structured JSON output | Low |
| `doc-yaml` | Generate YAML configuration | Low |
| `doc-diagram` | Generate diagrams (Mermaid/PlantUML/D2) | Low |
| `doc-slide` | Generate presentation slides | Low |
| `doc-template` | Render template with data (Handlebars/EJS) | Low |
| `doc-latex` | Generate LaTeX documents | Low |
| `doc-docx` | Generate Word documents | Low |
| `doc-excel` | Generate Excel spreadsheets | Low |

---

## 9. Testing Tools

| Tool | Description | Risk Level |
|------|-------------|------------|
| `test-run` | Run test suite (unit/integration) | Low |
| `test-run-single` | Run a specific test file or test case | Low |
| `test-watch` | Run tests in watch mode | Low |
| `test-coverage` | Generate coverage report | Low |
| `test-debug` | Run test with debugger attached | Low |
| `test-generate` | Auto-generate test cases from code | Medium |
| `test-mutate` | Run mutation testing | Low |
| `benchmark-run` | Run performance benchmarks | Low |
| `e2e-run` | Run end-to-end tests (Playwright/Cypress) | Medium |
| `e2e-record` | Record user interactions as test | Medium |

---

## 10. Container & Infrastructure Tools

| Tool | Description | Risk Level |
|------|-------------|------------|
| `docker-build` | Build Docker image | Medium |
| `docker-run` | Run a container | Medium |
| `docker-stop` | Stop a running container | Medium |
| `docker-logs` | View container logs | Low |
| `docker-exec` | Execute command in running container | High |
| `docker-compose-up` | Start docker-compose stack | Medium |
| `docker-compose-down` | Stop docker-compose stack | Medium |
| `docker-ps` | List running containers | Low |
| `k8s-apply` | Apply Kubernetes manifests | High |
| `k8s-get` | Get Kubernetes resources | Low |
| `k8s-logs` | View pod logs | Low |
| `k8s-exec` | Execute in a pod | High |
| `terraform-plan` | Plan infrastructure changes | Low |
| `terraform-apply` | Apply infrastructure changes | Critical |
| `cloud-deploy` | Deploy to cloud (AWS/GCP/Azure) | Critical |

---

## 11. Communication & Notification Tools

| Tool | Description | Risk Level |
|------|-------------|------------|
| `notify-desktop` | Show desktop notification | Low |
| `notify-telegram` | Send Telegram message | Medium |
| `notify-slack` | Send Slack message | Medium |
| `notify-discord` | Send Discord message | Medium |
| `notify-email` | Send email | Medium |
| `notify-webhook` | Call a webhook URL | Medium |
| `notify-sms` | Send SMS notification | Medium |
| `calendar-create` | Create calendar event | Medium |
| `calendar-list` | List upcoming events | Low |
| `clipboard-read` | Read system clipboard | Low |
| `clipboard-write` | Write to system clipboard | Low |

---

## 12. AI & Model Tools (Meta-tools)

| Tool | Description | Risk Level |
|------|-------------|------------|
| `ai-complete` | Call another AI model for sub-task | Medium |
| `ai-embed` | Generate embeddings for text | Low |
| `ai-classify` | Classify text into categories | Low |
| `ai-summarize` | Summarize long content | Low |
| `ai-translate` | Translate text between languages | Low |
| `ai-extract` | Extract structured data from text | Low |
| `ai-vision` | Analyze images (OCR, description) | Low |
| `ai-speech-to-text` | Transcribe audio to text | Low |
| `ai-text-to-speech` | Generate speech from text | Low |
| `ai-image-generate` | Generate images from text prompts | Low |
| `ai-code-review` | Review code for issues/improvements | Low |
| `rag-query` | Query RAG pipeline (retrieve + generate) | Low |
| `memory-store` | Store information in agent memory | Low |
| `memory-recall` | Retrieve from agent memory | Low |

---

## 13. Browser Automation Tools

| Tool | Description | Risk Level |
|------|-------------|------------|
| `browser-open` | Open URL in headless browser | Low |
| `browser-click` | Click an element on page | Medium |
| `browser-type` | Type text into input field | Medium |
| `browser-scroll` | Scroll page/element | Low |
| `browser-select` | Select from dropdown | Medium |
| `browser-screenshot` | Capture page/element screenshot | Low |
| `browser-pdf` | Save page as PDF | Low |
| `browser-wait` | Wait for element/condition | Low |
| `browser-extract` | Extract data from page (CSS/XPath) | Low |
| `browser-navigate` | Navigate (back, forward, goto) | Low |
| `browser-cookies` | Get/set cookies | Medium |
| `browser-console` | Read browser console logs | Low |
| `browser-network` | Intercept/monitor network requests | Medium |
| `browser-fill-form` | Auto-fill form fields | Medium |

---

## 14. System & OS Tools

| Tool | Description | Risk Level |
|------|-------------|------------|
| `system-info` | Get OS, CPU, RAM, disk info | Low |
| `system-monitor` | Monitor resource usage | Low |
| `system-notify` | Show OS notification | Low |
| `cron-create` | Create scheduled task | Medium |
| `cron-list` | List scheduled tasks | Low |
| `cron-delete` | Remove scheduled task | Medium |
| `service-start` | Start system service | High |
| `service-stop` | Stop system service | High |
| `service-status` | Check service status | Low |
| `open-app` | Open application/URL in default handler | Low |
| `screenshot-desktop` | Capture desktop screenshot | Low |
| `audio-play` | Play audio file/sound | Low |

---

## 15. Security & Crypto Tools

| Tool | Description | Risk Level |
|------|-------------|------------|
| `hash-generate` | Generate hash (SHA-256, MD5, etc.) | Low |
| `encrypt-file` | Encrypt a file | Medium |
| `decrypt-file` | Decrypt a file | Medium |
| `jwt-decode` | Decode JWT token (no verification) | Low |
| `jwt-create` | Create signed JWT | Medium |
| `cert-generate` | Generate self-signed certificate | Medium |
| `secret-generate` | Generate random secrets/passwords | Low |
| `ssh-keygen` | Generate SSH key pair | Medium |
| `gpg-sign` | Sign data with GPG key | Medium |
| `vault-read` | Read from secrets vault | Medium |
| `vault-write` | Write to secrets vault | Medium |

---

## 16. Data Processing Tools

| Tool | Description | Risk Level |
|------|-------------|------------|
| `json-parse` | Parse and query JSON (jq-like) | Low |
| `json-transform` | Transform JSON structure | Low |
| `csv-parse` | Parse CSV into structured data | Low |
| `csv-transform` | Filter/sort/aggregate CSV data | Low |
| `xml-parse` | Parse XML/HTML | Low |
| `regex-match` | Match and extract with regex | Low |
| `regex-replace` | Find and replace with regex | Low |
| `text-diff` | Compare two text blocks | Low |
| `text-format` | Format text (wrap, align, table) | Low |
| `math-calculate` | Evaluate mathematical expressions | Low |
| `date-calculate` | Date arithmetic and formatting | Low |
| `base64-encode` | Encode/decode Base64 | Low |
| `url-encode` | Encode/decode URL components | Low |
| `yaml-to-json` | Convert between data formats | Low |
| `validate-schema` | Validate data against JSON Schema | Low |

---

## 17. Project Management & Collaboration Tools

| Tool | Description | Risk Level |
|------|-------------|------------|
| `github-issue-create` | Create GitHub issue | Medium |
| `github-issue-list` | List/search issues | Low |
| `github-issue-comment` | Comment on an issue | Medium |
| `github-pr-create` | Create pull request | Medium |
| `github-pr-review` | Review/comment on PR | Medium |
| `github-pr-merge` | Merge pull request | High |
| `github-release` | Create a release | Medium |
| `github-actions-trigger` | Trigger workflow | Medium |
| `github-gist-create` | Create a gist | Low |
| `jira-create` | Create Jira ticket | Medium |
| `jira-update` | Update ticket status | Medium |
| `linear-create` | Create Linear issue | Medium |
| `notion-page-create` | Create Notion page | Medium |
| `notion-page-read` | Read Notion page content | Low |
| `trello-card-create` | Create Trello card | Medium |

---

## 18. Media & Image Tools

| Tool | Description | Risk Level |
|------|-------------|------------|
| `image-resize` | Resize/crop images | Low |
| `image-convert` | Convert between formats (PNG/JPG/WebP) | Low |
| `image-compress` | Optimize image file size | Low |
| `image-metadata` | Read EXIF/metadata | Low |
| `image-annotate` | Add text/shapes to image | Low |
| `image-ocr` | Extract text from image | Low |
| `video-info` | Get video metadata | Low |
| `video-thumbnail` | Extract thumbnail from video | Low |
| `audio-transcribe` | Transcribe audio file | Low |
| `svg-generate` | Generate SVG graphics | Low |
| `qr-generate` | Generate QR codes | Low |
| `chart-generate` | Generate charts (bar, line, pie) | Low |

---

## 19. MCP (Model Context Protocol) Integration Tools

| Tool | Description | Risk Level |
|------|-------------|------------|
| `mcp-server-connect` | Connect to external MCP server | Medium |
| `mcp-tool-list` | List tools from MCP server | Low |
| `mcp-tool-call` | Call a tool on MCP server | Medium |
| `mcp-resource-read` | Read resource from MCP server | Low |
| `mcp-prompt-get` | Get prompt template from MCP server | Low |

---

## 20. Workspace & IDE Tools

| Tool | Description | Risk Level |
|------|-------------|------------|
| `editor-open` | Open file in editor | Low |
| `editor-goto` | Navigate to line/symbol in editor | Low |
| `editor-diagnostics` | Get compiler/linter errors | Low |
| `editor-quickfix` | Apply quick fix suggestion | Medium |
| `editor-snippet` | Insert code snippet | Medium |
| `terminal-create` | Create new terminal session | Low |
| `terminal-send` | Send command to terminal | High |
| `debugger-start` | Start debug session | Low |
| `debugger-breakpoint` | Set/remove breakpoints | Low |
| `debugger-step` | Step through code | Low |
| `debugger-inspect` | Inspect variables at breakpoint | Low |
| `workspace-search` | Search across workspace | Low |
| `workspace-replace` | Find and replace across workspace | High |

---

## Implementation Priority for Agent-X

### Phase 1 — Core (Ship with MVP)
- `file-read`, `file-write`, `file-edit`, `file-delete`
- `folder-create`, `folder-delete`, `folder-list`
- `code-search`, `code-grep`
- `shell-exec`

### Phase 2 — Power User
- `git-status`, `git-diff`, `git-add`, `git-commit`
- `file-search`, `file-move`, `file-copy`
- `code-symbols`, `code-references`
- `doc-markdown`, `doc-json`, `doc-csv`
- `test-run`, `test-run-single`
- `pkg-install`, `pkg-list`

### Phase 3 — Advanced
- `web-search`, `web-scrape`, `http-request`
- `browser-open`, `browser-click`, `browser-type`, `browser-screenshot`
- `db-query`, `db-schema`
- `docker-build`, `docker-run`, `docker-logs`
- `ai-complete`, `ai-summarize`, `ai-embed`
- `memory-store`, `memory-recall`

### Phase 4 — Ecosystem
- `github-issue-create`, `github-pr-create`
- `notify-telegram`, `notify-slack`, `notify-webhook`
- `mcp-server-connect`, `mcp-tool-call`
- `image-resize`, `image-ocr`
- `k8s-get`, `k8s-apply`
- `calendar-create`, `calendar-list`

### Phase 5 — Specialist
- Full browser automation suite
- Full git power tools (rebase, cherry-pick)
- Infrastructure tools (Terraform, cloud deploy)
- Media processing
- Security tools

---

## Design Principles for Agent-X Tools

1. **Every tool has a schema** — Zod-validated input/output
2. **Every tool has a permission level** — Low/Medium/High/Critical
3. **Every tool respects scope** — Cannot escape the scope boundary
4. **Every tool has a timeout** — No infinite operations
5. **Every tool is observable** — Emits events for UI progress display
6. **Every tool is testable** — Can be mocked for unit tests
7. **Every tool is documented** — Description + examples for the model
8. **Tools are composable** — Sub-agents can chain tools together
9. **Tools fail gracefully** — Errors caught by ErrorShield
10. **Tools are pluggable** — Users can add custom tools via MCP or plugins

---

## Tool Count Summary

| Category | Count |
|----------|-------|
| Filesystem | 21 |
| Code Intelligence | 19 |
| Shell & Process | 10 |
| Git & VCS | 19 |
| Package Manager | 11 |
| Web & Network | 13 |
| Database | 12 |
| Document Generation | 12 |
| Testing | 10 |
| Container & Infra | 14 |
| Communication | 12 |
| AI & Model (Meta) | 14 |
| Browser Automation | 14 |
| System & OS | 12 |
| Security & Crypto | 11 |
| Data Processing | 15 |
| Project Management | 15 |
| Media & Image | 12 |
| MCP Integration | 5 |
| Workspace & IDE | 12 |
| **TOTAL** | **263** |

---

*This document is a reference for building. Not all tools need to be implemented — prioritize based on user value and Agent-X's philosophy of being a personal productivity agent.*
