import type { CommandInterface, CommandContext, CommandResult } from '../CommandInterface.js';
import { VERSION, APP_NAME, CLI_NAME } from '@agentx/shared';

export const versionCommand: CommandInterface = {
  name: 'version',
  description: 'Show version information',
  aliases: ['v'],
  usage: '/version',
  async execute(_args: string[], context: CommandContext): Promise<CommandResult> {
    const output = `${APP_NAME} v${VERSION} (${CLI_NAME})`;
    context.emit(output);
    return { success: true, output, action: 'none' };
  },
};
