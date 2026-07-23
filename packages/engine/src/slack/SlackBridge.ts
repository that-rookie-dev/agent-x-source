import { App, LogLevel } from '@slack/bolt';
import type { Agent } from '../agent/Agent.js';
import { EventEmitter } from 'node:events';
import type { EngineEvent } from '@agentx/shared';
import { isChannelUserAllowed } from '@agentx/shared';
import { MessagingPermissionCoordinator, permissionResultLabel } from '../channels/MessagingPermissionCoordinator.js';
import { MessagingQuestionnaireCoordinator } from '../channels/MessagingQuestionnaireCoordinator.js';
import { getRenderer } from '../channels/renderers/index.js';
import {
  attachMessagingClarificationListener,
  deliverQuestionnaireCallback,
  extractMessagingReplyText,
  tryConsumeMessagingClarification,
} from '../channels/MessagingClarificationHelper.js';

export interface SlackConfig {
  botToken: string;
  appToken: string;
}

export interface SlackBridgeStatus {
  configured: boolean;
  connected: boolean;
  team?: string;
}

interface SlackFile {
  url_private: string;
  name: string;
  mimetype: string;
  title?: string;
}

interface SlackMessageEvent {
  userId: string;
  channel: string;
  text: string;
  messageTs: string;
  threadTs?: string;
  files?: SlackFile[];
}

/**
 * Slack bridge using Bolt with Socket Mode.
 * Supports per-user session isolation, file handling,
 * threaded replies, interactive blocks, and automatic reconnection.
 */
export class SlackBridge extends EventEmitter {
  private app: App | null = null;
  private connected = false;
  private teamName?: string;
  private botUserId?: string;
  private userAgents = new Map<string, Agent>();
  private agentFactory: ((userId: string) => Agent) | null = null;
  private messageHandler: ((event: SlackMessageEvent, client: InstanceType<typeof App>['client']) => void | Promise<void>) | null = null;
  private config: SlackConfig;
  private messageCount = 0;
  private unsubscribers = new Map<string, () => void>();
  private allowedUserIds: string[] = [];
  private lastChannelByUser = new Map<string, string>();
  private lastThreadByUser = new Map<string, string>();
  private permissionCoordinator = new MessagingPermissionCoordinator();
  private questionnaireCoordinator = new MessagingQuestionnaireCoordinator();
  private permToolIds = new Map<string, string>();
  private wiredAgents = new WeakSet<Agent>();

