import { useEffect, useState } from 'react';
import {
  isVoiceWarmupSupported,
  resolveNeuralCortexEmbeddingTier,
} from '@agentx/shared/browser';
import { cachedApiCall } from '../perf/api-cache';

interface SystemCapabilitiesResponse {
  totalMemoryGB?: number;
  localModelSupported?: boolean;
  neuralCortexEmbeddingTier?: 'bge-m3' | 'minilm';
  cortexReady?: boolean;
  cortexDegraded?: boolean;
  voiceWarmupSupported?: boolean;
}

export interface SystemCapabilities {
  totalMemoryGB: number;
  localModelSupported: boolean;
  neuralCortexEmbeddingTier: 'bge-m3' | 'minilm';
  cortexReady: boolean;
  cortexDegraded: boolean;
  voiceWarmupSupported: boolean;
}

function buildCapsFromMemory(totalMemoryGB: number, data?: SystemCapabilitiesResponse): SystemCapabilities {
  const tier = data?.neuralCortexEmbeddingTier ?? resolveNeuralCortexEmbeddingTier(totalMemoryGB);
  const cortexReady = typeof data?.cortexReady === 'boolean'
    ? data.cortexReady
    : tier === 'bge-m3';
  const cortexDegraded = typeof data?.cortexDegraded === 'boolean'
    ? data.cortexDegraded
    : tier === 'minilm';
  return {
    totalMemoryGB,
    localModelSupported: data?.localModelSupported === true,
    neuralCortexEmbeddingTier: tier,
    cortexReady,
    cortexDegraded,
    voiceWarmupSupported: typeof data?.voiceWarmupSupported === 'boolean'
      ? data.voiceWarmupSupported
      : isVoiceWarmupSupported(totalMemoryGB),
  };
}

export function useSystemCapabilities(): SystemCapabilities | null {
  const [caps, setCaps] = useState<SystemCapabilities | null>(() => {
    if (typeof window !== 'undefined' && window.agentx?.localModelSupported !== undefined) {
      const totalMemoryGB = window.agentx.totalMemoryGB ?? 0;
      return buildCapsFromMemory(totalMemoryGB, {
        localModelSupported: window.agentx.localModelSupported,
        cortexReady: window.agentx.cortexReady,
        cortexDegraded: window.agentx.cortexDegraded,
      });
    }
    return null;
  });

  useEffect(() => {
    if (caps !== null) return;

    cachedApiCall('system-capabilities', () => fetch('/api/system/capabilities').then((r) => r.json() as Promise<SystemCapabilitiesResponse>), 60_000)
      .then((data) => {
        const totalMemoryGB = typeof data.totalMemoryGB === 'number' ? data.totalMemoryGB : 0;
        setCaps(buildCapsFromMemory(totalMemoryGB, data));
      })
      .catch(() => {
        setCaps({
          totalMemoryGB: 0,
          localModelSupported: false,
          neuralCortexEmbeddingTier: 'minilm',
          cortexReady: false,
          cortexDegraded: true,
          voiceWarmupSupported: false,
        });
      });
  }, [caps]);

  return caps;
}

export function useLocalModelSupported(): boolean {
  const caps = useSystemCapabilities();
  return caps?.localModelSupported ?? (window.agentx?.localModelSupported ?? false);
}

/** True once capabilities are known (desktop preload or API fetch completed). */
export function useCapabilitiesReady(): boolean {
  const caps = useSystemCapabilities();
  if (typeof window !== 'undefined' && window.agentx?.localModelSupported !== undefined) return true;
  return caps !== null;
}

export function useCortexReady(): boolean {
  const caps = useSystemCapabilities();
  if (typeof window !== 'undefined' && window.agentx?.cortexReady !== undefined) {
    return window.agentx.cortexReady;
  }
  return caps?.cortexReady ?? false;
}

export function useVoiceWarmupSupported(): boolean {
  const caps = useSystemCapabilities();
  return caps?.voiceWarmupSupported ?? (window.agentx?.voiceWarmupSupported ?? false);
}
