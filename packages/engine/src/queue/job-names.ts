export const JOB_NAMES = {
  TOOL_EXEC: 'tool.exec',
  RAG_INGEST: 'rag.ingest',
  MEMORY_EXTRACT: 'memory.extract',
  SHELL_EXEC: 'shell.exec',
} as const;

export type JobName = (typeof JOB_NAMES)[keyof typeof JOB_NAMES];
