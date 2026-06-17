import type { PermissionRule } from '@agentx/shared';

export function evaluateRules(
  action: string,
  resource: string,
  ...rulesets: PermissionRule[][]
): 'allow' | 'deny' | 'ask' {
  const allRules: PermissionRule[] = [];
  for (const ruleset of rulesets) {
    allRules.push(...ruleset);
  }

  let result: 'allow' | 'deny' | 'ask' = 'ask';

  for (const rule of allRules) {
    if (matchesRule(rule, action, resource)) {
      result = rule.effect;
    }
  }

  return result;
}

function matchesRule(rule: PermissionRule, action: string, resource: string): boolean {
  const actionPattern = rule.action.replace(/\*/g, '.*');
  if (!new RegExp(`^${actionPattern}$`).test(action)) return false;

  const resourcePattern = rule.pattern.replace(/\*/g, '.*');
  if (!new RegExp(`^${resourcePattern}$`).test(resource)) return false;

  return true;
}
