import type { DeepSearchProgress, DeepSearchResultBundle } from '@agentx/shared/browser';
import type { InlineToolData } from '../InlineToolCall';
import { DeepSearchShell } from './DeepSearchShell';

function parseProgress(tool: InlineToolData): DeepSearchProgress | undefined {
  const fromMeta = tool.metadata?.deepSearchProgress;
  if (fromMeta && typeof fromMeta === 'object') return fromMeta as DeepSearchProgress;

  const stream = tool.streamOutput ?? '';
  const lines = stream.split('\n').filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const parsed = JSON.parse(lines[i]!) as { deepSearchProgress?: DeepSearchProgress };
      if (parsed.deepSearchProgress) return parsed.deepSearchProgress;
    } catch { /* skip */ }
  }
  return undefined;
}

export function getDeepSearchBundle(tool: InlineToolData): DeepSearchResultBundle | null {
  const fromMeta = tool.metadata?.deepSearch;
  if (fromMeta && typeof fromMeta === 'object' && 'results' in (fromMeta as object)) {
    return fromMeta as DeepSearchResultBundle;
  }
  return null;
}

export function DeepSearchRender({ tool }: { tool: InlineToolData }) {
  const bundle = getDeepSearchBundle(tool);
  const progress = parseProgress(tool);
  const running = tool.status === 'running';

  return (
    <DeepSearchShell bundle={bundle} running={running} progress={progress} />
  );
}
