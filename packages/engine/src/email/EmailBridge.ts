import { EventEmitter } from 'node:events';
import { createWriteStream } from 'node:fs';
import { mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import Imap from 'imap';
import { simpleParser } from 'mailparser';
import type { ParsedMail, Attachment } from 'mailparser';
import { createTransport } from 'nodemailer';
import type { Transporter } from 'nodemailer';
import type { AgentXConfig, EngineEvent, Message } from '@agentx/shared';
import { generateSessionId, getDataDir } from '@agentx/shared';
import { Agent } from '../agent/Agent.js';
import { AgentEventBus } from '../EventBus.js';
import type { ToolExecutor } from '../tools/ToolExecutor.js';
import type { ToolRegistry } from '../tools/ToolRegistry.js';

export interface EmailBridgeConfig {
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpPass: string;
  imapHost?: string;
  imapPort?: number;
  fromAddress: string;
}

export interface EmailBridgeAgentDeps {
  config: AgentXConfig;
  toolExecutor?: ToolExecutor;
  toolRegistry?: ToolRegistry;
  systemPrompt?: string;
}

export interface EmailBridgeStatus {
  connected: boolean;
  configured: boolean;
  unreadCount: number;
  smtpConnected: boolean;
  imapConnected: boolean;
  lastError?: string;
}

export interface EmailAttachment {
  filename: string;
  contentType: string;
  size: number;
  content: Buffer;
}

export interface ParsedEmail {
  messageId: string;
  inReplyTo: string | undefined;
  references: string[];
  from: string;
  to: string[];
  subject: string;
  text: string | undefined;
  html: string | undefined;
  attachments: EmailAttachment[];
  date: Date;
}

export interface EmailBridgeEvents {
  email_connected: () => void;
  email_received: (email: ParsedEmail) => void;
  email_sent: (info: { messageId: string | undefined; to: string }) => void;
  email_error: (error: Error) => void;
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100);
}

function getEmailAddressString(from: ParsedMail['from']): string {
  if (!from) return '';
  if (Array.isArray(from.value)) {
    return from.value.map((a) => a.address ?? a.name).filter(Boolean).join(', ');
  }
  return from.text ?? '';
}

function getToAddresses(to: ParsedMail['to']): string[] {
  if (!to) return [];
  const values = Array.isArray(to) ? to.flatMap((t) => t.value) : to.value;
  return values.map((a) => a.address ?? a.name).filter((s): s is string => !!s);
}

