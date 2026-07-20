import { useEffect, useState, useCallback } from 'react';
import { voice } from '../api';

/**
 * Download progress for a single voice asset.
 */
export interface VoiceAssetDownloadState {
  assetId: string;
  status: 'not_started' | 'pending' | 'running' | 'verifying' | 'complete' | 'error' | 'cancelled';
  progress: number;
  detail?: string;
  downloadedMB?: number;
  totalMB?: number;
  error?: string;
}

/**
 * Global singleton store for voice asset download progress.
 *
 * Downloads continue in the backend even if the user navigates away from
 * the Voice tab. This store polls the backend for active downloads and
 * caches their progress so any component can observe it.
 *
 * The store is a module-level singleton — all components sharing the same
 * React app instance see the same state. Polling only runs while at least
 * one download is active.
 */
class VoiceAssetDownloadStore {
  private downloads = new Map<string, VoiceAssetDownloadState>();
  private listeners = new Set<() => void>();
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private polling = false;

  /** Start polling for a specific asset's download progress. Always resets state. */
  startPolling(assetId: string): void {
    this.downloads.set(assetId, { assetId, status: 'running', progress: 0 });
    this.ensurePolling();
    this.emit();
  }

  /** Get the current download state for an asset, if any. */
  getState(assetId: string): VoiceAssetDownloadState | undefined {
    return this.downloads.get(assetId);
  }

  /** Get all active download states. */
  getAllStates(): VoiceAssetDownloadState[] {
    return [...this.downloads.values()];
  }

  /** Subscribe to changes. Returns an unsubscribe function. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  /** Clear completed/errored downloads for an asset. */
  clear(assetId: string): void {
    this.downloads.delete(assetId);
    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }

  private ensurePolling(): void {
    if (this.pollTimer) return;
    this.pollTimer = setInterval(() => { void this.poll(); }, 1000);
  }

  private stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private async poll(): Promise<void> {
    if (this.polling) return;
    this.polling = true;
    try {
      const activeIds = [...this.downloads.keys()];
      if (activeIds.length === 0) {
        this.stopPolling();
        return;
      }
      let anyActive = false;
      await Promise.all(activeIds.map(async (assetId) => {
        try {
          const res = await voice.downloadStatus(assetId);
          const current = this.downloads.get(assetId);
          if (!current) return;
          this.downloads.set(assetId, {
            assetId,
            status: res.status as VoiceAssetDownloadState['status'],
            progress: res.progress ?? 0,
            detail: res.detail,
            downloadedMB: res.downloadedMB,
            totalMB: res.totalMB,
            error: res.error,
          });
          if (res.status !== 'complete' && res.status !== 'error' && res.status !== 'cancelled') {
            anyActive = true;
          } else {
            // Schedule auto-clear of terminal states after 5 seconds
            // so the UI doesn't show "Done"/error forever
            setTimeout(() => { this.clear(assetId); }, 5000);
          }
        } catch {
          // Network error — keep the last known state, assume still active
          anyActive = true;
        }
      }));
      if (!anyActive) {
        this.stopPolling();
      }
      this.emit();
    } finally {
      this.polling = false;
    }
  }
}

const globalStore = new VoiceAssetDownloadStore();

/**
 * React hook to observe voice asset download progress.
 *
 * The download itself runs in the backend (fire-and-forget). This hook
 * polls the backend for progress and returns the current state. Because
 * the store is a module-level singleton, navigating away from the page
 * and back will show the correct in-progress download state.
 */
export function useVoiceAssetDownload(assetId: string | null): VoiceAssetDownloadState | undefined {
  const [, setTick] = useState(0);
  const rerender = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (!assetId) return;
    const unsub = globalStore.subscribe(rerender);
    return unsub;
  }, [assetId, rerender]);

  return assetId ? globalStore.getState(assetId) : undefined;
}

/**
 * React hook to observe all voice asset downloads.
 */
export function useAllVoiceAssetDownloads(): VoiceAssetDownloadState[] {
  const [, setTick] = useState(0);
  const rerender = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    const unsub = globalStore.subscribe(rerender);
    return unsub;
  }, [rerender]);

  return globalStore.getAllStates();
}

/**
 * Initiate a download for a voice asset and start polling for progress.
 * The download runs in the backend and continues even if the user
 * navigates away from the current page.
 */
export async function startVoiceAssetDownload(assetId: string): Promise<void> {
  globalStore.startPolling(assetId);
  try {
    await voice.downloadAsset(assetId);
  } catch (err) {
    // The download endpoint returns immediately — if it errors, update state
    globalStore.clear(assetId);
    throw err;
  }
}

/**
 * Check if any TTS asset download is currently active.
 */
export function isAnyVoiceAssetDownloading(): boolean {
  return globalStore.getAllStates().some(
    (d) => d.status === 'running' || d.status === 'pending' || d.status === 'verifying',
  );
}
