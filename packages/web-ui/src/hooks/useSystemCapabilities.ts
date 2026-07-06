import { useEffect, useState } from 'react';
import { isNeuralBrainSupported, isStyleTtsSupported } from '@agentx/shared/browser';

export interface SystemCapabilities {
  totalMemoryGB: number;
  localModelSupported: boolean;
  neuralBrainSupported: boolean;
  styleTtsSupported: boolean;
}

export function useSystemCapabilities(): SystemCapabilities | null {
  const [caps, setCaps] = useState<SystemCapabilities | null>(() => {
    if (typeof window !== 'undefined' && window.agentx?.localModelSupported !== undefined) {
      const totalMemoryGB = window.agentx.totalMemoryGB ?? 0;
      return {
        totalMemoryGB,
        localModelSupported: window.agentx.localModelSupported,
        neuralBrainSupported: window.agentx.neuralBrainSupported ?? isNeuralBrainSupported(totalMemoryGB),
        styleTtsSupported: window.agentx.styleTtsSupported ?? isStyleTtsSupported(totalMemoryGB),
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
          styleTtsSupported: typeof data.styleTtsSupported === 'boolean'
            ? data.styleTtsSupported
            : isStyleTtsSupported(totalMemoryGB),
        });
      })
      .catch(() => {
        setCaps({ totalMemoryGB: 0, localModelSupported: false, neuralBrainSupported: false, styleTtsSupported: false });
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

export function useStyleTtsSupported(): boolean {
  const caps = useSystemCapabilities();
  return caps?.styleTtsSupported ?? (window.agentx?.styleTtsSupported ?? false);
}
