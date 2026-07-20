import { describe, expect, it } from 'vitest';
import {
  CHANNEL_COVERED_MCP_INTEGRATION_IDS,
  detectChannelHandoffIntent,
  isBareContinueIntent,
  isChannelCoveredMcpIntegration,
} from '../src/utils/channel-integration-overlap.js';

describe('channel-integration-overlap', () => {
  it('flags channel-covered MCP integrations', () => {
    expect(CHANNEL_COVERED_MCP_INTEGRATION_IDS).toEqual(['telegram', 'slack', 'discord']);
    expect(isChannelCoveredMcpIntegration('telegram')).toBe(true);
    expect(isChannelCoveredMcpIntegration('gmail')).toBe(false);
  });

  it('detects channel handoff phrasing', () => {
    expect(detectChannelHandoffIntent("let's continue this conversation on telegram")).toEqual({ channel: 'telegram' });
    expect(detectChannelHandoffIntent('switch to slack please')).toEqual({ channel: 'slack' });
    expect(detectChannelHandoffIntent('plan my trip')).toBeNull();
  });

  it('detects bare continue intent', () => {
    expect(isBareContinueIntent('continue')).toBe(true);
    expect(isBareContinueIntent('conitnue')).toBe(true);
    expect(isBareContinueIntent('Try now')).toBe(true);
    expect(isBareContinueIntent('try again')).toBe(true);
    expect(isBareContinueIntent('retry')).toBe(true);
    expect(isBareContinueIntent('can you try now')).toBe(true);
    expect(isBareContinueIntent('please try again')).toBe(true);
    expect(isBareContinueIntent('could you retry now')).toBe(true);
    expect(isBareContinueIntent('continue on telegram')).toBe(false);
    expect(isBareContinueIntent('Plan my trip to Japan')).toBe(false);
  });
});
