import { describe, it, expect } from 'vitest';
import { CommandParser } from '../src/commands/CommandParser.js';

describe('CommandParser', () => {
  const parser = new CommandParser();

  describe('parse', () => {
    it('parses slash commands', () => {
      const result = parser.parse('/help');
      expect(result.type).toBe('command');
      expect(result.command).toBe('help');
      expect(result.args).toEqual([]);
    });

    it('parses commands with args', () => {
      const result = parser.parse('/model switch gpt-4o');
      expect(result.type).toBe('command');
      expect(result.command).toBe('model');
      expect(result.args).toEqual(['switch', 'gpt-4o']);
    });

    it('parses regular conversation input', () => {
      const result = parser.parse('hello world');
      expect(result.type).toBe('conversation');
      expect(result.raw).toBe('hello world');
      expect(result.command).toBeUndefined();
    });

    it('trims whitespace', () => {
      const result = parser.parse('  /version  ');
      expect(result.type).toBe('command');
      expect(result.command).toBe('version');
    });
  });

  describe('isCommand', () => {
    it('returns true for slash commands', () => {
      expect(parser.isCommand('/help')).toBe(true);
      expect(parser.isCommand('/model switch')).toBe(true);
    });

    it('returns false for regular text', () => {
      expect(parser.isCommand('hello')).toBe(false);
      expect(parser.isCommand('not a /command')).toBe(false);
    });

    it('handles whitespace', () => {
      expect(parser.isCommand('  /help')).toBe(true);
    });
  });

  describe('extractPrefix', () => {
    it('extracts command name', () => {
      expect(parser.extractPrefix('/help')).toBe('help');
      expect(parser.extractPrefix('/model switch')).toBe('model');
    });

    it('returns empty for non-commands', () => {
      expect(parser.extractPrefix('hello')).toBe('');
    });
  });
});
