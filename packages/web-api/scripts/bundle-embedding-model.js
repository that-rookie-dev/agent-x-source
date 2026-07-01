#!/usr/bin/env node
/**
 * Bundle embedding models into the web-api dist folder.
 *
 * Two models are bundled:
 *   1. BGE-M3 (INT8 ONNX, ~600 MB) — primary, 1024-dim, multilingual
 *   2. all-MiniLM-L6-v2 (q4 ONNX, ~55 MB) — lightweight fallback, 384-dim
 *
 * Both ship with the app so users do not need to download anything.
 * The OnnxEmbeddingProvider auto-selects which to load at runtime based
 * on available RAM.
 */
import { pipeline } from '@huggingface/transformers';
import { existsSync, mkdirSync, cpSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

const MODELS = [
  { id: 'Xenova/bge-m3', dtype: 'int8', subdir: 'bge-m3' },
  { id: 'Xenova/all-MiniLM-L6-v2', dtype: 'q4', subdir: 'all-MiniLM-L6-v2' },
];

const packageModelsDir = join(process.cwd(), 'models');
const distModelsDir = join(process.cwd(), 'dist', 'models');

async function bundleModel(model) {
  const sourceDir = join(packageModelsDir, model.id);
  const targetDir = join(distModelsDir, model.id);
  const onnxPath = join(sourceDir, 'onnx', `model_${model.dtype}.onnx`);

  if (!existsSync(onnxPath)) {
    console.log(`Downloading embedding model ${model.id} (${model.dtype})...`);
    await pipeline('feature-extraction', model.id, {
      dtype: model.dtype,
      revision: 'main',
      cache_dir: packageModelsDir,
      session_options: {
        intraOpNumThreads: 1,
        interOpNumThreads: 1,
        enableCpuMemArena: false,
        enableMemPattern: false,
      },
    });
  } else {
    console.log(`Embedding model ${model.id} already present.`);
  }

  if (!existsSync(onnxPath)) {
    throw new Error(`Embedding model ONNX file not found at ${onnxPath}`);
  }

  const size = statSync(onnxPath).size;
  console.log(`  ${model.id} ONNX size: ${(size / 1024 / 1024).toFixed(1)} MB`);

  rmSync(targetDir, { recursive: true, force: true });
  mkdirSync(targetDir, { recursive: true });
  cpSync(sourceDir, targetDir, { recursive: true, dereference: true });
  console.log(`  Bundled to ${targetDir}`);
}

async function main() {
  for (const model of MODELS) {
    await bundleModel(model);
  }
  console.log('All embedding models bundled.');
}

main().catch((e) => {
  console.error('Failed to bundle embedding models:', e);
  process.exit(1);
});
