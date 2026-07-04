import { useEffect, useState } from 'react';
import { isNeuralBrainSupported } from '@agentx/shared/browser';

export interface SystemCapabilities {
  totalMemoryGB: number;
  localModelSupported: boolean;
  neuralBrainSupported: boolean;
}

export function useSystemCapabilities(): SystemCapabilities | null {
  const [caps, setCaps] = useState<SystemCapabilities | null>(() => {
    if (typeof window !== 'undefined' && window.agentx?.localModelSupported !== undefined) {
      const totalMemoryGB = window.agentx.totalMemoryGB ?? 0;
      return {
        totalMemoryGB,
        localModelSupported: window.agentx.localModelSupported,
        neuralBrainSupported: window.agentx.neuralBrainSupported ?? isNeuralBrainSupported(totalMemoryGB),
      };
    }
    return null;
  });

  useEffect(() => {
    if (caps !== null) return;

    fetch('/api/system/capabilities')
      .then((r) => r.json())
      .then((data) => {
        const totalMemoryGB = typeof data.totalMemoryGB === 'number' ? data.totalMemoryGB : 0;
        setCaps({
          totalMemoryGB,
          localModelSupported: data.localModelSupported === true,
          neuralBrainSupported: typeof data.neuralBrainSupported === 'boolean'
            ? data.neuralBrainSupported
            : isNeuralBrainSupported(totalMemoryGB),
        });
      })
      .catch(() => {
        setCaps({ totalMemoryGB: 0, localModelSupported: true, neuralBrainSupported: true });
      });
  }, [caps]);

  return caps;
}

export function useLocalModelSupported(): boolean {
  const caps = useSystemCapabilities();
  return caps?.localModelSupported ?? true;
}

export function useNeuralBrainSupported(): boolean {
  const caps = useSystemCapabilities();
  return caps?.neuralBrainSupported ?? true;
}
