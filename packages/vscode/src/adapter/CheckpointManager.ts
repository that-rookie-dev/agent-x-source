import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { generateSessionId } from '@agentx/shared';
import type { ChatMessage } from './types';
import type { SessionPersistence } from './SessionPersistence';

const MAX_AUTO_CHECKPOINTS = 20;

interface Checkpoint {
  id: string;
  sessionId: string;
  label: string;
  createdAt: string;
  messageCount: number;
}

interface CheckpointData {
  checkpoint: Checkpoint;
  messages: ChatMessage[];
}

export class CheckpointManager {
  constructor(
    private readonly persistence: SessionPersistence,
  ) {}

  private getCheckpointsDir(sessionId: string): string {
    return path.join(this.persistence.getSessionDir(sessionId), 'checkpoints');
  }

  createCheckpoint(sessionId: string, messages: ChatMessage[], label?: string): Checkpoint {
    const dir = this.getCheckpointsDir(sessionId);
    fs.mkdirSync(dir, { recursive: true });

    const id = generateSessionId();
    const checkpoint: Checkpoint = {
      id,
      sessionId,
      label: label || `Checkpoint ${new Date().toLocaleString()}`,
      createdAt: new Date().toISOString(),
      messageCount: messages.length,
    };

    const data: CheckpointData = {
      checkpoint,
      messages,
    };

    const filePath = path.join(dir, `${id}.json`);
    const tmpPath = filePath + '.tmp';
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
    fs.renameSync(tmpPath, filePath);

    return checkpoint;
  }

  createAutoCheckpoint(sessionId: string, messages: ChatMessage[]): Checkpoint | null {
    const checkpoint = this.createCheckpoint(sessionId, messages, 'Auto-checkpoint');
    this.pruneAutoCheckpoints(sessionId);
    return checkpoint;
  }

  listCheckpoints(sessionId: string): Checkpoint[] {
    const dir = this.getCheckpointsDir(sessionId);
    if (!fs.existsSync(dir)) {
      return [];
    }

    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
    const checkpoints: Checkpoint[] = [];

    for (const file of files) {
      try {
        const data = JSON.parse(
          fs.readFileSync(path.join(dir, file), 'utf-8'),
        ) as CheckpointData;
        checkpoints.push(data.checkpoint);
      } catch {
        continue;
      }
    }

    checkpoints.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return checkpoints;
  }

  loadCheckpoint(sessionId: string, checkpointId: string): ChatMessage[] | null {
    const filePath = path.join(this.getCheckpointsDir(sessionId), `${checkpointId}.json`);
    if (!fs.existsSync(filePath)) {
      return null;
    }

    try {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as CheckpointData;
      return data.messages;
    } catch {
      return null;
    }
  }

  restoreCheckpoint(
    sessionId: string,
    checkpointId: string,
    currentMessages: ChatMessage[],
  ): ChatMessage[] | null {
    const messages = this.loadCheckpoint(sessionId, checkpointId);
    if (!messages) {
      vscode.window.showErrorMessage(`Checkpoint ${checkpointId} not found.`);
      return null;
    }

    this.createCheckpoint(sessionId, currentMessages, 'Pre-restore checkpoint');

    return messages;
  }

  deleteCheckpoint(sessionId: string, checkpointId: string): boolean {
    const filePath = path.join(this.getCheckpointsDir(sessionId), `${checkpointId}.json`);
    if (!fs.existsSync(filePath)) {
      return false;
    }

    fs.unlinkSync(filePath);
    return true;
  }

  private pruneAutoCheckpoints(sessionId: string): void {
    const dir = this.getCheckpointsDir(sessionId);
    if (!fs.existsSync(dir)) return;

    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
    const autoCheckpoints: Array<{ file: string; createdAt: string }> = [];

    for (const file of files) {
      try {
        const data = JSON.parse(
          fs.readFileSync(path.join(dir, file), 'utf-8'),
        ) as CheckpointData;
        if (data.checkpoint.label === 'Auto-checkpoint') {
          autoCheckpoints.push({ file, createdAt: data.checkpoint.createdAt });
        }
      } catch {
        continue;
      }
    }

    if (autoCheckpoints.length <= MAX_AUTO_CHECKPOINTS) return;

    autoCheckpoints.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const toDelete = autoCheckpoints.slice(0, autoCheckpoints.length - MAX_AUTO_CHECKPOINTS);

    for (const entry of toDelete) {
      try {
        fs.unlinkSync(path.join(dir, entry.file));
      } catch {
        continue;
      }
    }
  }
}
