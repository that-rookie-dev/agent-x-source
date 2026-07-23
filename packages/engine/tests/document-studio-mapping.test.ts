import { describe, it, expect } from 'vitest';
import { validateMapping } from '../src/document-studio/binders/MappingStore.js';
import type { Mapping, Master, Variable } from '../src/document-studio/types.js';

function baseMaster(overrides: Partial<Master> & { analysis: Master['analysis'] }): Master {
  return {
    id: 'm1',
    name: 'test',
    kind: 'data',
    format: 'csv',
    mimeType: 'text/csv',
    storageId: 's1',
    checksum: 'c',
    version: 1,
    analysis: overrides.analysis,
    tags: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as Master;
}

function makeDataMaster(
  columns: { name: string; datatype: 'string' | 'number' | 'date' | 'boolean' | 'unknown'; nullable: boolean }[],
  sampleRows: Record<string, unknown>[],
): Master {
  return baseMaster({
    id: 'data-1',
    name: 'data.csv',
    kind: 'data',
    format: 'csv',
    analysis: {
      kind: 'data',
      documentType: 'dataset',
      summary: 'test data',
      confidence: 1,
      warnings: [],
      dataProfile: { columns, rowCount: sampleRows.length, sampleRows },
    },
  });
}

function makeLayoutMaster(variables: Variable[]): Master {
  return baseMaster({
    id: 'layout-1',
    name: 'template',
    kind: 'layout',
    format: 'docx',
    analysis: {
      kind: 'layout',
      documentType: 'form',
      summary: 'template',
      confidence: 1,
      warnings: [],
      layout: { sections: [], tables: [], chrome: [] },
      variables,
    },
  });
}

function makeMapping(entries: { column: string; variableKey: string }[]): Mapping {
  return {
    id: 'map-1',
    dataMasterId: 'data-1',
    schemaRef: 'layout-1',
    entries: entries.map((e) => ({ ...e, confidence: 1 })),
    confirmed: false,
    version: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function v(key: string, datatype: Variable['datatype'], required = false): Variable {
  return {
    key,
    label: key.replace(/_/g, ' '),
    datatype,
    required,
    askPolicy: 'from_dataset',
    locator: { type: 'placeholder', token: `{{${key}}}` },
    sensitivity: 'none',
  };
}

describe('validateMapping', () => {
  it('returns a coercion preview row for each entry', () => {
    const data = makeDataMaster([{ name: 'name', datatype: 'string', nullable: false }], [{ name: 'Alice' }]);
    const layout = makeLayoutMaster([v('name', 'string', true)]);
    const mapping = makeMapping([{ column: 'name', variableKey: 'name' }]);

    const result = validateMapping(mapping, data, layout);

    expect(result.coercionPreview).toHaveLength(1);
    expect(result.coercionPreview[0]).toMatchObject({
      column: 'name',
      variableKey: 'name',
      fromType: 'string',
      toType: 'string',
      sample: 'Alice',
    });
    expect(result.coercionPreview[0]!.error).toBeUndefined();
    expect(result.warnings).toEqual([]);
  });

  it('warns on duplicate variable keys and missing required variables', () => {
    const data = makeDataMaster(
      [
        { name: 'first', datatype: 'string', nullable: false },
        { name: 'first_dup', datatype: 'string', nullable: false },
      ],
      [{ first: 'A', first_dup: 'B' }],
    );
    const layout = makeLayoutMaster([v('first_name', 'string', true), v('last_name', 'string', true)]);
    const mapping = makeMapping([
      { column: 'first', variableKey: 'first_name' },
      { column: 'first_dup', variableKey: 'first_name' },
    ]);

    const result = validateMapping(mapping, data, layout);

    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Duplicate mapping for variable 'first_name'"),
        expect.stringContaining("Required variable 'last_name'"),
      ]),
    );
  });

  it('flags numeric string vs boolean as a type mismatch', () => {
    const data = makeDataMaster([{ name: 'is_active', datatype: 'string', nullable: false }], [{ is_active: '123' }]);
    const layout = makeLayoutMaster([v('is_active', 'boolean')]);
    const mapping = makeMapping([{ column: 'is_active', variableKey: 'is_active' }]);

    const result = validateMapping(mapping, data, layout);

    expect(result.coercionPreview[0]!.error).toBe('Numeric string cannot be coerced to boolean');
    expect(result.warnings.some((w) => w.includes('Numeric string cannot be coerced to boolean'))).toBe(true);
  });

  it('flags non-numeric string to number as invalid', () => {
    const data = makeDataMaster([{ name: 'amount', datatype: 'string', nullable: false }], [{ amount: 'abc' }]);
    const layout = makeLayoutMaster([v('amount', 'number')]);
    const mapping = makeMapping([{ column: 'amount', variableKey: 'amount' }]);

    const result = validateMapping(mapping, data, layout);

    expect(result.coercionPreview[0]!.error).toBe('Cannot coerce string to number: not numeric');
    expect(result.warnings.some((w) => w.includes('Cannot coerce string to number: not numeric'))).toBe(true);
  });

  it('allows number 0/1 to coerce to boolean', () => {
    const data = makeDataMaster([{ name: 'flag', datatype: 'number', nullable: false }], [{ flag: 1 }]);
    const layout = makeLayoutMaster([v('flag', 'boolean')]);
    const mapping = makeMapping([{ column: 'flag', variableKey: 'flag' }]);

    const result = validateMapping(mapping, data, layout);

    expect(result.coercionPreview[0]!.error).toBeUndefined();
    expect(result.warnings).toEqual([]);
  });
});
