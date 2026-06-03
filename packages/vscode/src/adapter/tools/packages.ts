import type { ToolkitRefs, AdapterContext, AdapterCategoryResult } from './types';

export function adaptPackageManagers(
  _refs: ToolkitRefs,
  _ctx: AdapterContext,
): AdapterCategoryResult {
  return {
    overridden: [],
    keptAsIs: [
      'package_install', 'package_remove', 'package_list', 'package_outdated',
      'package_run', 'pkg_update', 'pkg_audit', 'pkg_search',
    ],
    disabled: [],
  };
}
