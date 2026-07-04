import { describe, expect, it } from 'vitest';
import { convertToJsonSchema, normalizeJsonSchemaNode } from '../src/agent/AiSdkBridge.js';

describe('normalizeJsonSchemaNode', () => {
  it('adds string items for header arrays', () => {
    const out = normalizeJsonSchemaNode(
      { type: 'array', description: 'Column headers' },
      'headers',
    );
    expect(out.items).toEqual({ type: 'string' });
  });

  it('adds nested array items for row arrays', () => {
    const out = normalizeJsonSchemaNode(
      { type: 'array', description: 'Row arrays' },
      'rows',
    );
    expect(out.items).toEqual({ type: 'array', items: { type: 'string' } });
  });

  it('adds object items for slide arrays', () => {
    const out = normalizeJsonSchemaNode(
      { type: 'array', description: 'Array of {title, content}' },
      'slides',
    );
    expect(out.items).toEqual({
      type: 'object',
      properties: { title: { type: 'string' }, content: { type: 'string' } },
    });
  });
});

describe('convertToJsonSchema', () => {
  it('normalizes tool schemas missing array items', () => {
    const schema = convertToJsonSchema({
      type: 'object',
      properties: {
        headers: { type: 'array', description: 'Column headers' },
        rows: { type: 'array', description: 'Row arrays' },
        slides: { type: 'array', description: 'Array of {title, content}' },
        datasets: { type: 'array', description: 'Array of {label, data, color} objects' },
        todos: { type: 'array', description: 'Array of {id?, content, status?}' },
        amenities: { type: 'array', description: 'Amenity names' },
      },
      required: ['headers', 'rows'],
    });

    const props = schema.properties as Record<string, Record<string, unknown>>;
    expect(props.headers?.items).toEqual({ type: 'string' });
    expect(props.rows?.items).toEqual({ type: 'array', items: { type: 'string' } });
    expect(props.slides?.items).toBeTruthy();
    expect(props.datasets?.items).toBeTruthy();
    expect(props.todos?.items).toBeTruthy();
    expect(props.amenities?.items).toEqual({ type: 'string' });
  });

  it('preserves schemas that already define array items', () => {
    const schema = convertToJsonSchema({
      type: 'object',
      properties: {
        paths: {
          type: 'array',
          items: { type: 'string', description: 'A file path' },
        },
      },
      required: ['paths'],
    });

    const props = schema.properties as Record<string, Record<string, unknown>>;
    expect(props.paths?.items).toEqual({ type: 'string', description: 'A file path' });
  });
});
