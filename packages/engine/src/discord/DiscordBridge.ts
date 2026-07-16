import {
  Client,
  GatewayIntentBits,
  Events,
  REST,
  Routes,
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  AttachmentBuilder,
  type Interaction,
  type Message,
  type TextChannel,
  type ChatInputCommandInteraction,
  type ButtonInteraction,
  ChannelType,
} from 'discord.js';
import type { Agent } from '../agent/Agent.js';
import { AgentEventBus } from '../EventBus.js';
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { getDataDir, isChannelUserAllowed } from '@agentx/shared';
import { MessagingPermissionCoordinator, permissionResultLabel } from '../channels/MessagingPermissionCoordinator.js';
import { MessagingQuestionnaireCoordinator } from '../channels/MessagingQuestionnaireCoordinator.js';
import { getRenderer } from '../channels/renderers/index.js';
import {
  attachMessagingClarificationListener,
  deliverQuestionnaireCallback,
  extractMessagingReplyText,
  tryConsumeMessagingClarification,
} from '../channels/MessagingClarificationHelper.js';

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
  private userAgentActivity = new Map<string, number>();
  private cleanupInterval: NodeJS.Timeout | null = null;
  private readonly INACTIVITY_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes
  private readonly CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
  private filesDir: string;
  private allowedUserIds: string[] = [];
  private lastChannelByUser = new Map<string, string>();
  private permissionCoordinator = new MessagingPermissionCoordinator();
  private questionnaireCoordinator = new MessagingQuestionnaireCoordinator();
  private permToolIds = new Map<string, string>();
  private wiredAgents = new WeakSet<Agent>();

  constructor() {
    this.eventBus = new AgentEventBus();
    this.filesDir = join(getDataDir(), 'discord-files');
    void mkdir(this.filesDir, { recursive: true }).catch(() => {});
  }

  setAllowedUserIds(ids: string[]): void {
    this.allowedUserIds = ids;
  }

  private isUserAllowed(userId: string): boolean {
    return isChannelUserAllowed(userId, this.allowedUserIds);
  }

  wireAgentPermissions(agent: Agent, userId: string): void {
    if (this.wiredAgents.has(agent)) return;
    this.wiredAgents.add(agent);
    const toolExecutor = agent.getToolExecutor?.();
    if (!toolExecutor?.setChannelPermissionRequestHandler) return;

    const handler = this.permissionCoordinator.createHandler(
      async (permId, details) => {
        const channelId = this.lastChannelByUser.get(userId);
        if (!channelId || !this.client) return;
        this.permToolIds.set(permId, details.toolId);
        const riskEmoji = details.riskLevel === 'high' ? '🔴' : details.riskLevel === 'medium' ? '🟡' : '🟢';
        const automationNote = details.forAutomation ? '\n\nThis tool is required for a scheduled automation.' : '';
        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setCustomId(`perm:${permId}:allow_once`).setLabel('Allow Once').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId(`perm:${permId}:allow_always`).setLabel('Always Allow').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId(`perm:${permId}:deny`).setLabel('Deny').setStyle(ButtonStyle.Danger),
          new ButtonBuilder().setCustomId(`perm:${permId}:instruct`).setLabel('Instruct').setStyle(ButtonStyle.Secondary),
        );

        try {
          const channel = await this.client.channels.fetch(channelId);
          if (channel?.isTextBased()) {
            await (channel as TextChannel).send({
              content: `${riskEmoji} **Permission Request**\n\nTool: \`${details.toolId}\`\nPath: \`${details.path}\`\nRisk: ${details.riskLevel}${automationNote}\n\nAllow, deny, or send a custom instruction?`,
              components: [row],
            });
          }
        } catch {
          return;
        }
      },
      () => userId,
      async (key) => {
        const channelId = this.lastChannelByUser.get(key);
        if (!channelId || !this.client) return;
        const channel = await this.client.channels.fetch(channelId);
        if (channel?.isTextBased()) {
          await (channel as TextChannel).send('✏️ Reply with your instruction for the agent (how to proceed instead).');
        }
      },
    );

    toolExecutor.setChannelPermissionRequestHandler(handler);

    // Abort the active turn when a permission prompt times out — prevents prompt loops.
    this.permissionCoordinator.onTimeout(() => {
      if (agent.processing) {
        agent.cancel();
        const channelId = this.lastChannelByUser.get(userId);
        if (channelId && this.client) {
          void this.client.channels.fetch(channelId).then((ch) => {
            if (ch?.isTextBased()) {
              void (ch as TextChannel).send('⏱ Permission timed out — run stopped. Send a new message to resume.').catch(() => {});
            }
          }).catch(() => {});
        }
      }
    });
  }

  attach(agent: Agent): void {
    this.agent = agent;
  }

  setAgentFactory(factory: (userId: string) => Promise<Agent> | Agent): void {
    this.agentFactory = factory;
  }

  private startActivityCleanup(): void {
    if (this.cleanupInterval) return;
    
    this.cleanupInterval = setInterval(() => {
      const now = Date.now();
      const toEvict: string[] = [];
      
      // Find inactive users
      for (const [userId, lastActivity] of this.userAgentActivity.entries()) {
        if (now - lastActivity > this.INACTIVITY_THRESHOLD_MS) {
          toEvict.push(userId);
        }
      }
      
      // Evict inactive agents
      for (const userId of toEvict) {
        const agent = this.userAgents.get(userId);
        if (agent) {
          // Properly dispose of the agent
          if (typeof agent.dispose === 'function') {
            agent.dispose();
          }
          this.userAgents.delete(userId);
          this.userAgentActivity.delete(userId);
          this.eventBus.emit({
            type: 'discord_agent_evicted',
            code: 'DISCORD_AGENT_EVICTED',
            message: `Evicted inactive agent for user ${userId}`,
            recoverable: false,
          });
        }
      }
    }, this.CLEANUP_INTERVAL_MS);
  }

  private stopActivityCleanup(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
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
      if (interaction.isButton()) {
        await this.handleButtonInteraction(interaction);
        return;
      }
      if (!interaction.isChatInputCommand()) return;
      await this.handleSlashCommand(interaction);
    });

    this.client.on(Events.MessageCreate, async (message: Message) => {
      await this.handleMessage(message);
    });

    await this.client.login(token);

    // Start cleanup timer for inactive user agents
    this.startActivityCleanup();

    // Register slash commands
    await this.registerSlashCommands();
  }

  stop(): void {
    this.stopActivityCleanup();
    this.connected = false;
    if (this.client) {
      this.client.removeAllListeners();
      this.client.destroy();
      this.client = null;
    }
    this.userAgents.clear();
    this.userAgentActivity.clear();
  }

  async sendMessage(channelId: string, content: string): Promise<void> {
    if (!this.client) return;
    try {
      const channel = await this.client.channels.fetch(channelId);
      if (channel && channel.isTextBased()) {
        const renderer = getRenderer('discord');
        const results = renderer.renderMarkdown(content);
        for (const result of results) {
          const payload = result.payload as { content?: string };
          await (channel as TextChannel).send(payload.content ?? '');
        }
      }
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : 'Failed to send message';
      this.emitError(errMsg);
    }
  }

  async sendFile(channelId: string, file: string | { name: string; content: Buffer }, messageText?: string): Promise<void> {
    if (!this.client) return;
    try {
      const channel = await this.client.channels.fetch(channelId);
      if (!channel || !channel.isTextBased()) {
        throw new Error('Discord channel not found or not text-based');
      }
      let attachment: AttachmentBuilder;
      if (typeof file === 'string') {
        const { readFileSync } = await import('node:fs');
        const { basename } = await import('node:path');
        const data = readFileSync(file);
        attachment = new AttachmentBuilder(data, { name: basename(file) });
      } else {
        attachment = new AttachmentBuilder(file.content, { name: file.name || 'attachment' });
      }
      await (channel as TextChannel).send({ content: messageText || '', files: [attachment] });
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : 'Failed to send file';
      this.emitError(errMsg);
    }
  }

  async sendDM(userId: string, content: string): Promise<void> {
    if (!this.client) return;
    try {
      const user = await this.client.users.fetch(userId);
      const renderer = getRenderer('discord');
      const results = renderer.renderMarkdown(content);
      for (const result of results) {
        const payload = result.payload as { content?: string };
        await user.send(payload.content ?? '');
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

  private async handleButtonInteraction(interaction: ButtonInteraction): Promise<void> {
    const customId = interaction.customId;

    if (customId.startsWith('clar:')) {
      const agent = this.userAgents.get(interaction.user.id);
      await deliverQuestionnaireCallback(
        this.questionnaireCoordinator,
        customId,
        interaction.user.id,
        agent,
        {
          sendQuestionnaireStep: (prompt, buttons) =>
            this.sendDiscordQuestionnaireStep(interaction.channelId, prompt, buttons),
          sendText: (text) => this.sendMessage(interaction.channelId, text),
        },
      );
      await interaction.deferUpdate();
      return;
    }

    if (!customId.startsWith('perm:')) return;

    const parts = customId.split(':');
    const permId = parts[1];
    const choice = parts[2] as 'allow_once' | 'allow_always' | 'deny' | 'instruct';
    if (!permId || !choice) return;

    if (choice === 'instruct') {
      if (!this.permissionCoordinator.beginInstruct(permId, interaction.user.id)) {
        await interaction.reply({ content: '⏰ Permission request expired.', ephemeral: true });
        return;
      }
      await interaction.reply({ content: '✏️ Reply with your instruction in chat.', ephemeral: true });
      await this.sendMessage(interaction.channelId, '✏️ Reply with your instruction for the agent (how to proceed instead).');
      return;
    }

    if (!this.permissionCoordinator.resolveDecision(permId, choice, interaction.user.id)) {
      await interaction.reply({ content: '⏰ Permission request expired.', ephemeral: true });
      return;
    }

    const toolId = this.permToolIds.get(permId);
    this.permToolIds.delete(permId);
    const agent = this.userAgents.get(interaction.user.id);
    if (agent && toolId && choice !== 'allow_once') {
      agent.recordToolPermissionDecision(toolId, choice);
    }

    const label = permissionResultLabel(choice);
    await interaction.update({ content: label, components: [] });
  }

  private async handleSlashCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    const { commandName } = interaction;
    const userId = interaction.user.id;

    if (!this.isUserAllowed(userId)) {
      await interaction.reply({ content: '⚠️ Unauthorized. Configure allowed user IDs in Settings → Channels.', ephemeral: true });
      return;
    }

    this.lastChannelByUser.set(userId, interaction.channelId);

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

        const exec = agent.getToolExecutor();
        exec?.setMessagingPermissionMode(true);
        const unsubClarification = attachMessagingClarificationListener(agent, {
          userKey: userId,
          questionnaireCoordinator: this.questionnaireCoordinator,
          sendText: (text) => this.sendMessage(interaction.channelId, text),
          sendQuestionnaireStep: (prompt, buttons) =>
            this.sendDiscordQuestionnaireStep(interaction.channelId, prompt, buttons),
        });

        let response;
        try {
          response = await agent.sendMessage(text);
        } finally {
          unsubClarification();
          exec?.setMessagingPermissionMode(false);
        }

        const content = extractMessagingReplyText(response);
        const renderer = getRenderer('discord');
        const renderResults = renderer.renderMarkdown(content);
        const firstPayload = renderResults[0]?.payload as { content?: string } | undefined;
        await interaction.editReply(firstPayload?.content ?? '(empty)');
        for (let i = 1; i < renderResults.length; i++) {
          const payload = renderResults[i]!.payload as { content?: string };
          await interaction.followUp(payload.content ?? '');
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

    if (!this.isUserAllowed(userId)) {
      if (message.channel.isTextBased()) {
        await (message.channel as TextChannel).send('⚠️ Unauthorized. Configure allowed user IDs in Settings → Channels.');
      }
      return;
    }

    this.lastChannelByUser.set(userId, message.channel.id);
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
      message: `User ${userId} len=${(message.content ?? '').length}`,
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

      if (this.permissionCoordinator.isAwaitingInstruct(userId)) {
        if (this.permissionCoordinator.consumeInstructText(userId, userContent.trim())) {
          if (message.channel.isTextBased()) {
            await (message.channel as TextChannel).send('✏️ Instruction sent to the agent.');
          }
          return;
        }
      }

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

      if (tryConsumeMessagingClarification(agent, userContent.trim())) {
        return;
      }

      // Send typing indicator if in a text-based channel
      if (message.channel.isTextBased()) {
        try {
          await (message.channel as TextChannel).sendTyping();
        } catch {
          // ignore
        }
      }

      const exec = agent.getToolExecutor();
      exec?.setMessagingPermissionMode(true);
      const unsubClarification = attachMessagingClarificationListener(agent, {
        userKey: userId,
        questionnaireCoordinator: this.questionnaireCoordinator,
        sendText: (text) => this.sendMessage(message.channel.id, text),
        sendQuestionnaireStep: (prompt, buttons) =>
          this.sendDiscordQuestionnaireStep(message.channel.id, prompt, buttons),
      });

      let response;
      try {
        response = await agent.sendMessage(userContent.trim());
      } finally {
        unsubClarification();
        exec?.setMessagingPermissionMode(false);
      }

      const content = extractMessagingReplyText(response);

      // Use DiscordRenderer for native Discord markdown formatting + chunking
      const renderer = getRenderer('discord');
      const renderResults = renderer.renderMarkdown(content);

      // Reply in the same channel/thread/DM
      for (let i = 0; i < renderResults.length; i++) {
        const result = renderResults[i]!;
        const payload = result.payload as { content?: string; components?: unknown };
        if (i === 0) {
          await message.reply(payload.content ?? '');
        } else {
          await (message.channel as TextChannel).send(payload.content ?? '');
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
    // Update activity timestamp
    this.userAgentActivity.set(userId, Date.now());
    
    const existing = this.userAgents.get(userId);
    if (existing) return existing;

    let agent: Agent;
    if (this.agentFactory) {
      agent = await this.agentFactory(userId);
      this.wireAgentPermissions(agent, userId);
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
    await writeFile(savedPath, Buffer.from(arrayBuffer));
    return savedPath;
  }

  private async sendDiscordQuestionnaireStep(
    channelId: string,
    prompt: string,
    buttons: Array<{ label: string; actionId: string }>,
  ): Promise<void> {
    if (!this.client) return;
    const channel = await this.client.channels.fetch(channelId);
    if (!channel?.isTextBased()) return;

    const rows: ActionRowBuilder<ButtonBuilder>[] = [];
    let current = new ActionRowBuilder<ButtonBuilder>();
    for (const btn of buttons.slice(0, 25)) {
      if (current.components.length >= 5) {
        rows.push(current);
        current = new ActionRowBuilder<ButtonBuilder>();
      }
      current.addComponents(
        new ButtonBuilder()
          .setCustomId(btn.actionId.slice(0, 100))
          .setLabel(btn.label.slice(0, 80))
          .setStyle(ButtonStyle.Secondary),
      );
    }
    if (current.components.length > 0) rows.push(current);

    await (channel as TextChannel).send({
      content: prompt.replace(/\*/g, '').slice(0, 2000),
      components: rows.slice(0, 5),
    });
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
