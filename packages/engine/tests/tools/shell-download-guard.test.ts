import { describe, it, expect } from 'vitest';
import { isBlockedDownloadCommand } from '../../src/tools/shell-security.js';

describe('isBlockedDownloadCommand', () => {
  it('blocks wget with any URL', () => {
    const r = isBlockedDownloadCommand('wget https://example.com/file.zip');
    expect(r.blocked).toBe(true);
  });

  it('blocks curl with -o output', () => {
    const r = isBlockedDownloadCommand('curl -o model.litertlm https://huggingface.co/x/model.litertlm');
    expect(r.blocked).toBe(true);
  });

  it('blocks curl with shell redirect', () => {
    const r = isBlockedDownloadCommand('curl -L https://example.com/file.tar.gz > file.tar.gz');
    expect(r.blocked).toBe(true);
  });

  it('blocks curl for binary file URL', () => {
    const r = isBlockedDownloadCommand('curl https://example.com/model.gguf');
    expect(r.blocked).toBe(true);
  });

  it('allows curl to localhost health endpoint without output', () => {
    const r = isBlockedDownloadCommand('curl -s http://localhost:8080/actuator/health');
    expect(r.blocked).toBe(false);
  });

  it('allows curl --version', () => {
    const r = isBlockedDownloadCommand('curl --version');
    expect(r.blocked).toBe(false);
  });

  it('blocks aria2c', () => {
    const r = isBlockedDownloadCommand('aria2c https://example.com/file.zip');
    expect(r.blocked).toBe(true);
  });

  it('blocks python inline download', () => {
    const r = isBlockedDownloadCommand("python3 -c \"import urllib.request; urllib.request.urlretrieve('https://example.com/x.zip', 'x.zip')\"");
    expect(r.blocked).toBe(true);
  });

  it('allows non-download commands', () => {
    const r = isBlockedDownloadCommand('ls -la');
    expect(r.blocked).toBe(false);
  });

  it('blocks git lfs pull', () => {
    const r = isBlockedDownloadCommand('git lfs pull');
    expect(r.blocked).toBe(true);
  });
});
