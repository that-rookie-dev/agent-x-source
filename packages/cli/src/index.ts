import React from 'react';
import { render } from 'ink';
import { VERSION, APP_NAME, TAGLINE } from '@agentx/shared';
import { App } from '@agentx/tui';

function main(): void {
  const args = process.argv.slice(2);

  if (args.includes('--version') || args.includes('-v')) {
    console.log(`✦ ${APP_NAME} v${VERSION}`);
    process.exit(0);
  }

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`✦ ${APP_NAME} v${VERSION} — ${TAGLINE}`);
    console.log('');
    console.log('Usage: agentx [options] [session <id>]');
    console.log('');
    console.log('Options:');
    console.log('  -v, --version    Show version');
    console.log('  -h, --help       Show help');
    console.log('');
    console.log('Commands:');
    console.log('  agentx                  Launch agent (setup wizard if not configured)');
    console.log('  agentx session <id>     Restore a previous session');
    process.exit(0);
  }

  // Check for session restore
  let sessionId: string | undefined;
  const sessionIdx = args.indexOf('session');
  if (sessionIdx !== -1 && args[sessionIdx + 1]) {
    sessionId = args[sessionIdx + 1];
  }

  // Clear terminal before launching
  process.stdout.write('\x1Bc');

  // Render the TUI
  render(React.createElement(App, { sessionId }));
}

main();
