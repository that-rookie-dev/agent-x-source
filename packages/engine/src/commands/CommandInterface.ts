export interface CommandInterface {
  name: string;
  description: string;
  aliases?: string[];
  usage?: string;
  execute(args: string[], context: CommandContext): Promise<CommandResult>;
}

export interface CommandContext {
  sessionId: string;
  providerId: string;
  modelId: string;
  emit: (message: string) => void;
}

export interface CommandResult {
  success: boolean;
  output?: string;
  action?: 'exit' | 'clear' | 'switch_model' | 'list_models' | 'switch_provider' | 'reset_provider' | 'list_providers' | 'save_memory' | 'switch_profile' | 'restore_session' | 'telegram_start' | 'telegram_stop' | 'telegram_status' | 'none';
}
