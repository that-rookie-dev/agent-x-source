import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SteerHandler } from '../../../src/adapter/SteerHandler';

describe('SteerHandler', () => {
  let handler: SteerHandler;

  beforeEach(() => {
    handler = new SteerHandler();
  });

  it('canSteer returns false when not processing', () => {
    handler.setIsProcessing(false);
    expect(handler.canSteer()).toBe(false);
  });

  it('canSteer returns true when processing without engine steer handler', () => {
    handler.setIsProcessing(true);
    expect(handler.canSteer()).toBe(true);
  });

  it('dispose does not throw', () => {
    expect(() => handler.dispose()).not.toThrow();
  });
});
