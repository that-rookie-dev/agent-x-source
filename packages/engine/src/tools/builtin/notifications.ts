import { execSync } from 'node:child_process';
import type { ToolResult, ToolExecutionContext } from '@agentx/shared';
import { IS_WINDOWS, IS_MACOS, IS_LINUX } from '../platform.js';
import {
  resolveSlackWebhookUrl,
  resolveTelegramNotifyCredentials,
} from './notify-config.js';

export async function notifyDesktop(args: Record<string, unknown>): Promise<ToolResult> {
  const title = args['title'] as string;
  const message = args['message'] as string;

  if (!title || !message) {
    return { success: false, output: 'title and message are required', error: 'MISSING_INPUT' };
  }

  try {
    const appTitle = 'Agent-X';
    const displayMessage = title === appTitle ? message : `${title}: ${message}`;
    if (IS_MACOS) {
      const script = `display notification "${displayMessage.replace(/"/g, '\\"')}" with title "${appTitle.replace(/"/g, '\\"')}"`;
      execSync(`osascript -e '${script}'`, { timeout: 5000 });
    } else if (IS_LINUX) {
      execSync(`notify-send "${appTitle.replace(/"/g, '\\"')}" "${displayMessage.replace(/"/g, '\\"')}"`, { timeout: 5000 });
    } else if (IS_WINDOWS) {
      execSync(`msg * "${appTitle}: ${displayMessage.replace(/"/g, '')}"`, { timeout: 5000 });
    } else {
      return { success: true, output: `[${appTitle}] ${displayMessage}` };
    }
    return { success: true, output: `Notification sent: ${appTitle} - ${displayMessage}` };
  } catch (error) {
    return { success: true, output: `[${title}] ${message} (notification display may have failed: ${(error as Error).message})` };
  }
}

export async function notifyTelegram(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const message = args['message'] as string;

  if (!message) {
    return { success: false, output: 'message is required', error: 'MISSING_INPUT' };
  }

  const { botToken, chatId } = resolveTelegramNotifyCredentials(context.config);

  if (!botToken || !chatId) {
    return {
      success: false,
      output: 'Telegram is not configured for outbound notifications. Set it up in Settings → Channels.',
      error: 'CONFIG_MISSING',
    };
  }

  try {
    const { getActiveTelegramBridge } = await import('../../telegram/index.js');
    const bridge = getActiveTelegramBridge();
    if (bridge?.isRunning()) {
      await bridge.sendMessage(Number(chatId), message);
      return { success: true, output: 'Telegram notification sent' };
    }

    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: message }),
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      return { success: false, output: `Telegram API error: ${response.status}`, error: 'API_ERROR' };
    }
    return { success: true, output: 'Telegram notification sent' };
  } catch (error) {
    return { success: false, output: `Telegram send failed: ${(error as Error).message}`, error: 'SEND_ERROR' };
  }
}

export async function notifySlack(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const message = args['message'] as string;

  if (!message) {
    return { success: false, output: 'message is required', error: 'MISSING_INPUT' };
  }

  const webhookUrl = resolveSlackWebhookUrl(context.config);

  if (!webhookUrl) {
    return { success: false, output: 'Slack webhook not configured (Settings → Channels)', error: 'CONFIG_MISSING' };
  }

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: message }),
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      return { success: false, output: `Slack webhook error: ${response.status}`, error: 'API_ERROR' };
    }
    return { success: true, output: 'Slack notification sent' };
  } catch (error) {
    return { success: false, output: `Slack send failed: ${(error as Error).message}`, error: 'SEND_ERROR' };
  }
}

export async function notifyEmail(args: Record<string, unknown>, _context: ToolExecutionContext): Promise<ToolResult> {
  const message = args['message'] as string;

  if (!message) {
    return { success: false, output: 'message is required', error: 'MISSING_INPUT' };
  }

  return {
    success: false,
    output: 'Email notifications are delivered via Settings → Channels when automations complete. Configure SMTP there.',
    error: 'CONFIG_VIA_SETTINGS',
  };
}

export async function notifyDiscord(args: Record<string, unknown>, _context: ToolExecutionContext): Promise<ToolResult> {
  const message = args['message'] as string;

  if (!message) {
    return { success: false, output: 'message is required', error: 'MISSING_INPUT' };
  }

  return {
    success: false,
    output: 'Discord notifications are delivered via Settings → Channels webhook when automations complete.',
    error: 'CONFIG_VIA_SETTINGS',
  };
}

export async function clipboardRead(): Promise<ToolResult> {
  try {
    let text: string;
    if (IS_MACOS) {
      text = execSync('pbpaste', { encoding: 'utf-8', timeout: 5000 });
    } else if (IS_WINDOWS) {
      text = execSync('powershell -command "Get-Clipboard"', { encoding: 'utf-8', timeout: 5000 });
    } else {
      text = execSync('xclip -o -selection clipboard 2>/dev/null || xsel -b 2>/dev/null', { encoding: 'utf-8', timeout: 5000 });
    }
    return { success: true, output: text.trim() || '(clipboard empty)' };
  } catch (error) {
    return { success: false, output: `Clipboard read failed: ${(error as Error).message}`, error: 'CLIPBOARD_ERROR' };
  }
}

export async function clipboardWrite(args: Record<string, unknown>): Promise<ToolResult> {
  const text = args['text'] as string;

  if (text === undefined) {
    return { success: false, output: 'text is required', error: 'MISSING_INPUT' };
  }

  try {
    if (IS_MACOS) {
      execSync(`echo ${JSON.stringify(text)} | pbcopy`, { encoding: 'utf-8', timeout: 5000 });
    } else if (IS_WINDOWS) {
      execSync(`powershell -command "Set-Clipboard -Value '${text.replace(/'/g, "''")}'"`, { encoding: 'utf-8', timeout: 5000 });
    } else {
      execSync(`echo ${JSON.stringify(text)} | xclip -selection clipboard 2>/dev/null || echo ${JSON.stringify(text)} | xsel -b`, { encoding: 'utf-8', timeout: 5000 });
    }
    return { success: true, output: `Copied to clipboard: ${text.length > 50 ? text.slice(0, 50) + '...' : text}` };
  } catch (error) {
    return { success: false, output: `Clipboard write failed: ${(error as Error).message}`, error: 'CLIPBOARD_ERROR' };
  }
}
