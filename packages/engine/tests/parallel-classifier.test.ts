import { describe, it, expect } from 'vitest';
import { ParallelClassifier } from '../src/tools/ParallelClassifier.js';

describe('ParallelClassifier', () => {
  const classifier = new ParallelClassifier();

  const makeTool = (name: string, filePath?: string, filepath?: string) => ({
    toolCallId: `tc-${name}`,
    tool: {
      id: name,
      name,
      description: '',
      modelDescription: '',
      category: 'filesystem' as const,
      riskLevel: 'low' as const,
      schema: { type: 'object' as const, properties: {} },
      composable: false,
      source: 'builtin' as const,
    },
    args: { filePath, filepath } as Record<string, unknown>,
  });

  it('classifies read/search tools as SAFE', () => {
    const result = classifier.classify([
      makeTool('file_read', 'src/a.ts'),
      makeTool('grep', 'src/'),
    ]);

    expect(result.parallel).toHaveLength(2);
    expect(result.sequential).toHaveLength(0);
  });

  it('classifies write/edit tools as PATH_SCOPED', () => {
    const result = classifier.classify([
      makeTool('file_write', 'src/a.ts'),
      makeTool('file_write', 'src/b.ts'),
    ]);

    expect(result.parallel).toHaveLength(2);
  });

  it('detects path overlap for PATH_SCOPED tools', () => {
    const result = classifier.classify([
      makeTool('file_write', 'src/components'),
      makeTool('file_write', 'src/components/Button.tsx'),
    ]);

    // Path "src/components" overlaps "src/components/Button.tsx"
    expect(result.sequential.length).toBeGreaterThanOrEqual(1);
  });

  it('classifies question/clarify tools as NEVER parallel', () => {
    const result = classifier.classify([
      makeTool('ask_clarification'),
      makeTool('file_read', 'test.ts'),
    ]);

    expect(result.sequential).toContainEqual(
      expect.objectContaining({ tool: expect.objectContaining({ name: 'ask_clarification' }) }),
    );
  });

  it('classifies folder_list and cortex_memory_search as SAFE', () => {
    const result = classifier.classify([
      makeTool('folder_list'),
      makeTool('cortex_memory_search'),
      makeTool('http_get'),
    ]);

    expect(result.parallel).toHaveLength(3);
    expect(result.sequential).toHaveLength(0);
  });
});
