import type { PluginHubEntry } from '@agentx/shared';

export interface MarketplaceExtension {
  id: string;
  name: string;
  description: string;
  author: string;
  tools: string;
  permissionLevel: string;
  installsTo: string;
}

const MARKETPLACE_EXTENSIONS: MarketplaceExtension[] = [
  {
    id: 'filesystem',
    name: 'File System',
    description: 'Read, write, list, search, and manage files on the local filesystem with path safety checks.',
    author: 'Agent-X',
    tools: 'read_file, write_file, list_dir, file_info, delete_file, create_dir, glob, search_files',
    permissionLevel: 'medium',
    installsTo: 'integrations',
  },
  {
    id: 'database',
    name: 'Database (SQLite)',
    description: 'Query SQLite databases, list tables, and describe schemas directly from agent conversations.',
    author: 'Agent-X',
    tools: 'query_sqlite, list_tables, describe_table',
    permissionLevel: 'medium',
    installsTo: 'integrations',
  },
  {
    id: 'browser',
    name: 'Browser',
    description: 'Fetch web pages, extract text content, call JSON APIs, and take screenshots via Puppeteer.',
    author: 'Agent-X',
    tools: 'fetch_page, fetch_json, screenshot',
    permissionLevel: 'medium',
    installsTo: 'integrations',
  },
  {
    id: 'search',
    name: 'Web Search',
    description: 'Search the web, find news articles, and search documentation sites like MDN, Python docs, and npm.',
    author: 'Agent-X',
    tools: 'web_search, search_news, search_docs',
    permissionLevel: 'low',
    installsTo: 'integrations',
  },
  {
    id: 'shell',
    name: 'Shell Executor',
    description: 'Execute shell commands, check if programs are available, and inspect environment variables.',
    author: 'Agent-X',
    tools: 'run_command, which, env_var',
    permissionLevel: 'critical',
    installsTo: 'integrations',
  },
  {
    id: 'git',
    name: 'Git Integration',
    description: 'Inspect Git repositories — status, log, diff, branches, and create commits.',
    author: 'Agent-X',
    tools: 'git_status, git_log, git_diff, git_branches, git_commit',
    permissionLevel: 'medium',
    installsTo: 'integrations',
  },
  {
    id: 'json',
    name: 'JSON Processor',
    description: 'Parse, validate, stringify, and query JSON data using dot-notation paths.',
    author: 'Agent-X',
    tools: 'json_parse, json_stringify, json_query, json_validate',
    permissionLevel: 'low',
    installsTo: 'integrations',
  },
  {
    id: 'math',
    name: 'Math Calculator',
    description: 'Evaluate mathematical expressions, convert between units, and generate random numbers.',
    author: 'Agent-X',
    tools: 'calculate, convert_units, random',
    permissionLevel: 'low',
    installsTo: 'integrations',
  },
  {
    id: 'uuid',
    name: 'UUID / NanoID Generator',
    description: 'Generate UUID v4, short nano IDs, and validate UUID strings.',
    author: 'Agent-X',
    tools: 'generate_uuid, generate_nanoid, validate_uuid',
    permissionLevel: 'low',
    installsTo: 'integrations',
  },
  {
    id: 'crypto',
    name: 'Crypto Utilities',
    description: 'Compute hashes (md5/sha1/sha256/sha512), HMAC signatures, and generate secure random tokens.',
    author: 'Agent-X',
    tools: 'hash, hmac, generate_token',
    permissionLevel: 'low',
    installsTo: 'integrations',
  },
  {
    id: 'datetime',
    name: 'Date & Time',
    description: 'Get current time, parse and format dates, calculate date differences across timezones.',
    author: 'Agent-X',
    tools: 'current_time, parse_date, format_date, date_diff',
    permissionLevel: 'low',
    installsTo: 'integrations',
  },
  {
    id: 'encoding',
    name: 'Encoding Utilities',
    description: 'Encode and decode Base64, hex, and URL-encoded strings.',
    author: 'Agent-X',
    tools: 'base64_encode, base64_decode, hex_encode, hex_decode, url_encode, url_decode',
    permissionLevel: 'low',
    installsTo: 'integrations',
  },
  {
    id: 'http',
    name: 'HTTP Client',
    description: 'Make HTTP GET, POST, and PUT requests with custom headers and timeouts.',
    author: 'Agent-X',
    tools: 'http_get, http_post, http_put',
    permissionLevel: 'medium',
    installsTo: 'integrations',
  },
  {
    id: 'fs-diff',
    name: 'File Diff / Patch',
    description: 'Diff two files, apply unified diff patches, and create patches from content changes.',
    author: 'Agent-X',
    tools: 'diff_files, apply_patch, create_patch',
    permissionLevel: 'medium',
    installsTo: 'integrations',
  },
  {
    id: 'template',
    name: 'Template Renderer',
    description: 'Render templates with {{variable}} substitution from strings or files.',
    author: 'Agent-X',
    tools: 'render_template, render_file',
    permissionLevel: 'low',
    installsTo: 'integrations',
  },
];

