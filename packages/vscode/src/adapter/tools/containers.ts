import type { ToolkitRefs, AdapterContext, AdapterCategoryResult } from './types';

export function adaptContainersInfra(
  _refs: ToolkitRefs,
  _ctx: AdapterContext,
): AdapterCategoryResult {
  return {
    overridden: [],
    keptAsIs: [
      'container_list', 'container_logs', 'container_start', 'container_stop',
      'container_exec', 'container_run', 'container_compose', 'container_images', 'docker_build',
    ],
    disabled: [],
  };
}
