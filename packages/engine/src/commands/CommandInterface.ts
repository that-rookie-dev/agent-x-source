import type { StorageAdapter } from '@agentx/shared';
import type { SessionManager } from '../session/SessionManager.js';

export interface CommandInterface {
  name: string;
  description: string;
  aliases?: string[];
  usage?: string;
  hidden?: boolean;
  execute(args: string[], context: CommandContext): Promise<CommandResult>;
}

export interface CommandContext {
  sessionId: string;
  providerId: string;
  modelId: string;
  emit: (message: string) => void;
  sessionStore?: StorageAdapter | SessionManager;
}

export interface CommandResult {
  success: boolean;
  output?: string;
  action?: ActionType;
  payload?: Record<string, unknown>;
}

export type ActionType = 'exit' | 'clear' | 'switch_model' | 'list_models' | 'switch_provider' | 'reset_provider' | 'list_providers' | 'list_profiles' | 'add_profile' | 'delete_profile' | 'switch_profile' | 'save_memory' | 'restore_session' | 'telegram_start' | 'telegram_stop' | 'telegram_status' | 'plan_mode' | 'list_sessions' | 'delete_session' | 'fork_session' | 'export_session' | 'copy_session' | 'checkpoint' | 'rewind' | 'show_cost' | 'theme_changed' | 'research' | 'focus' | 'telegram_updates' | 'none';
