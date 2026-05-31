import {
  Client,
  GatewayIntentBits,
  Events,
  REST,
  Routes,
  SlashCommandBuilder,
  type Interaction,
  type Message,
  type TextChannel,
  type ChatInputCommandInteraction,
  ChannelType,
} from 'discord.js';
import type { Agent } from '../agent/Agent.js';
import { AgentEventBus } from '../EventBus.js';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

function getDataDir(): string {
  return process.env['XDG_DATA_HOME']
    ? join(process.env['XDG_DATA_HOME'], 'agentx')
    : join(homedir(), '.local', 'share', 'agentx');
}

export interface DiscordConfig {
  botToken: string;
  channelId?: string;
}

export interface DiscordBridgeStatus {
  connected: boolean;
  botUsername?: string;
  guilds: number;
  messageCount: number;
}

export class DiscordBridge {
  private client: Client | null = null;
  private token = '';
  private channelId: string | undefined;
  private agent: Agent | null = null;
  private agentFactory: ((userId: string) => Promise<Agent> | Agent) | null = null;
  private messageHandler: ((text: string, userId: string, channelId: string) => void) | null = null;
  private eventBus: AgentEventBus;
  private connected = false;
  private botUsername?: string;
  private messageCount = 0;
  private guilds = 0;
  private userAgents = new Map<string, Agent>();
  private filesDir: string;

  constructor() {
    this.eventBus = new AgentEventBus();
    this.filesDir = join(getDataDir(), 'discord-files');
    if (!existsSync(this.filesDir)) {
      mkdirSync(this.filesDir, { recursive: true });
    }
  }

  attach(agent: Agent): void {
    this.agent = agent;
  }

  setAgentFactory(factory: (userId: string) => Promise<Agent> | Agent): void {
    this.agentFactory = factory;
  }

  /**
   * Register a message handler that intercepts ALL non-command messages.
   * When set, the bridge will NOT call agent.sendMessage directly — instead it delegates to this handler.
   * The handler is responsible for processing the message and sending a response.
   */
  setMessageHandler(handler: (text: string, userId: string, channelId: string) => void): void {
    this.messageHandler = handler;
  }

  get events(): AgentEventBus {
    return this.eventBus;
  }

  getStatus(): DiscordBridgeStatus {
    return {
      connected: this.connected,
      botUsername: this.botUsername,
      guilds: this.guilds,
      messageCount: this.messageCount,
    };
  }

