import type { CommandInterface } from './CommandInterface.js';

export class CommandRegistry {
  private commands: Map<string, CommandInterface> = new Map();

  register(command: CommandInterface): void {
    this.commands.set(command.name, command);
    if (command.aliases) {
      for (const alias of command.aliases) {
        this.commands.set(alias, command);
      }
    }
  }

  get(name: string): CommandInterface | undefined {
    return this.commands.get(name);
  }

  has(name: string): boolean {
    return this.commands.has(name);
  }

  list(): CommandInterface[] {
    // Deduplicate (aliases point to same command)
    const seen = new Set<string>();
    const result: CommandInterface[] = [];
    for (const cmd of this.commands.values()) {
      if (!seen.has(cmd.name)) {
        seen.add(cmd.name);
        result.push(cmd);
      }
    }
    return result;
  }

  filter(prefix: string): CommandInterface[] {
    return this.list().filter(
      (cmd) =>
        cmd.name.startsWith(prefix) ||
        (cmd.aliases?.some((a) => a.startsWith(prefix)) ?? false),
    );
  }

  getNames(): string[] {
    return this.list().map((cmd) => cmd.name);
  }
}
