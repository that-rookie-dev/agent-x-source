export interface CommandDefinition {
  name: string;
  description: string;
  aliases?: string[];
}

export const BUILTIN_COMMANDS: CommandDefinition[] = [
  { name: 'help', description: 'Show available commands', aliases: ['h', '?'] },
  { name: 'exit', description: 'Exit Agent-X', aliases: ['quit', 'q'] },
  { name: 'clear', description: 'Clear the message area' },
  { name: 'version', description: 'Show current version', aliases: ['v'] },
  { name: 'model', description: 'Switch AI model' },
  { name: 'provider', description: 'Switch AI provider' },
  { name: 'profile', description: 'Switch agent profile' },
  { name: 'session', description: 'Session management (list/restore)' },
  { name: 'config', description: 'Open configuration' },
  { name: 'telegram', description: 'Telegram bot configuration' },
  { name: 'bg', description: 'Move current task to background' },
  { name: 'tasks', description: 'List active/completed background tasks' },
];
