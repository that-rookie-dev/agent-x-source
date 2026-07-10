import { describe, it, expect } from 'vitest';
import { getConfigDir, getDataDir, getCacheDir } from '../src/utils/paths.js';
import { join } from 'node:path';
import { homedir } from 'node:os';

const HOME = homedir();

describe('getConfigDir', () => {
  it('uses XDG_CONFIG_HOME when set', () => {
    const prev = process.env['XDG_CONFIG_HOME'];
    process.env['XDG_CONFIG_HOME'] = '/tmp/test-config';
    expect(getConfigDir()).toBe(join('/tmp/test-config', 'agentx'));
    if (prev) process.env['XDG_CONFIG_HOME'] = prev;
    else delete process.env['XDG_CONFIG_HOME'];
  });

  it('defaults to ~/.config/agentx', () => {
    const prev = process.env['XDG_CONFIG_HOME'];
    delete process.env['XDG_CONFIG_HOME'];
    expect(getConfigDir()).toBe(join(HOME, '.config', 'agentx'));
    if (prev) process.env['XDG_CONFIG_HOME'] = prev;
  });
});

describe('getDataDir', () => {
  it('prefers AGENTX_DATA_DIR when set', () => {
    const prevAgentx = process.env['AGENTX_DATA_DIR'];
    const prevXdg = process.env['XDG_DATA_HOME'];
    process.env['AGENTX_DATA_DIR'] = '/tmp/agentx-explicit';
    process.env['XDG_DATA_HOME'] = '/tmp/test-data';
    expect(getDataDir()).toBe('/tmp/agentx-explicit');
    if (prevAgentx) process.env['AGENTX_DATA_DIR'] = prevAgentx;
    else delete process.env['AGENTX_DATA_DIR'];
    if (prevXdg) process.env['XDG_DATA_HOME'] = prevXdg;
    else delete process.env['XDG_DATA_HOME'];
  });

  it('uses XDG_DATA_HOME when set', () => {
    const prevAgentx = process.env['AGENTX_DATA_DIR'];
    const prev = process.env['XDG_DATA_HOME'];
    delete process.env['AGENTX_DATA_DIR'];
    process.env['XDG_DATA_HOME'] = '/tmp/test-data';
    expect(getDataDir()).toBe(join('/tmp/test-data', 'agentx'));
    if (prevAgentx) process.env['AGENTX_DATA_DIR'] = prevAgentx;
    if (prev) process.env['XDG_DATA_HOME'] = prev;
    else delete process.env['XDG_DATA_HOME'];
  });

  it('defaults to ~/.local/share/agentx', () => {
    const prevAgentx = process.env['AGENTX_DATA_DIR'];
    const prev = process.env['XDG_DATA_HOME'];
    delete process.env['AGENTX_DATA_DIR'];
    delete process.env['XDG_DATA_HOME'];
    expect(getDataDir()).toBe(join(HOME, '.local', 'share', 'agentx'));
    if (prevAgentx) process.env['AGENTX_DATA_DIR'] = prevAgentx;
    if (prev) process.env['XDG_DATA_HOME'] = prev;
  });
});

describe('getCacheDir', () => {
  it('uses XDG_CACHE_HOME when set', () => {
    const prev = process.env['XDG_CACHE_HOME'];
    process.env['XDG_CACHE_HOME'] = '/tmp/test-cache';
    expect(getCacheDir()).toBe(join('/tmp/test-cache', 'agentx'));
    if (prev) process.env['XDG_CACHE_HOME'] = prev;
    else delete process.env['XDG_CACHE_HOME'];
  });

  it('defaults to ~/.cache/agentx', () => {
    const prev = process.env['XDG_CACHE_HOME'];
    delete process.env['XDG_CACHE_HOME'];
    expect(getCacheDir()).toBe(join(HOME, '.cache', 'agentx'));
    if (prev) process.env['XDG_CACHE_HOME'] = prev;
  });
});
