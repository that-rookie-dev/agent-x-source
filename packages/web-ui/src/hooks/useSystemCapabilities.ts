import { useEffect, useState } from 'react';
import {
  isNeuralBrainSupported,
  isVoiceWarmupSupported,
} from '@agentx/shared/browser';
import { cachedApiCall } from '../perf/api-cache';

interface SystemCapabilitiesResponse {
  totalMemoryGB?: number;
  localModelSupported?: boolean;
  neuralBrainSupported?: boolean;
  voiceWarmupSupported?: boolean;
}

export interface SystemCapabilities {
  totalMemoryGB: number;
  localModelSupported: boolean;
  neuralBrainSupported: boolean;
  voiceWarmupSupported: boolean;
}

export function useSystemCapabilities(): SystemCapabilities | null {
  const [caps, setCaps] = useState<SystemCapabilities | null>(() => {
    if (typeof window !== 'undefined' && window.agentx?.localModelSupported !== undefined) {
      const totalMemoryGB = window.agentx.totalMemoryGB ?? 0;
      return {
        totalMemoryGB,
        localModelSupported: window.agentx.localModelSupported,
        neuralBrainSupported: window.agentx.neuralBrainSupported ?? isNeuralBrainSupported(totalMemoryGB),
        voiceWarmupSupported: window.agentx.voiceWarmupSupported ?? isVoiceWarmupSupported(totalMemoryGB),
      };
    }
    return null;
  });

  useEffect(() => {
    if (caps !== null) return;

    cachedApiCall('system-capabilities', () => fetch('/api/system/capabilities').then((r) => r.json() as Promise<SystemCapabilitiesResponse>), 60_000)
      .then((data) => {
        const totalMemoryGB = typeof data.totalMemoryGB === 'number' ? data.totalMemoryGB : 0;
        setCaps({
          totalMemoryGB,
          localModelSupported: data.localModelSupported === true,
          neuralBrainSupported: typeof data.neuralBrainSupported === 'boolean'
            ? data.neuralBrainSupported
            : isNeuralBrainSupported(totalMemoryGB),
          voiceWarmupSupported: typeof data.voiceWarmupSupported === 'boolean'
            ? data.voiceWarmupSupported
            : isVoiceWarmupSupported(totalMemoryGB),
        });
      })
      .catch(() => {
        setCaps({
          totalMemoryGB: 0,
          localModelSupported: false,
          neuralBrainSupported: false,
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

export function useNeuralBrainSupported(): boolean {
  const caps = useSystemCapabilities();
  if (typeof window !== 'undefined' && window.agentx?.neuralBrainSupported !== undefined) {
    return window.agentx.neuralBrainSupported;
  }
  return caps?.neuralBrainSupported ?? false;
}

export function useVoiceWarmupSupported(): boolean {
  const caps = useSystemCapabilities();
  return caps?.voiceWarmupSupported ?? (window.agentx?.voiceWarmupSupported ?? false);
}