  async start(token: string, channelId?: string): Promise<void> {
    this.token = token;
    this.channelId = channelId;

    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
      ],
    });

    this.client.on(Events.Error, (error: Error) => {
      this.eventBus.emit({
        type: 'discord_error',
        code: 'DISCORD_CLIENT_ERROR',
        message: error.message,
        recoverable: true,
      });
    });

    this.client.on(Events.Warn, (message: string) => {
      this.eventBus.emit({
        type: 'discord_error',
        code: 'DISCORD_WARNING',
        message,
        recoverable: true,
      });
    });

    this.client.once(Events.ClientReady, (readyClient) => {
      this.connected = true;
      this.botUsername = readyClient.user?.tag ?? undefined;
      this.guilds = readyClient.guilds.cache.size;
      this.eventBus.emit({
        type: 'discord_connected',
        code: 'DISCORD_CONNECTED',
        message: `Discord bot connected as ${readyClient.user?.tag ?? 'unknown'}`,
        recoverable: true,
      });
    });

    this.client.on(Events.GuildCreate, () => {
      this.guilds = this.client?.guilds.cache.size ?? 0;
    });

    this.client.on(Events.GuildDelete, () => {
      this.guilds = this.client?.guilds.cache.size ?? 0;
    });

    this.client.on(Events.InteractionCreate, async (interaction: Interaction) => {
      if (!interaction.isChatInputCommand()) return;
      await this.handleSlashCommand(interaction);
    });

    this.client.on(Events.MessageCreate, async (message: Message) => {
      await this.handleMessage(message);
    });

    await this.client.login(token);

    // Register slash commands
    await this.registerSlashCommands();
  }

  stop(): void {
    this.connected = false;
    if (this.client) {
      this.client.destroy();
      this.client = null;
    }
    this.userAgents.clear();
  }

  async sendMessage(channelId: string, content: string): Promise<void> {
    if (!this.client) return;
    try {
      const channel = await this.client.channels.fetch(channelId);
      if (channel && channel.isTextBased()) {
        const chunks = this.chunkContent(content);
        for (const chunk of chunks) {
          await (channel as TextChannel).send(chunk);
        }
      }
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : 'Failed to send message';
      this.emitError(errMsg);
    }
  }

  async sendDM(userId: string, content: string): Promise<void> {
    if (!this.client) return;
    try {
      const user = await this.client.users.fetch(userId);
      const chunks = this.chunkContent(content);
      for (const chunk of chunks) {
        await user.send(chunk);
      }
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : 'Failed to send DM';
      this.emitError(errMsg);
    }
  }

  private async registerSlashCommands(): Promise<void> {
    if (!this.client) return;
    const clientId = this.client.user?.id;
    if (!clientId) return;

    try {
      const rest = new REST({ version: '10' }).setToken(this.token);
      const commands = [
        new SlashCommandBuilder()
          .setName('ask')
          .setDescription('Ask Agent-X a question')
          .addStringOption((option) =>
            option.setName('message').setDescription('Your message').setRequired(true),
          ),
        new SlashCommandBuilder()
          .setName('status')
          .setDescription('Show Agent-X status'),
        new SlashCommandBuilder()
          .setName('crew')
          .setDescription('Manage or view crew')
          .addStringOption((option) =>
            option.setName('name').setDescription('Crew name to switch to').setRequired(false),
          ),
      ];

      await rest.put(Routes.applicationCommands(clientId), {
        body: commands.map((cmd) => cmd.toJSON()),
      });
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : 'Failed to register slash commands';
      this.emitError(errMsg);
    }
  }

  private async handleSlashCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    const { commandName } = interaction;
    const userId = interaction.user.id;

    try {
      await interaction.deferReply();

      const agent = await this.getAgentForUser(userId);

      if (commandName === 'ask') {
        const text = interaction.options.getString('message', true);
        this.messageCount++;
        this.eventBus.emit({
          type: 'discord_message',
          code: 'DISCORD_SLASH_COMMAND',
          message: `User ${userId} used /ask`,
          recoverable: true,
        });

        const response = await agent.sendMessage(text);
        const content = response.content ?? '(No response generated)';
        const chunks = this.chunkContent(content);
        await interaction.editReply(chunks[0] ?? '(empty)');
        for (let i = 1; i < chunks.length; i++) {
          await interaction.followUp(chunks[i]!);
        }
      } else if (commandName === 'status') {
        const statusLines = [
          '📊 Agent-X Status',
          `├ Processing: ${agent.processing ? 'yes' : 'idle'}`,
          `└ Discord bridge: connected`,
        ];
        await interaction.editReply(statusLines.join('\n'));
      } else if (commandName === 'crew') {
        const name = interaction.options.getString('name');
        if (name) {
          await interaction.editReply(
            `🔄 Crew switch to "${name}" is not yet implemented via Discord. Use the Web UI.`,
          );
        } else {
          await interaction.editReply('📋 Use /crew <name> to switch crew members.');
        }
      }
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : 'Command failed';
      this.emitError(errMsg);
      try {
        await interaction.editReply(`❌ Error: ${errMsg}`);
      } catch {
        // interaction may already be handled
      }
    }
  }

  private async handleMessage(message: Message): Promise<void> {
    // Ignore own messages
    if (message.author.bot) return;
    // Ignore messages without content and without attachments
    if (!message.content && message.attachments.size === 0) return;

    const userId = message.author.id;
    const isDM = message.channel.type === ChannelType.DM;
    const isThread = message.channel.isThread();
    const isConfiguredChannel = this.channelId ? message.channel.id === this.channelId : false;

    // Only process DMs, configured channel, or threads where bot is mentioned
    if (!isDM && !isConfiguredChannel && !isThread) {
      // In guilds, only respond if bot is mentioned or in configured channel
      if (!this.client?.user?.id || !message.mentions.has(this.client.user.id)) return;
    }

    this.messageCount++;

    this.eventBus.emit({
      type: 'discord_message',
      code: 'DISCORD_MESSAGE',
      message: `User ${userId}: ${message.content ?? '(attachment)'}`,
      recoverable: true,
    });

    try {
      // Handle attachments
      let userContent = message.content ?? '';
      if (message.attachments.size > 0) {
        for (const attachment of message.attachments.values()) {
          try {
            const savedPath = await this.downloadAttachment(attachment);
            userContent += `\n[FILE_RECEIVED] The user sent a file: "${attachment.name}" (${attachment.contentType ?? 'unknown'}). Saved at: ${savedPath}. You can read and analyze this file.`;
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            this.emitError(`Failed to download attachment: ${errMsg}`);
          }
        }
      }

      if (!userContent.trim()) return;

      // If a message handler is registered (e.g., daemon queue), delegate to it
      if (this.messageHandler) {
        if (message.channel.isTextBased()) {
          try {
            await (message.channel as TextChannel).sendTyping();
          } catch {
            // ignore
          }
        }
        this.messageHandler(userContent.trim(), userId, message.channel.id);
        return;
      }

      const agent = await this.getAgentForUser(userId);

      // Send typing indicator if in a text-based channel
      if (message.channel.isTextBased()) {
        try {
          await (message.channel as TextChannel).sendTyping();
        } catch {
          // ignore
        }
      }

      const response = await agent.sendMessage(userContent.trim());
      const content = response.content ?? '(No response generated)';
      const chunks = this.chunkContent(content);

      // Reply in the same channel/thread/DM
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i]!;
        if (i === 0) {
          await message.reply(chunk);
        } else {
          await (message.channel as TextChannel).send(chunk);
        }
      }
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : 'Processing failed';
      this.emitError(errMsg);
      try {
        await message.reply(`❌ Error: ${errMsg}`);
      } catch {
        // ignore send failure
      }
    }
  }

  private async getAgentForUser(userId: string): Promise<Agent> {
    const existing = this.userAgents.get(userId);
    if (existing) return existing;

    let agent: Agent;
    if (this.agentFactory) {
      agent = await this.agentFactory(userId);
    } else if (this.agent) {
      agent = this.agent;
    } else {
      throw new Error('No agent attached to Discord bridge');
    }

    if (this.agentFactory) {
      this.userAgents.set(userId, agent);
    }
    return agent;
  }

  private async downloadAttachment(attachment: {
    url: string;
    name: string;
    contentType: string | null;
    size: number;
  }): Promise<string> {
    const timestamp = Date.now();
    const safeName = attachment.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const savedPath = join(this.filesDir, `${timestamp}_${safeName}`);

    const res = await fetch(attachment.url, { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const arrayBuffer = await res.arrayBuffer();
    writeFileSync(savedPath, Buffer.from(arrayBuffer));
    return savedPath;
  }

  private chunkContent(content: string): string[] {
    const maxLen = 2000;
    if (content.length <= maxLen) return [content];
    const chunks: string[] = [];
    for (let i = 0; i < content.length; i += maxLen) {
      chunks.push(content.slice(i, i + maxLen));
    }
    return chunks;
  }

  private emitError(message: string): void {
    this.eventBus.emit({
      type: 'discord_error',
      code: 'DISCORD_ERROR',
      message,
      recoverable: true,
    });
  }
}
