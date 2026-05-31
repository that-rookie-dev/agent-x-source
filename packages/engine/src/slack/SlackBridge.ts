import { App, LogLevel } from '@slack/bolt';
import type { Agent } from '../agent/Agent.js';
import { EventEmitter } from 'node:events';
import type { EngineEvent } from '@agentx/shared';

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
  private config: SlackConfig;
  private messageCount = 0;
  private unsubscribers = new Map<string, () => void>();

  constructor(config: SlackConfig) {
    super();
    this.config = config;
  }

  setAgentFactory(factory: (userId: string) => Agent): void {
    this.agentFactory = factory;
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

  async sendFile(channel: string, filePath: string, title?: string, threadTs?: string): Promise<void> {
    if (!this.app) throw new Error('Slack bridge not started');
    const { createReadStream } = await import('node:fs');
    const args = {
      channel_id: channel,
      file: createReadStream(filePath),
      title: title || filePath,
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
    this.messageCount++;
    this.emit('slack_message', event);

    let cleanText = event.text;
    if (this.botUserId) {
      cleanText = cleanText.replace(new RegExp(`<@${this.botUserId}>\\s*`, 'g'), '').trim();
    }

    let agent = this.userAgents.get(event.userId);
    if (!agent && this.agentFactory) {
      agent = this.agentFactory(event.userId);
      this.userAgents.set(event.userId, agent);
      this.attachToolStatusListener(event.userId, agent, event.channel, event.threadTs ?? event.messageTs);
    }

    if (!agent) {
      await client.chat.postMessage({
        channel: event.channel,
        text: '⚠️ Agent not configured for this workspace.',
        thread_ts: event.threadTs ?? event.messageTs,
      });
      return;
    }

    try {
      await client.chat.postMessage({
        channel: event.channel,
        text: '🤔 Thinking...',
        thread_ts: event.threadTs ?? event.messageTs,
      });

      // Download and attach files if present
      if (event.files && event.files.length > 0) {
        const fileInfos = await this.downloadFiles(event.files);
        if (fileInfos.length > 0) {
          cleanText += '\n\n[ATTACHED_FILES]\n' + fileInfos.join('\n');
        }
      }

      const response = await agent.sendMessage(cleanText);
      const content = response.content || '(No response)';

      const blocks = this.buildResponseBlocks(content);
      const messageArgs: Record<string, unknown> = {
        channel: event.channel,
        text: content,
        thread_ts: event.threadTs ?? event.messageTs,
      };
      if (blocks) {
        messageArgs.blocks = blocks;
      }
      // @ts-expect-error — Slack SDK types are strict about Block shapes; our runtime objects are valid
      await client.chat.postMessage(messageArgs);
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : 'Processing failed';
      await client.chat.postMessage({
        channel: event.channel,
        text: `❌ Error: ${errMsg}`,
        thread_ts: event.threadTs ?? event.messageTs,
      });
    }
  }

  private async downloadFiles(files: SlackFile[]): Promise<string[]> {
    const { writeFileSync, mkdirSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { getDataDir } = await import('../config/paths.js');
    const filesDir = join(getDataDir(), 'slack-files');
    mkdirSync(filesDir, { recursive: true });

    const results: string[] = [];
    for (const file of files) {
      try {
        const buffer = await this.downloadSlackFile(file.url_private);
        const safeName = `${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
        const filePath = join(filesDir, safeName);
        writeFileSync(filePath, buffer);
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

  private buildResponseBlocks(content: string): unknown[] | undefined {
    if (content.length < 3000 && !content.includes('```')) return undefined;
    return [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: content.slice(0, 3000),
        },
      },
    ];
  }
}
