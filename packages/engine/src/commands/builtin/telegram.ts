import type { CommandInterface, CommandContext, CommandResult } from '../CommandInterface.js';

export const telegramCommand: CommandInterface = {
  name: 'telegram',
  description: 'Manage Telegram bot bridge',
  aliases: ['tg'],
  usage: '/telegram <start|stop|status> [bot_token]',
  async execute(args: string[], _context: CommandContext): Promise<CommandResult> {
    const subcommand = args[0]?.toLowerCase();

    switch (subcommand) {
      case 'start': {
        const token = args[1];
        if (!token) {
          return { success: false, output: 'Usage: /telegram start <bot_token>\nGet a token from @BotFather on Telegram.' };
        }
        return { success: true, output: `Starting Telegram bridge with token...`, action: 'telegram_start' };
      }
      case 'stop':
        return { success: true, output: 'Stopping Telegram bridge...', action: 'telegram_stop' };
      case 'status':
        return { success: true, output: '', action: 'telegram_status' };
      default:
        return {
          success: false,
          output: [
            'Telegram Bridge Commands:',
            '  /telegram start <token>  - Start the Telegram bot',
            '  /telegram stop           - Stop the bridge',
            '  /telegram status         - Show bridge status',
            '',
            'Get a bot token from @BotFather on Telegram.',
          ].join('\n'),
        };
    }
  },
};
