import { describe, it, expect } from 'vitest';
import { isUrlSafeForFetch } from '../src/search/url-utils.js';

describe('isUrlSafeForFetch', () => {
  it('blocks loopback and metadata endpoints', () => {
    expect(isUrlSafeForFetch('http://127.0.0.1/')).toBe(false);
    expect(isUrlSafeForFetch('http://169.254.169.254/latest/meta-data/')).toBe(false);
    expect(isUrlSafeForFetch('file:///etc/passwd')).toBe(false);
  });

  it('allows public https URLs', () => {
    expect(isUrlSafeForFetch('https://example.com/path')).toBe(true);
  });
});
