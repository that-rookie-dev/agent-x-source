import { describe, expect, it } from 'vitest';
import {
  blockCredentialScavenger,
  blockThirdPartyLocalSubstitute,
  isCredentialScavengerAttempt,
} from '../src/integrations/third-party-access-guard.js';
import type { ThirdPartyTurnPolicy } from '../src/integrations/third-party-access.js';

describe('third-party-access-guard', () => {
  const policy: ThirdPartyTurnPolicy = {
    blockLocalExploration: true,
    reason: 'Gmail requires MCP',
    providerIds: ['gmail'],
    hintKind: 'required',
  };

  it('blocks local substitute tools when third-party policy is active', () => {
    const blocked = blockThirdPartyLocalSubstitute('shell_exec', policy);
    expect(blocked?.error).toBe('THIRD_PARTY_ACCESS_DENIED');
  });

  it('allows integration and public web tools when policy is active', () => {
    expect(blockThirdPartyLocalSubstitute('integration__gmail__search', policy)).toBeNull();
    expect(blockThirdPartyLocalSubstitute('web_search', policy)).toBeNull();
  });

  it('detects credential scavenger shell commands', () => {
    expect(isCredentialScavengerAttempt('shell_exec', {
      command: 'find ~/Library/Application\\ Support -name "*mcp*" 2>/dev/null',
    })).toBe(true);
    expect(isCredentialScavengerAttempt('shell_exec', {
      command: 'gcloud auth print-access-token',
    })).toBe(true);
    expect(isCredentialScavengerAttempt('shell_exec', {
      command: 'npm test',
    })).toBe(false);
  });

  it('always blocks credential scavenger attempts', () => {
    const blocked = blockCredentialScavenger('bash', {
      command: 'cat ~/.config/gcloud/application_default_credentials.json',
    });
    expect(blocked?.error).toBe('CREDENTIAL_SCAVENGER_BLOCKED');
  });
});
