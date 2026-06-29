import { useEffect, useState } from 'react';

export interface SystemCapabilities {
  totalMemoryGB: number;
  localModelSupported: boolean;
}

export function useSystemCapabilities(): SystemCapabilities | null {
  const [caps, setCaps] = useState<SystemCapabilities | null>(() => {
    if (typeof window !== 'undefined' && window.agentx?.localModelSupported !== undefined) {
      return {
        totalMemoryGB: window.agentx.totalMemoryGB ?? 0,
        localModelSupported: window.agentx.localModelSupported,
      };
    }
    return null;
  });

  useEffect(() => {
    if (caps !== null) return;

    fetch('/api/system/capabilities')
      .then((r) => r.json())
      .then((data) => {
        setCaps({
          totalMemoryGB: typeof data.totalMemoryGB === 'number' ? data.totalMemoryGB : 0,
          localModelSupported: data.localModelSupported === true,
        });
      })
      .catch(() => {
        // Fail open: assume local model is supported if we can't detect it.
        setCaps({ totalMemoryGB: 0, localModelSupported: true });
      });
  }, [caps]);

  return caps;
}

export function useLocalModelSupported(): boolean {
  const caps = useSystemCapabilities();
  return caps?.localModelSupported ?? true;
}
