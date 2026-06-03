import type { ToolkitRefs, AdapterContext, AdapterCategoryResult } from './types';

export function adaptGithub(
  _refs: ToolkitRefs,
  _ctx: AdapterContext,
): AdapterCategoryResult {
  return {
    overridden: [],
    keptAsIs: [
      'gh_issue_list', 'gh_issue_create', 'gh_pr_list', 'gh_pr_create',
      'gh_pr_view', 'gh_repo_view', 'gh_workflow_list', 'gh_release', 'gh_pr_review',
    ],
    disabled: [],
  };
}
