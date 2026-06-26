import type { DeepSearchProgress, DeepSearchResultBundle } from '@agentx/shared/browser';
import { DeepSearchShell } from '../components/deep-search/DeepSearchShell';

export function DeepSearchMessageBlock({
  bundle,
  progress,
  running,
}: {
  bundle?: DeepSearchResultBundle | null;
  progress?: DeepSearchProgress;
  running?: boolean;
}) {
  return (
    <DeepSearchShell
      bundle={bundle}
      progress={progress}
      running={running}
    />
  );
}
