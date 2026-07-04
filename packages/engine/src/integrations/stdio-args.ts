import { homedir } from 'node:os';

/** Expand template variables in stdio MCP server arguments. */
export function expandStdioArgs(args: string[]): string[] {
  const home = homedir();
  return args.map((arg) => arg.replace(/\$\{HOME\}/g, home));
}
