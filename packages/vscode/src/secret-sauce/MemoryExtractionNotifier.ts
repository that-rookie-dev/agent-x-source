import * as vscode from 'vscode';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getSecretSauceDir } from '@agentx/shared';
import type { SecretSauceManager } from '@agentx/engine';
import type { MemoryEntry } from '../providers/MemoryTreeProvider';

interface MemorySnapshot {
  globalCount: number;
  crewCount: number;
  globalIds: Set<string>;
  crewIds: Set<string>;
}

export class MemoryExtractionNotifier {
  private secretSauce: SecretSauceManager | null = null;
  private lastSnapshot: MemorySnapshot | null = null;
  private checkTimer: ReturnType<typeof setTimeout> | null = null;
  private onMemoryAddedCallback: (() => void) | null = null;

  setSecretSauce(sauce: SecretSauceManager): void {
    this.secretSauce = sauce;
    this.lastSnapshot = this.takeSnapshot();
  }

  setOnMemoryAdded(callback: () => void): void {
    this.onMemoryAddedCallback = callback;
  }

  takeSnapshot(): MemorySnapshot {
    if (!this.secretSauce) {
      return { globalCount: 0, crewCount: 0, globalIds: new Set(), crewIds: new Set() };
    }

    const globalMems = this.secretSauce.memories.getGlobalMemories(100);
    const crewMems = this.secretSauce.memories.getCrewMemories(100);

    return {
      globalCount: globalMems.length,
      crewCount: crewMems.length,
      globalIds: new Set(globalMems.map((m) => m.id)),
      crewIds: new Set(crewMems.map((m) => m.id)),
    };
  }

  onMessageReceived(): void {
    if (!this.secretSauce) return;

    if (this.checkTimer) {
      clearTimeout(this.checkTimer);
    }

    this.checkTimer = setTimeout(() => {
      this.checkForNewMemories();
    }, 3000);
  }

  private checkForNewMemories(): void {
    if (!this.secretSauce || !this.lastSnapshot) return;

    const currentSnapshot = this.takeSnapshot();
    const newMemories: MemoryEntry[] = [];

    const allCurrent = [
      ...this.secretSauce.memories.getGlobalMemories(100),
      ...this.secretSauce.memories.getCrewMemories(100),
    ];

    for (const mem of allCurrent) {
      if (!this.lastSnapshot.globalIds.has(mem.id) && !this.lastSnapshot.crewIds.has(mem.id)) {
        newMemories.push(mem);
      }
    }

    this.lastSnapshot = currentSnapshot;

    if (newMemories.length > 0) {
      this.onMemoryAddedCallback?.();
      this.showMemoryNotifications(newMemories);
    }
  }

  private showMemoryNotifications(memories: MemoryEntry[]): void {
    if (memories.length === 0) return;

    if (memories.length === 1) {
      const mem = memories[0]!;
      const preview = mem.content.length > 60
        ? mem.content.slice(0, 57) + '...'
        : mem.content;

      vscode.window.showInformationMessage(
        `Agent remembered: ${preview}`,
        'View',
        'Forget this',
      ).then((action) => {
        if (action === 'View') {
          vscode.commands.executeCommand('agentx.memory.viewDetail', mem);
        } else if (action === 'Forget this') {
          this.forgetMemory(mem);
        }
      });
    } else {
      vscode.window.showInformationMessage(
        `Agent remembered ${memories.length} new things.`,
        'View Memories',
      ).then((action) => {
        if (action === 'View Memories') {
          vscode.commands.executeCommand('agentx.memory.openEditor');
        }
      });
    }
  }

  private forgetMemory(memory: MemoryEntry): void {
    const sauceDir = getSecretSauceDir();
    const globalCategories = new Set(['identity', 'preference']);
    const isGlobal = globalCategories.has(memory.category);

    let filePath: string;
    if (isGlobal) {
      filePath = join(sauceDir, 'global', 'memories.json');
    } else {
      const crewId = this.secretSauce!.crew.getActiveId();
      filePath = join(sauceDir, 'crews', crewId, 'memories.json');
    }

    if (!existsSync(filePath)) return;

    try {
      const entries = JSON.parse(readFileSync(filePath, 'utf-8')) as MemoryEntry[];
      const filtered = entries.filter((e) => e.id !== memory.id);
      writeFileSync(filePath, JSON.stringify(filtered, null, 2));
      this.lastSnapshot = this.takeSnapshot();
      this.onMemoryAddedCallback?.();
      vscode.window.showInformationMessage('Memory forgotten.');
    } catch {
      vscode.window.showErrorMessage('Failed to forget memory.');
    }
  }

  dispose(): void {
    if (this.checkTimer) {
      clearTimeout(this.checkTimer);
    }
  }
}
