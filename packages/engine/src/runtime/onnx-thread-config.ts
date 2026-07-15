import { cpus } from 'node:os';

function getEnvInt(name: string): number | null {
  const env = process.env[name] ?? process.env[`AGENTX_${name}`];
  if (env) {
    const parsed = Number(env);
    if (Number.isFinite(parsed) && parsed >= 1) return parsed;
  }
  return null;
}

function defaultIntra(): number {
  const parsed = getEnvInt('ONNX_THREADS');
  if (parsed !== null) return Math.min(4, parsed);
  return Math.min(4, Math.max(1, cpus().length));
}

function defaultInter(): number {
  const parsed = getEnvInt('ONNX_INTER_OP_THREADS');
  if (parsed !== null) return Math.min(2, parsed);
  return Math.min(2, Math.max(1, cpus().length));
}

let intraOpNumThreads = defaultIntra();
let interOpNumThreads = defaultInter();
let ortEnvAttempted = false;

function trySetOrtEnv(intra: number, inter: number): void {
  if (ortEnvAttempted) return;
  ortEnvAttempted = true;
  // onnxruntime-node is optional; skip silently if it is not installed.
  try {
    (Function('return import("onnxruntime-node")')() as Promise<unknown>)
      .then((mod: any) => {
        if (mod?.env) {
          mod.env.threadCount = intra;
          mod.env.intraOpThreadCount = intra;
          mod.env.interOpThreadCount = inter;
        }
      })
      .catch(() => {
        // ignore — provider will use session_options instead
      });
  } catch {
    // ignore
  }
}

export function setOnnxThreadConfig(intra: number, inter: number): void {
  intraOpNumThreads = Math.max(1, Math.min(4, intra));
  interOpNumThreads = Math.max(1, Math.min(2, inter));
  trySetOrtEnv(intraOpNumThreads, interOpNumThreads);
}

export function getOnnxThreadConfig(): { intraOpNumThreads: number; interOpNumThreads: number } {
  return { intraOpNumThreads, interOpNumThreads };
}
