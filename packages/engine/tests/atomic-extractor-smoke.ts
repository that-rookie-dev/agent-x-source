/**
 * Standalone smoke test for AtomicExtractor (no database required).
 * Run: pnpm -w exec tsx source/packages/engine/tests/atomic-extractor-smoke.ts
 */
import { AtomicExtractor } from '../src/neural/AtomicExtractor.js';

// Mock LLM that returns a deliberately hub-and-spoke structure:
// one root with 12 children (exceeds maxEdgesPerNode=7) to prove anti-centralization.
const mockGenerate = async (): Promise<string> => {
  const nodes = [{ id: 'root', label: 'Root', type: 'CoreTopic', content: 'root concept', depthLevel: 0, confidence: 0.9 }];
  const edges: any[] = [];
  for (let i = 0; i < 12; i++) {
    nodes.push({ id: `c${i}`, label: `Child ${i}`, type: 'Concept', content: `child ${i}`, depthLevel: 1, confidence: 0.8 });
    edges.push({ sourceNodeId: 'root', targetNodeId: `c${i}`, relationshipType: 'PARENT_OF', weight: 0.8 });
  }
  return JSON.stringify({ nodes, edges });
};

const mockEmbed = async (t: string) => Array.from({ length: 8 }, (_, i) => ((t.length + i) % 10) / 10);

async function main() {
  const text = `Machine learning is a subset of artificial intelligence that enables systems to
  learn from experience. Deep learning uses neural networks with multiple layers to process
  complex patterns in data, recognizing images and understanding natural language.`;

  const extractor = new AtomicExtractor({
    clusterId: 'smoke-cluster',
    sourceId: 'smoke-source',
    maxEdgesPerNode: 7,
    minDepthTiers: 4,
    granularity: 'atomic',
    generate: mockGenerate,
    embed: mockEmbed,
  });

  const result = await extractor.extract(text);

  let pass = true;
  const assert = (cond: boolean, msg: string) => {
    console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`);
    if (!cond) pass = false;
  };

  console.log('--- AtomicExtractor smoke test ---');
  console.log('nodes:', result.nodes.length, 'edges:', result.edges.length);
  console.log('topology:', JSON.stringify(result.topology));
  console.log('analysis:', JSON.stringify(result.analysis));

  assert(result.nodes.length > 13, 'anti-centralization spawned relay node(s) beyond original 13');
  assert(result.topology.maxEdgesPerNode <= 7, 'no node exceeds maxEdgesPerNode (7)');
  assert(result.topology.totalNodes === result.nodes.length, 'topology.totalNodes matches node count');
  assert(result.topology.maxDepth >= 2, 'relay rerouting created depth >= 2');
  assert(result.analysis !== undefined && result.analysis.extractionRatio > 0, 'analysis reports a real extraction ratio');
  assert(result.nodes.every(n => n.sessionId === 'smoke-cluster'), 'all nodes tagged with clusterId');
  assert(result.nodes.every(n => Array.isArray(n.embedding)), 'all nodes got embeddings');

  console.log(pass ? '\nALL CHECKS PASSED' : '\nSOME CHECKS FAILED');
  process.exit(pass ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
