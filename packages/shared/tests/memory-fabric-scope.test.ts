import { describe, it, expect } from 'vitest';
import { CHANNEL_SESSION_ID } from '../src/utils/channel-session.js';
import {
  isMemoryFabricSuperSession,
  resolveMemoryFabricSearchSessionFilter,
  resolveMemoryFabricWriteSessionId,
} from '../src/utils/memory-fabric-scope.js';

describe('memory fabric session scope', () => {
  it('treats agent_x_core and channel sessions as super', () => {
    expect(isMemoryFabricSuperSession('sess-1', 'agent_x_core')).toBe(true);
    expect(isMemoryFabricSuperSession(CHANNEL_SESSION_ID, 'agent_x')).toBe(true);
  });

  it('scopes regular agent_x and crew_private sessions', () => {
    expect(isMemoryFabricSuperSession('sess-crew', 'crew_private')).toBe(false);
    expect(isMemoryFabricSuperSession('sess-ax', 'agent_x')).toBe(false);
  });

  it('writes global nodes only for super sessions', () => {
    expect(resolveMemoryFabricWriteSessionId('core', 'agent_x_core')).toBeUndefined();
    expect(resolveMemoryFabricWriteSessionId('crew-sess', 'crew_private')).toBe('crew-sess');
  });

  it('searches global bucket for super and session bucket otherwise', () => {
    expect(resolveMemoryFabricSearchSessionFilter('core', 'agent_x_core')).toBeNull();
    expect(resolveMemoryFabricSearchSessionFilter('crew-sess', 'crew_private')).toBe('crew-sess');
  });
});
