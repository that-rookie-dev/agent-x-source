import { describe, it, expect } from 'vitest';
import { TokenTracker } from '../src/session/TokenTracker.js';

describe('TokenTracker', () => {
  it('initializes with correct context window', () => {
    const tracker = new TokenTracker(128000);
    expect(tracker.tokensTotal).toBe(128000);
    expect(tracker.tokensUsed).toBe(0);
    expect(tracker.tokensRemaining).toBe(128000);
  });

  it('tracks usage correctly', () => {
    const tracker = new TokenTracker(1000);
    tracker.addUsage(200);
    expect(tracker.tokensUsed).toBe(200);
    expect(tracker.tokensRemaining).toBe(800);

    tracker.addUsage(300);
    expect(tracker.tokensUsed).toBe(500);
    expect(tracker.tokensRemaining).toBe(500);
  });

  it('calculates percentage', () => {
    const tracker = new TokenTracker(1000);
    tracker.addUsage(500);
    expect(tracker.percentage).toBe(0.5);
  });

  it('detects near limit', () => {
    const tracker = new TokenTracker(1000);
    tracker.addUsage(600);
    expect(tracker.isNearLimit).toBe(false);

    tracker.addUsage(100);
    expect(tracker.isNearLimit).toBe(true); // 70%
  });

  it('detects at limit', () => {
    const tracker = new TokenTracker(1000);
    tracker.addUsage(950);
    expect(tracker.isAtLimit).toBe(true); // 95%
  });

  it('remaining never goes below 0', () => {
    const tracker = new TokenTracker(100);
    tracker.addUsage(200);
    expect(tracker.tokensRemaining).toBe(0);
  });

  it('resets correctly', () => {
    const tracker = new TokenTracker(1000);
    tracker.addUsage(500);
    tracker.reset();
    expect(tracker.tokensUsed).toBe(0);
  });

  it('setUsed/setTotal work', () => {
    const tracker = new TokenTracker(1000);
    tracker.setUsed(400);
    expect(tracker.tokensUsed).toBe(400);
    tracker.setTotal(2000);
    expect(tracker.tokensTotal).toBe(2000);
  });
});