  constructor(config: SlackConfig) {
    super();
    this.config = config;
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
        const channel = this.lastChannelByUser.get(userId);
        if (!channel || !this.app) return;
        this.permToolIds.set(permId, details.toolId);
        const threadTs = this.lastThreadByUser.get(userId);
        const riskEmoji = details.riskLevel === 'high' ? ':red_circle:' : details.riskLevel === 'medium' ? ':large_yellow_circle:' : ':large_green_circle:';
        const automationNote = details.forAutomation ? '\n\n_This tool is required for a scheduled automation._' : '';
        await this.app.client.chat.postMessage({
          channel,
          thread_ts: threadTs,
          text: `${riskEmoji} Permission request: ${details.toolId}`,
          blocks: [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `${riskEmoji} *Permission Request*\n\nTool: \`${details.toolId}\`\nPath: \`${details.path}\`\nRisk: ${details.riskLevel}${automationNote}\n\nAllow, deny, or send a custom instruction?`,
              },
            },
            {
              type: 'actions',
              block_id: `perm_${permId}`,
              elements: [
                { type: 'button', text: { type: 'plain_text', text: 'Allow Once' }, action_id: `perm_${permId}_allow_once`, style: 'primary' },
                { type: 'button', text: { type: 'plain_text', text: 'Always Allow' }, action_id: `perm_${permId}_allow_always` },
                { type: 'button', text: { type: 'plain_text', text: 'Deny' }, action_id: `perm_${permId}_deny`, style: 'danger' },
                { type: 'button', text: { type: 'plain_text', text: 'Instruct' }, action_id: `perm_${permId}_instruct` },
              ],
            },
          ],
        });
      },
      () => userId,
      async (key) => {
        const channel = this.lastChannelByUser.get(key);
        if (!channel || !this.app) return;
        await this.app.client.chat.postMessage({
          channel,
          thread_ts: this.lastThreadByUser.get(key),
          text: '✏️ Reply with your instruction for the agent (how to proceed instead).',
        });
      },
    );

    toolExecutor.setChannelPermissionRequestHandler(handler);

    // Abort the active turn when a permission prompt times out — prevents prompt loops.
    this.permissionCoordinator.onTimeout(() => {
      if (agent.processing) {
        agent.cancel();
        const channel = this.lastChannelByUser.get(userId);
        if (channel && this.app) {
          void this.app.client.chat.postMessage({
            channel,
            thread_ts: this.lastThreadByUser.get(userId),
            text: '⏱ Permission timed out — run stopped. Send a new message to resume.',
          }).catch(() => {});
        }
      }
    });
  }

  setAgentFactory(factory: (userId: string) => Agent): void {
    this.agentFactory = factory;
  }

  setMessageHandler(handler: (event: SlackMessageEvent, client: InstanceType<typeof App>['client']) => void | Promise<void>): void {
    this.messageHandler = handler;
  }

  async start(): Promise<void> {
    const maxRetries = 3;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        await this.doStart();
        return;
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        this.emit('slack_error', new Error(`Start attempt ${attempt + 1}/${maxRetries} failed: ${errMsg}`));
        if (attempt === maxRetries - 1) throw error;
        const delay = 2000 * (attempt + 1);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  private async doStart(): Promise<void> {
    this.app = new App({
      token: this.config.botToken,
      appToken: this.config.appToken,
      socketMode: true,
      logLevel: LogLevel.ERROR,
    });

    this.app.event('app_mention', async ({ event, client }) => {
      await this.handleMessage(
        {
          userId: event.user ?? '',
          channel: event.channel ?? '',
          text: event.text ?? '',
          messageTs: event.ts ?? '',
          threadTs: event.thread_ts,
        },
        client,
      );
    });

    this.app.message(async ({ message, context, client }) => {
      const msg = message as unknown as Record<string, unknown>;
      if (typeof msg.subtype === 'string') return;

      const channel = typeof context.channelId === 'string' ? context.channelId : undefined;
      const user = typeof msg.user === 'string' ? msg.user : undefined;
      const text = typeof msg.text === 'string' ? msg.text : undefined;
      const ts = typeof msg.ts === 'string' ? msg.ts : undefined;
      const channelType = typeof msg.channel_type === 'string' ? msg.channel_type : undefined;
      const threadTs = typeof msg.thread_ts === 'string' ? msg.thread_ts : undefined;
      const rawFiles = Array.isArray(msg.files) ? msg.files : undefined;
      const files = rawFiles?.map((f: Record<string, unknown>) => ({
        url_private: typeof f.url_private === 'string' ? f.url_private : '',
        name: typeof f.name === 'string' ? f.name : 'file',
        mimetype: typeof f.mimetype === 'string' ? f.mimetype : 'application/octet-stream',
        title: typeof f.title === 'string' ? f.title : undefined,
      })).filter((f) => f.url_private) as SlackFile[] | undefined;

      if (!user || !text || !ts || !channel) return;

      const isDm = channelType === 'im';
      const isMention = this.botUserId !== undefined && text.includes(`<@${this.botUserId}>`);

      if (!isDm && !isMention) return;

      await this.handleMessage(
        { userId: user, channel, text, messageTs: ts, threadTs, files },
        client,
      );
    });

    this.app.error(async (error) => {
      this.emit('slack_error', error);
    });

    this.app.action(/^perm_[a-f0-9-]+_(allow_once|allow_always|deny|instruct)$/, async ({ action, ack, body, client }) => {
      await ack();
      const actionId = (action as { action_id?: string }).action_id ?? '';
      const match = actionId.match(/^perm_([a-f0-9-]+)_(allow_once|allow_always|deny|instruct)$/);
      if (!match) return;
      const permId = match[1]!;
      const choice = match[2] as 'allow_once' | 'allow_always' | 'deny' | 'instruct';
      const userId = (body as { user?: { id?: string } }).user?.id;
      if (!userId) return;

      const channel = (body as { channel?: { id?: string } }).channel?.id;
      const messageTs = (body as { message?: { ts?: string } }).message?.ts;

      if (choice === 'instruct') {
        await this.permissionCoordinator.beginInstruct(permId, userId, async () => {
          if (channel) {
            await client.chat.postMessage({
              channel,
              thread_ts: messageTs,
              text: '✏️ Reply with your instruction for the agent (how to proceed instead).',
            });
          }
        });
        return;
      }

      if (!this.permissionCoordinator.resolveDecision(permId, choice, userId)) return;

      const toolId = this.permToolIds.get(permId);
      this.permToolIds.delete(permId);
      const agent = this.userAgents.get(userId);
      if (agent && toolId) {
        agent.recordToolPermissionDecision(toolId, choice);
      }

      if (channel && messageTs) {
        const label = permissionResultLabel(choice);
        try {
          await client.chat.update({ channel, ts: messageTs, text: label, blocks: [] });
        } catch { /* best effort */ }
      }
    });

    this.app.action(/^clar_/, async ({ action, ack, body }) => {
      await ack();
      const actionId = (action as { action_id?: string }).action_id ?? '';
      const userId = (body as { user?: { id?: string } }).user?.id;
      if (!userId || !actionId.startsWith('clar_')) return;
      const data = actionId.slice('clar_'.length);
      const agent = this.userAgents.get(userId);
      const channel = (body as { channel?: { id?: string } }).channel?.id;
      const threadTs = (body as { message?: { thread_ts?: string; ts?: string } }).message?.thread_ts
        ?? (body as { message?: { ts?: string } }).message?.ts;
      await deliverQuestionnaireCallback(
        this.questionnaireCoordinator,
        data,
        userId,
        agent,
        {
          sendQuestionnaireStep: (prompt, buttons, ts) => this.sendSlackQuestionnaireStep(channel ?? '', prompt, buttons, ts ?? threadTs),
          sendText: (text, ts) => this.sendSlackText(channel ?? '', text, ts ?? threadTs),
          threadTs,
        },
      );
    });

    await this.app.start();
    this.connected = true;

    try {
      const auth = await this.app.client.auth.test();
      if (auth.ok && typeof auth.team === 'string') {
        this.teamName = auth.team;
      }
      if (auth.ok && typeof auth.user_id === 'string') {
        this.botUserId = auth.user_id;
      }
    } catch {
      // Auth test is best-effort
    }

    this.emit('slack_connected', { team: this.teamName });
  }

  stop(): void {
    if (this.app) {
      this.app.stop().catch(() => {});
      this.app = null;
    }
    this.connected = false;
    this.teamName = undefined;
    this.botUserId = undefined;
    for (const unsub of this.unsubscribers.values()) {
      unsub();
    }
    this.unsubscribers.clear();
    this.userAgents.clear();
  }

  async sendMessage(channel: string, content: string, threadTs?: string): Promise<void> {
    if (!this.app) throw new Error('Slack bridge not started');
    await this.app.client.chat.postMessage({
      channel,
      text: content,
      thread_ts: threadTs,
    });
  }

  async sendFile(channel: string, file: string | { name: string; content: Buffer }, title?: string, threadTs?: string): Promise<void> {
    if (!this.app) throw new Error('Slack bridge not started');
    let fileStreamOrBuffer: import('node:fs').ReadStream | Buffer;
    let filename: string;
    if (typeof file === 'string') {
      const { createReadStream } = await import('node:fs');
      const { basename } = await import('node:path');
      fileStreamOrBuffer = createReadStream(file);
      filename = title || basename(file);
    } else {
      fileStreamOrBuffer = file.content;
      filename = title || file.name || 'attachment';
    }
    const args = {
      channel_id: channel,
      file: fileStreamOrBuffer,
      filename,
      title: filename,
      ...(threadTs ? { thread_ts: threadTs } : {}),
    };
    // @ts-expect-error — runtime API accepts these args; types are overly strict for optional thread_ts
    await this.app.client.files.uploadV2(args);
  }

  getStatus(): SlackBridgeStatus {
    return {
      configured: !!this.config.botToken && !!this.config.appToken,
      connected: this.connected,
      team: this.teamName,
    };
  }

  private async handleMessage(event: SlackMessageEvent, client: InstanceType<typeof App>['client']): Promise<void> {
    if (!this.isUserAllowed(event.userId)) {
      await client.chat.postMessage({
        channel: event.channel,
        text: '⚠️ Unauthorized. Configure allowed user IDs in Settings → Channels.',
        thread_ts: event.threadTs ?? event.messageTs,
      });
      return;
    }

    this.lastChannelByUser.set(event.userId, event.channel);
    const threadTs = event.threadTs ?? event.messageTs;
    this.lastThreadByUser.set(event.userId, threadTs);
    this.messageCount++;
    this.emit('slack_message', event);

    if (this.messageHandler) {
      await this.messageHandler(event, client);
      return;
    }

    let cleanText = event.text;
    if (this.botUserId) {
      cleanText = cleanText.replace(new RegExp(`<@${this.botUserId}>\\s*`, 'g'), '').trim();
    }

    if (this.permissionCoordinator.isAwaitingInstruct(event.userId)) {
      if (this.permissionCoordinator.consumeInstructText(event.userId, cleanText)) {
        await client.chat.postMessage({
          channel: event.channel,
          text: '✏️ Instruction sent to the agent.',
          thread_ts: threadTs,
        });
        return;
      }
    }

    let agent = this.userAgents.get(event.userId);
    if (!agent && this.agentFactory) {
      agent = this.agentFactory(event.userId);
      this.wireAgentPermissions(agent, event.userId);
      this.userAgents.set(event.userId, agent);
      this.attachToolStatusListener(event.userId, agent, event.channel, threadTs);
    }

    if (!agent) {
      await client.chat.postMessage({
        channel: event.channel,
        text: '⚠️ Agent not configured for this workspace.',
        thread_ts: threadTs,
      });
      return;
    }

    if (tryConsumeMessagingClarification(agent, cleanText)) {
      return;
    }

    try {
      const thinkingMsg = await client.chat.postMessage({
        channel: event.channel,
        text: '🤔 Thinking...',
        thread_ts: threadTs,
      });
      const thinkingTs = thinkingMsg.ts as string | undefined;

      // Download and attach files if present
      if (event.files && event.files.length > 0) {
        const fileInfos = await this.downloadFiles(event.files);
        if (fileInfos.length > 0) {
          cleanText += '\n\n[ATTACHED_FILES]\n' + fileInfos.join('\n');
        }
      }

      const exec = agent.getToolExecutor();
      exec?.setMessagingPermissionMode(true);
      const unsubClarification = attachMessagingClarificationListener(agent, {
        userKey: event.userId,
        threadTs,
        questionnaireCoordinator: this.questionnaireCoordinator,
        sendText: (text, ts) => this.sendSlackText(event.channel, text, ts ?? threadTs),
        sendQuestionnaireStep: (prompt, buttons, ts) =>
          this.sendSlackQuestionnaireStep(event.channel, prompt, buttons, ts ?? threadTs),
      });

      let response;
      try {
        response = await agent.sendMessage(cleanText);
      } finally {
        unsubClarification();
        exec?.setMessagingPermissionMode(false);
      }

      const content = extractMessagingReplyText(response);

      // Delete the "Thinking..." message now that we have the response
      if (thinkingTs) {
        try {
          await client.chat.delete({
            channel: event.channel,
            ts: thinkingTs,
          });
        } catch {
          // If we can't delete, try to update it to something minimal
          try {
            await client.chat.update({
              channel: event.channel,
              ts: thinkingTs,
              text: '✅ Done',
            });
          } catch { /* best effort */ }
        }
      }

      // Use SlackRenderer for native Block Kit formatting
      const renderer = getRenderer('slack');
      const renderResults = renderer.renderMarkdown(content);
      for (const result of renderResults) {
        const payload = result.payload as { blocks?: unknown[] };
        const messageArgs: Record<string, unknown> = {
          channel: event.channel,
          text: content.slice(0, 3000),
          thread_ts: threadTs,
        };
        if (payload.blocks) {
          messageArgs.blocks = payload.blocks;
        }
        // @ts-expect-error — Slack SDK types are strict about Block shapes; our runtime objects are valid
        await client.chat.postMessage(messageArgs);
      }
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : 'Processing failed';
      await client.chat.postMessage({
        channel: event.channel,
        text: `❌ Error: ${errMsg}`,
        thread_ts: threadTs,
      });
    }
  }

  private async sendSlackText(channel: string, text: string, threadTs?: string): Promise<void> {
    if (!this.app) return;
    await this.app.client.chat.postMessage({
      channel,
      text,
      thread_ts: threadTs,
    });
  }

  private async sendSlackQuestionnaireStep(
    channel: string,
    prompt: string,
    buttons: Array<{ label: string; actionId: string }>,
    threadTs?: string,
  ): Promise<void> {
    if (!this.app || !channel) return;
    const elements = buttons.slice(0, 25).map((btn) => ({
      type: 'button' as const,
      text: { type: 'plain_text' as const, text: btn.label.slice(0, 75) },
      action_id: `clar_${btn.actionId}`.slice(0, 255),
    }));
    const rows: Array<{ type: 'actions'; elements: typeof elements }> = [];
    for (let i = 0; i < elements.length; i += 5) {
      rows.push({ type: 'actions', elements: elements.slice(i, i + 5) });
    }
    await this.app.client.chat.postMessage({
      channel,
      thread_ts: threadTs,
      text: prompt.replace(/\*/g, '').slice(0, 3000),
      blocks: [
        { type: 'section', text: { type: 'mrkdwn', text: prompt.slice(0, 3000) } },
        ...rows,
      ],
    });
  }

  private async downloadFiles(files: SlackFile[]): Promise<string[]> {
    const { writeFile, mkdir } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const { getDataDir } = await import('../config/paths.js');
    const filesDir = join(getDataDir(), 'slack-files');
    await mkdir(filesDir, { recursive: true });

    const results: string[] = [];
    for (const file of files) {
      try {
        const buffer = await this.downloadSlackFile(file.url_private);
        const safeName = `${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
        const filePath = join(filesDir, safeName);
        await writeFile(filePath, buffer);
        results.push(`File: ${file.name} (${file.mimetype}) saved at ${filePath}`);
      } catch {
        results.push(`File: ${file.name} - failed to download`);
      }
    }
    return results;
  }

  private async downloadSlackFile(url: string): Promise<Buffer> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60_000);
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${this.config.botToken}` },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!response.ok) {
      throw new Error(`Failed to download file: ${response.status}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  private attachToolStatusListener(userId: string, agent: Agent, channel: string, threadTs: string): void {
    const unsub = agent.events.on((ev: EngineEvent) => {
      if (!this.app) return;
      if (ev.type === 'tool_executing') {
        void this.app.client.chat.postMessage({
          channel,
          thread_ts: threadTs,
          text: `🔧 Running: ${ev.tool}`,
          blocks: [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `*Tool Executing:* \`${ev.tool}\`\n>${ev.description}`,
              },
            },
          ],
        });
      } else if (ev.type === 'tool_complete') {
        const status = ev.result.success ? '✅ Success' : '❌ Failed';
        const output = ev.result.output.slice(0, 2900);
        void this.app.client.chat.postMessage({
          channel,
          thread_ts: threadTs,
          text: `${status}: ${ev.tool}`,
          blocks: [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `*${status}:* \`${ev.tool}\`\n\`\`\`${output}\`\`\``,
              },
            },
          ],
        });
      }
    });
    this.unsubscribers.set(userId, unsub);
  }

}