const BUILTIN_PLUGINS: PluginHubEntry[] = [
  {
    id: 'postgresql',
    name: 'PostgreSQL',
    version: '1.0.0',
    description: 'Use PostgreSQL for sessions and persistent storage. Supports concurrent access, role-based auth, embedded local instances, and cloud deployment.',
    author: 'Agent-X',
    homepage: 'https://www.postgresql.org/',
    category: 'database',
    tags: ['database', 'postgresql', 'scalable', 'production'],
    isBuiltin: true,
    config: {
      backend: {
        type: 'string',
        label: 'Backend mode',
        description: 'embedded-postgres (bundled local) or postgres (remote/cloud)',
        required: false,
        default: 'embedded-postgres',
      },
      connectionString: {
        type: 'string',
        label: 'Connection String',
        description: 'PostgreSQL connection URI (e.g. postgresql://user:pass@host:5432/db)',
        required: true,
      },
      autoMigrate: {
        type: 'boolean',
        label: 'Auto-migrate schema',
        description: 'Automatically create tables on connect',
        default: true,
      },
      poolSize: {
        type: 'number',
        label: 'Connection pool size',
        description: 'Maximum number of concurrent connections',
        default: 5,
      },
    },
  },
  {
    id: 'telegram',
    name: 'Telegram Bot',
    version: '1.0.0',
    description: 'Connect Agent-X to Telegram. Chat with your agent via direct messages, receive notifications, and use inline keyboards for tool approvals.',
    author: 'Agent-X',
    homepage: 'https://core.telegram.org/bots',
    category: 'messaging',
    tags: ['messaging', 'telegram', 'bot', 'notifications'],
    isBuiltin: true,
    config: {
      botToken: {
        type: 'string',
        label: 'Bot Token',
        description: 'Token from @BotFather on Telegram',
        required: true,
      },
      allowedUserIds: {
        type: 'string',
        label: 'Linked owner user ID',
        description: 'Set automatically when you verify the bot after messaging it privately. Only this Telegram user can talk to the bot.',
        required: false,
      },
    },
  },
  {
    id: 'discord',
    name: 'Discord Bot',
    version: '1.0.0',
    description: 'Connect Agent-X to Discord. Chat with your agent via DMs, guild channels, and threads. Supports slash commands and file attachments.',
    author: 'Agent-X',
    homepage: 'https://discord.com/developers/docs/intro',
    category: 'messaging',
    tags: ['messaging', 'discord', 'bot', 'notifications'],
    isBuiltin: true,
    config: {
      botToken: {
        type: 'string',
        label: 'Bot Token',
        description: 'Token from the Discord Developer Portal',
        required: true,
      },
      channelId: {
        type: 'string',
        label: 'Channel ID',
        description: 'Optional default channel ID to monitor. Leave empty to respond to DMs and mentions only.',
        required: false,
      },
    },
  },
  {
    id: 'slack',
    name: 'Slack Bot',
    version: '1.0.0',
    description: 'Connect Agent-X to Slack via Socket Mode. Chat with your agent via DMs and @mentions. Supports interactive blocks and file sharing.',
    author: 'Agent-X',
    homepage: 'https://api.slack.com/socket-mode',
    category: 'messaging',
    tags: ['messaging', 'slack', 'bot', 'notifications'],
    isBuiltin: true,
    config: {
      botToken: {
        type: 'string',
        label: 'Bot Token',
        description: 'Slack Bot User OAuth Token (xoxb-...)',
        required: true,
      },
      appToken: {
        type: 'string',
        label: 'App-Level Token',
        description: 'Slack App-Level Token for Socket Mode (xapp-...)',
        required: true,
      },
    },
  },
  {
    id: 'web-search',
    name: 'Web Search',
    version: '1.0.0',
    description: 'Enhance agent responses with real-time web search capabilities. Supports multiple search providers.',
    author: 'Agent-X',
    category: 'search',
    tags: ['search', 'web', 'information'],
    isBuiltin: true,
    config: {},
  },
  {
    id: 'prometheus-exporter',
    name: 'Prometheus Exporter',
    version: '1.0.0',
    description: 'Export agent-x metrics to Prometheus for monitoring and alerting. Includes request latency, token usage, and error rates.',
    author: 'Agent-X',
    category: 'monitoring',
    tags: ['monitoring', 'metrics', 'prometheus', 'observability'],
    isBuiltin: true,
    config: {
      port: {
        type: 'number',
        label: 'Metrics Port',
        description: 'Port to expose /metrics endpoint',
        default: 9464,
      },
    },
  },
  {
    id: 'redis-cache',
    name: 'Redis Cache',
    version: '1.0.0',
    description: 'Use Redis for session caching, rate limiting, and pub/sub message broadcasting across multiple agent-x instances.',
    author: 'Agent-X',
    category: 'storage',
    tags: ['cache', 'redis', 'pubsub'],
    isBuiltin: true,
    config: {
      url: {
        type: 'string',
        label: 'Redis URL',
        description: 'redis://localhost:6379',
        required: true,
      },
      ttl: {
        type: 'number',
        label: 'Cache TTL (seconds)',
        default: 3600,
      },
    },
  },
  {
    id: 'webhook-notifier',
    name: 'Webhook Notifier',
    version: '1.0.0',
    description: 'Send webhook notifications on agent events — new messages, tool executions, errors, and session changes. Integrates with Slack, Discord, and custom endpoints.',
    author: 'Agent-X',
    category: 'automation',
    tags: ['webhook', 'notification', 'integration', 'slack', 'discord'],
    isBuiltin: true,
    config: {
      url: {
        type: 'string',
        label: 'Webhook URL',
        description: 'HTTP endpoint to receive POST notifications',
        required: true,
      },
      events: {
        type: 'string',
        label: 'Events to notify (comma-separated)',
        description: 'message, tool_execution, error, session_created',
        default: 'message,error',
      },
      secret: {
        type: 'string',
        label: 'Webhook Secret',
        description: 'Optional HMAC secret for payload verification',
        required: false,
      },
    },
  },
  {
    id: 'email',
    name: 'Email Bridge',
    version: '1.0.0',
    description: 'Connect Agent-X to an email inbox via IMAP and send replies via SMTP. Supports attachments, threading, and per-sender session isolation.',
    author: 'Agent-X',
    category: 'messaging',
    tags: ['messaging', 'email', 'smtp', 'imap'],
    isBuiltin: true,
    config: {
      smtpHost: { type: 'string', label: 'SMTP Host', description: 'e.g. smtp.gmail.com', required: true },
      smtpPort: { type: 'number', label: 'SMTP Port', description: 'e.g. 587 or 465', default: 587 },
      smtpUser: { type: 'string', label: 'SMTP Username', required: true },
      smtpPass: { type: 'string', label: 'SMTP Password', required: true },
      imapHost: { type: 'string', label: 'IMAP Host', description: 'Optional. Defaults to SMTP host.', required: false },
      imapPort: { type: 'number', label: 'IMAP Port', description: 'Optional. Defaults to 993.', default: 993 },
      fromAddress: { type: 'string', label: 'From Address', description: 'Display address for outgoing emails.', required: true },
    },
  },
];

export function getBuiltinCatalog(): PluginHubEntry[] {
  return BUILTIN_PLUGINS;
}

export function getBuiltinPlugin(id: string): PluginHubEntry | undefined {
  return BUILTIN_PLUGINS.find((p) => p.id === id);
}

export function getMarketplaceExtensions(): MarketplaceExtension[] {
  return MARKETPLACE_EXTENSIONS;
}

export function getMarketplaceExtension(id: string): MarketplaceExtension | undefined {
  return MARKETPLACE_EXTENSIONS.find((e) => e.id === id);
}
