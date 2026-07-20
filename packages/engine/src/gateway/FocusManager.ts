import { getLogger } from '@agentx/shared';

export type ChannelId = string;

export type FocusState = 'focused' | 'background' | 'away';

export interface FocusChangeEvent {
  channelId: ChannelId;
  previousChannelId: ChannelId | null;
  timestamp: number;
}

export type FocusListener = (event: FocusChangeEvent) => void;

export class FocusManager {
  private currentFocus: ChannelId | null = null;
  private channelStates = new Map<ChannelId, FocusState>();
  private activityTimestamps = new Map<ChannelId, number>();
  private listeners = new Set<FocusListener>();
  private focusQueue: Array<{ channelId: ChannelId; resolve: () => void }> = [];
  private processingQueue = false;

  static readonly ACTIVITY_TIMEOUT_MS = 5 * 60 * 1000;

  registerChannel(channelId: ChannelId): void {
    this.channelStates.set(channelId, 'background');
  }

  unregisterChannel(channelId: ChannelId): void {
    this.channelStates.delete(channelId);
    this.activityTimestamps.delete(channelId);
    if (this.currentFocus === channelId) {
      this.currentFocus = null;
    }
  }

  setFocus(channelId: ChannelId): void {
    if (!this.channelStates.has(channelId)) return;
    
    // Queue focus change to prevent oscillation
    new Promise<void>((resolve) => {
      this.focusQueue.push({ channelId, resolve });
      this.processFocusQueue();
    });
  }

  private async processFocusQueue(): Promise<void> {
    if (this.processingQueue) return;
    this.processingQueue = true;

    while (this.focusQueue.length > 0) {
      const { channelId, resolve } = this.focusQueue.shift()!;
      const previous = this.currentFocus;
      if (previous === channelId) {
        resolve();
        continue;
      }

      this.currentFocus = channelId;
      this.channelStates.set(channelId, 'focused');
      this.activityTimestamps.set(channelId, Date.now());
      this.notifyListeners({ channelId, previousChannelId: previous, timestamp: Date.now() });
      resolve();
    }

    this.processingQueue = false;
  }

  onActivity(channelId: ChannelId): void {
    this.activityTimestamps.set(channelId, Date.now());
    
    // Queue activity to prevent oscillation
    new Promise<void>((resolve) => {
      this.focusQueue.push({ channelId, resolve });
      this.processActivityQueue();
    });
  }

  private async processActivityQueue(): Promise<void> {
    if (this.processingQueue) return;
    this.processingQueue = true;

    while (this.focusQueue.length > 0) {
      const { channelId, resolve } = this.focusQueue.shift()!;
      
      if (this.channelStates.get(channelId) === 'focused') {
        resolve();
        continue;
      }

      const previous = this.currentFocus;
      this.currentFocus = channelId;
      this.channelStates.set(channelId, 'focused');
      this.notifyListeners({ channelId, previousChannelId: previous, timestamp: Date.now() });
      resolve();
    }

    this.processingQueue = false;
  }

  getFocus(): ChannelId | null {
    return this.currentFocus;
  }

  isFocused(channelId: ChannelId): boolean {
    return this.currentFocus === channelId;
  }

  getChannelState(channelId: ChannelId): FocusState {
    return this.channelStates.get(channelId) ?? 'away';
  }

  getActiveChannels(): ChannelId[] {
    return Array.from(this.channelStates.entries())
      .filter(([_, state]) => state !== 'away')
      .map(([id]) => id);
  }

  getAllChannels(): ChannelId[] {
    return Array.from(this.channelStates.keys());
  }

  hasActiveFocus(): boolean {
    const now = Date.now();
    if (!this.currentFocus) return false;
    const lastActivity = this.activityTimestamps.get(this.currentFocus) ?? 0;
    return (now - lastActivity) < FocusManager.ACTIVITY_TIMEOUT_MS;
  }

  onFocusChange(listener: FocusListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getChannelPriority(channelId: ChannelId): number {
    const state = this.channelStates.get(channelId);
    if (state === 'focused') return 3;
    if (state === 'background') return 1;
    return 0;
  }

  private notifyListeners(event: FocusChangeEvent): void {
    for (const listener of this.listeners) {
      try { listener(event); } catch (err) {
        getLogger().warn('FOCUS_MANAGER', `Focus listener threw: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
}
