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
  action?: 'exit' | 'clear' | 'switch_model' | 'switch_provider' | 'switch_profile' | 'restore_session' | 'none';
}
