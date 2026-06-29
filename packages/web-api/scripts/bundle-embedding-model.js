#!/usr/bin/env node
/**
 * Bundle the default embedding model (all-MiniLM-L6-v2) into the web-api dist folder.
 *
 * This model is small (~23 MB int8 / ~55 MB q4) and ships with the app so users do
 * not need to download it separately. It is used solely for embedding purposes.
 */
import { pipeline } from '@huggingface/transformers';
import { existsSync, mkdirSync, cpSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

const MODEL_ID = 'Xenova/all-MiniLM-L6-v2';
const DTYPE = 'q4';
const packageModelsDir = join(process.cwd(), 'models');
const distModelsDir = join(process.cwd(), 'dist', 'models');

async function main() {
  const sourceDir = join(packageModelsDir, MODEL_ID);
  const targetDir = join(distModelsDir, MODEL_ID);

  // Download the model if it is not already present
  const onnxPath = join(sourceDir, 'onnx', `model_${DTYPE}.onnx`);
  if (!existsSync(onnxPath)) {
    console.log(`Downloading embedding model ${MODEL_ID}...`);
    await pipeline('feature-extraction', MODEL_ID, {
      dtype: DTYPE,
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
    console.log(`Embedding model ${MODEL_ID} already present.`);
  }

  if (!existsSync(onnxPath)) {
    throw new Error(`Embedding model ONNX file not found at ${onnxPath}`);
  }

  const size = statSync(onnxPath).size;
  console.log(`Embedding model ONNX size: ${size} bytes`);

  // Clean and copy to dist
  rmSync(targetDir, { recursive: true, force: true });
  mkdirSync(targetDir, { recursive: true });
  cpSync(sourceDir, targetDir, { recursive: true, dereference: true });

  console.log(`Embedding model bundled to ${targetDir}`);
}

main().catch((e) => {
  console.error('Failed to bundle embedding model:', e);
  process.exit(1);
});
