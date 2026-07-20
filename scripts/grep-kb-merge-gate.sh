#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

PATTERN='KnowledgeBaseManager|knowledge_search|memory_fabric|neuralBrain|/api/knowledge[^-]|knowledge_source_|embedding-models|web-neuron|CommunitySummarizer|NeuralBrainIngestionPipeline'

if rg -i "$PATTERN" packages \
  --glob '!**/desktop/release/**' \
  --glob '!**/*.md' \
  --glob '!**/node_modules/**' \
  --glob '!**/migration-registry.ts' \
  --glob '!**/MemoryMigrationRunner.ts' \
  --glob '!**/migrations/**'; then
  echo "KB merge grep gate failed: legacy symbols found (see above)." >&2
  exit 1
fi

echo "KB merge grep gate passed."
