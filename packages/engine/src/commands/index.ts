export type { CommandInterface, CommandContext, CommandResult } from './CommandInterface.js';
export { CommandParser } from './CommandParser.js';
export { CommandRegistry } from './CommandRegistry.js';

// Built-in commands
export { helpCommand } from './builtin/help.js';
export { exitCommand } from './builtin/exit.js';
export { clearCommand } from './builtin/clear.js';
export { versionCommand } from './builtin/version.js';
export { modelCommand } from './builtin/model.js';
export { providerCommand } from './builtin/provider.js';
export { profileCommand } from './builtin/profile.js';
export { bgCommand, tasksCommand } from './builtin/tasks.js';
export { toolsCommand } from './builtin/tools.js';
export { permissionsCommand } from './builtin/permissions.js';
export { sessionsCommand } from './builtin/sessions.js';
export { rememberCommand } from './builtin/remember.js';
export { telegramCommand } from './builtin/telegram.js';

import { CommandRegistry } from './CommandRegistry.js';
import { helpCommand } from './builtin/help.js';
import { exitCommand } from './builtin/exit.js';
import { clearCommand } from './builtin/clear.js';
import { versionCommand } from './builtin/version.js';
import { modelCommand } from './builtin/model.js';
import { providerCommand } from './builtin/provider.js';
import { profileCommand } from './builtin/profile.js';
import { bgCommand, tasksCommand } from './builtin/tasks.js';
import { toolsCommand } from './builtin/tools.js';
import { permissionsCommand } from './builtin/permissions.js';
import { sessionsCommand } from './builtin/sessions.js';
import { rememberCommand } from './builtin/remember.js';
import { telegramCommand } from './builtin/telegram.js';

export function createDefaultRegistry(): CommandRegistry {
  const registry = new CommandRegistry();
  registry.register(helpCommand);
  registry.register(exitCommand);
  registry.register(clearCommand);
  registry.register(versionCommand);
  registry.register(modelCommand);
  registry.register(providerCommand);
  registry.register(profileCommand);
  registry.register(bgCommand);
  registry.register(tasksCommand);
  registry.register(toolsCommand);
  registry.register(permissionsCommand);
  registry.register(sessionsCommand);
  registry.register(rememberCommand);
  registry.register(telegramCommand);
  return registry;
}