function ensureAttachmentsDir(): string {
  const dir = join(getDataDir(), 'email-attachments');
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export class EmailBridge extends EventEmitter {
  private config: EmailBridgeConfig | null = null;
  private eventBus: AgentEventBus;
  private smtpTransporter: Transporter | null = null;
  private imapClient: Imap | null = null;
  private polling = false;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private connected = false;
  private smtpConnected = false;
  private imapConnected = false;
  private attachedAgent: Agent | null = null;
  private agentDeps: EmailBridgeAgentDeps | null = null;
  private senderAgents = new Map<string, Agent>();
  private backoffMs = 5000;
  private readonly maxBackoffMs = 300_000; // 5 minutes
  private readonly pollIntervalMs = 30_000; // 30 seconds
  private threadMap = new Map<string, string>(); // messageId -> threadRootMessageId
  private unreadCount = 0;
  private lastError: string | undefined;
  private processing = false;
  private messageQueue: Array<{ email: ParsedEmail; resolve: () => void }> = [];

  constructor() {
    super();
    this.eventBus = new AgentEventBus();
  }

  /**
   * Attach a single shared Agent for non-isolated mode.
   */
  attach(agent: Agent): void {
    this.attachedAgent = agent;
  }

  /**
   * Set agent dependencies to enable per-sender isolated agents.
   */
  setAgentDeps(deps: EmailBridgeAgentDeps): void {
    this.agentDeps = deps;
  }

  get events(): AgentEventBus {
    return this.eventBus;
  }

  private emitTyped<K extends keyof EmailBridgeEvents>(event: K, ...args: Parameters<EmailBridgeEvents[K]>): boolean {
    return this.emit(event, ...args);
  }

  async start(config: EmailBridgeConfig): Promise<void> {
    if (this.connected) {
      await this.stop();
    }

    this.config = config;
    this.connected = true;
    this.backoffMs = 5000;
    this.lastError = undefined;

    // Initialize SMTP transporter
    this.smtpTransporter = createTransport({
      host: config.smtpHost,
      port: config.smtpPort,
      secure: config.smtpPort === 465,
      auth: {
        user: config.smtpUser,
        pass: config.smtpPass,
      },
      tls: {
        rejectUnauthorized: true,
      },
      pool: true,
      maxConnections: 3,
    });

    // Verify SMTP connection
    try {
      await this.smtpTransporter.verify();
      this.smtpConnected = true;
    } catch (err) {
      this.smtpConnected = false;
      this.lastError = err instanceof Error ? err.message : 'SMTP verification failed';
      this.emitTyped('email_error', new Error(this.lastError));
    }

    // Initialize IMAP client
    const imapHost = config.imapHost ?? config.smtpHost;
    const imapPort = config.imapPort ?? 993;

    this.imapClient = new Imap({
      user: config.smtpUser,
      password: config.smtpPass,
      host: imapHost,
      port: imapPort,
      tls: true,
      tlsOptions: {
        rejectUnauthorized: true,
      },
      connTimeout: 30000,
      authTimeout: 30000,
      keepalive: true,
    });

    this.imapClient.once('ready', () => {
      this.imapConnected = true;
      this.backoffMs = 5000;
      this.emitTyped('email_connected');
      this.eventBus.emit({
        type: 'error',
        code: 'EMAIL_CONNECTED',
        message: 'Email bridge connected',
        recoverable: true,
      } as EngineEvent);
      this.schedulePoll();
    });

    this.imapClient.once('error', (err: Error) => {
      this.imapConnected = false;
      this.lastError = err.message;
      this.emitTyped('email_error', err);
      this.eventBus.emit({
        type: 'error',
        code: 'EMAIL_IMAP_ERROR',
        message: `IMAP error: ${err.message}`,
        recoverable: true,
      } as EngineEvent);
      this.handleConnectionError();
    });

    this.imapClient.once('end', () => {
      this.imapConnected = false;
      if (this.connected) {
        this.handleConnectionError();
      }
    });

    this.imapClient.connect();
  }

  stop(): void {
    this.connected = false;
    this.polling = false;

    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }

    if (this.imapClient) {
      try {
        this.imapClient.end();
      } catch {
        // ignore
      }
      this.imapClient = null;
    }

    if (this.smtpTransporter) {
      this.smtpTransporter.close();
      this.smtpTransporter = null;
    }

    this.smtpConnected = false;
    this.imapConnected = false;
    this.unreadCount = 0;

    // Clean up sender agents
    for (const agent of this.senderAgents.values()) {
      agent.endSession();
    }
    this.senderAgents.clear();
  }

  async sendEmail(to: string, subject: string, body: string): Promise<void> {
    if (!this.smtpTransporter || !this.config) {
      throw new Error('SMTP not configured');
    }

    const info = await this.smtpTransporter.sendMail({
      from: this.config.fromAddress,
      to,
      subject,
      text: body,
    });

    this.emitTyped('email_sent', {
      messageId: typeof info.messageId === 'string' ? info.messageId : undefined,
      to,
    });
  }

  async replyTo(originalMessageId: string, to: string, subject: string, body: string): Promise<void> {
    if (!this.smtpTransporter || !this.config) {
      throw new Error('SMTP not configured');
    }

    const info = await this.smtpTransporter.sendMail({
      from: this.config.fromAddress,
      to,
      subject,
      text: body,
      inReplyTo: originalMessageId,
      references: [originalMessageId],
    });

    this.emitTyped('email_sent', {
      messageId: typeof info.messageId === 'string' ? info.messageId : undefined,
      to,
    });
  }

  getStatus(): EmailBridgeStatus {
    return {
      connected: this.connected && this.imapConnected && this.smtpConnected,
      configured: !!this.config,
      unreadCount: this.unreadCount,
      smtpConnected: this.smtpConnected,
      imapConnected: this.imapConnected,
      lastError: this.lastError,
    };
  }

  private handleConnectionError(): void {
    if (!this.connected) return;

    this.imapConnected = false;
    this.emitTyped('email_error', new Error(`IMAP connection lost. Retrying in ${this.backoffMs}ms...`));

    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }

    this.pollTimer = setTimeout(() => {
      this.reconnectImap();
    }, this.backoffMs);

    this.backoffMs = Math.min(this.backoffMs * 2, this.maxBackoffMs);
  }

  private reconnectImap(): void {
    if (!this.connected || !this.config) return;

    const imapHost = this.config.imapHost ?? this.config.smtpHost;
    const imapPort = this.config.imapPort ?? 993;

    this.imapClient = new Imap({
      user: this.config.smtpUser,
      password: this.config.smtpPass,
      host: imapHost,
      port: imapPort,
      tls: true,
      tlsOptions: {
        rejectUnauthorized: true,
      },
      connTimeout: 30000,
      authTimeout: 30000,
      keepalive: true,
    });

    this.imapClient.once('ready', () => {
      this.imapConnected = true;
      this.backoffMs = 5000;
      this.emitTyped('email_connected');
      this.schedulePoll();
    });

    this.imapClient.once('error', (err: Error) => {
      this.imapConnected = false;
      this.lastError = err.message;
      this.emitTyped('email_error', err);
      this.handleConnectionError();
    });

    this.imapClient.once('end', () => {
      this.imapConnected = false;
      if (this.connected) {
        this.handleConnectionError();
      }
    });

    this.imapClient.connect();
  }

  private schedulePoll(): void {
    if (!this.polling && this.connected) {
      this.polling = true;
      void this.pollInbox();
    }
  }

  private async pollInbox(): Promise<void> {
    if (!this.polling || !this.connected || !this.imapClient) return;

    try {
      await this.checkInbox();
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.lastError = error.message;
      this.emitTyped('email_error', error);
    }

    if (this.polling && this.connected) {
      this.pollTimer = setTimeout(() => {
        void this.pollInbox();
      }, this.pollIntervalMs);
    }
  }

  private async checkInbox(): Promise<void> {
    if (!this.imapClient) return;

    const imap = this.imapClient;

    await new Promise<void>((resolve, reject) => {
      imap.openBox('INBOX', false, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    // Update unread count
    await new Promise<void>((resolve, reject) => {
      imap.status('INBOX', (err, status) => {
        if (err) {
          reject(err);
        } else {
          this.unreadCount = status?.messages?.unseen ?? 0;
          resolve();
        }
      });
    });

    // Search for unseen messages
    const results: number[] = await new Promise((resolve, reject) => {
      imap.search(['UNSEEN'], (err, uids) => {
        if (err) reject(err);
        else resolve(uids ?? []);
      });
    });

    if (results.length === 0) return;

    // Fetch and process each unseen message
    for (const uid of results) {
      try {
        await this.processMessage(uid);
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        this.emitTyped('email_error', error);
      }
    }
  }

  private async processMessage(uid: number): Promise<void> {
    if (!this.imapClient) return;

    const imap = this.imapClient;

    const email = await new Promise<ParsedEmail>((resolve, reject) => {
      const fetch = imap.fetch([uid], { bodies: '', struct: true });
      let parsedMail: ParsedMail | null = null;

      fetch.on('message', (msg) => {
        let bodyStream: NodeJS.ReadableStream | null = null;

        msg.on('body', (stream) => {
          bodyStream = stream;
        });

        msg.once('end', async () => {
          if (!bodyStream) {
            reject(new Error('No body stream'));
            return;
          }
          try {
            parsedMail = await simpleParser(bodyStream);
          } catch (err) {
            reject(err);
          }
        });
      });

      fetch.once('error', (err: Error) => reject(err));
      fetch.once('end', () => {
        if (!parsedMail) {
          reject(new Error('Failed to parse email'));
          return;
        }

        const attachments: EmailAttachment[] = (parsedMail.attachments ?? []).map((att: Attachment) => ({
          filename: att.filename ?? 'unnamed',
          contentType: att.contentType,
          size: att.content?.length ?? 0,
          content: Buffer.isBuffer(att.content) ? att.content : Buffer.from(String(att.content)),
        }));

        const from = getEmailAddressString(parsedMail.from);
        const to = getToAddresses(parsedMail.to);

        resolve({
          messageId: parsedMail.messageId ?? `unknown-${uid}`,
          inReplyTo: parsedMail.inReplyTo?.[0] ?? undefined,
          references: Array.isArray(parsedMail.references) ? parsedMail.references : parsedMail.references ? [parsedMail.references] : [],
          from,
          to,
          subject: parsedMail.subject ?? '',
          text: parsedMail.text ?? undefined,
          html: typeof parsedMail.html === 'string' ? parsedMail.html : undefined,
          attachments,
          date: parsedMail.date ?? new Date(),
        });
      });
    });

    // Mark as read
    await new Promise<void>((resolve, reject) => {
      imap.addFlags([uid], '\\Seen', (err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    this.unreadCount = Math.max(0, this.unreadCount - 1);
    this.emitTyped('email_received', email);

    // Queue for processing to prevent concurrent sendMessage calls
    await this.queueEmail(email);
  }

  private async queueEmail(email: ParsedEmail): Promise<void> {
    return new Promise((resolve) => {
      this.messageQueue.push({ email, resolve });
      void this.processQueue();
    });
  }

  private async processQueue(): Promise<void> {
    if (this.processing) return;
    this.processing = true;

    while (this.messageQueue.length > 0) {
      const item = this.messageQueue.shift();
      if (!item) continue;

      try {
        await this.handleEmail(item.email);
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        this.emitTyped('email_error', error);
      } finally {
        item.resolve();
      }
    }

    this.processing = false;
  }

  private async handleEmail(email: ParsedEmail): Promise<void> {
    const senderEmail = this.extractSenderEmail(email.from);
    if (!senderEmail) {
      this.emitTyped('email_error', new Error('Could not extract sender email'));
      return;
    }

    // Thread detection
    const threadId = this.detectThread(email);
    this.threadMap.set(email.messageId, threadId);

    // Build message for agent
    let messageText = email.text ?? email.html ?? '';

    // Handle attachments
    if (email.attachments.length > 0) {
      const attachmentsDir = ensureAttachmentsDir();
      const attachmentPaths: string[] = [];

      for (const att of email.attachments) {
        const safeName = `${Date.now()}_${sanitizeFilename(att.filename)}`;
        const destPath = join(attachmentsDir, safeName);
        await pipeline(Readable.from([att.content]), createWriteStream(destPath));
        attachmentPaths.push(destPath);
      }

      const attInfo = email.attachments
        .map((att, i) => `"${att.filename}" (${att.contentType}, ${att.size} bytes) saved at: ${attachmentPaths[i]}`)
        .join('\n');

      messageText += `\n\n[ATTACHMENTS]\n${attInfo}\n[/ATTACHMENTS]`;
    }

    const agent = await this.getOrCreateSenderAgent(senderEmail);

    // Wait if agent is busy
    let waitAttempts = 0;
    while (agent.processing && waitAttempts < 60) {
      await new Promise((r) => setTimeout(r, 1000));
      waitAttempts++;
    }

    if (agent.processing) {
      this.emitTyped('email_error', new Error(`Agent busy, could not process email from ${senderEmail}`));
      return;
    }

    const response: Message = await agent.sendMessage(messageText);

    // Send reply
    const replySubject = email.subject.startsWith('Re:') ? email.subject : `Re: ${email.subject}`;
    await this.replyTo(email.messageId, senderEmail, replySubject, response.content);
  }

  private extractSenderEmail(fromHeader: string): string | null {
    const match = fromHeader.match(/<([^>]+)>/);
    if (match) return match[1]!;
    const simple = fromHeader.trim();
    if (simple.includes('@')) return simple;
    return null;
  }

  private detectThread(email: ParsedEmail): string {
    if (email.inReplyTo) {
      const parentThread = this.threadMap.get(email.inReplyTo);
      if (parentThread) return parentThread;
      return email.inReplyTo;
    }

    for (const ref of email.references) {
      const parentThread = this.threadMap.get(ref);
      if (parentThread) return parentThread;
    }

    return email.messageId;
  }

  private async getOrCreateSenderAgent(senderEmail: string): Promise<Agent> {
    let agent = this.senderAgents.get(senderEmail);
    if (agent) return agent;

    if (this.agentDeps) {
      const sessionId = generateSessionId();
      agent = new Agent({
        config: this.agentDeps.config,
        sessionId,
        systemPrompt: this.agentDeps.systemPrompt,
        toolExecutor: this.agentDeps.toolExecutor,
        toolRegistry: this.agentDeps.toolRegistry,
      });
    } else if (this.attachedAgent) {
      // Fallback: use attached agent (no true isolation)
      agent = this.attachedAgent;
    } else {
      throw new Error('No agent available for email processing');
    }

    this.senderAgents.set(senderEmail, agent);
    return agent;
  }
}
