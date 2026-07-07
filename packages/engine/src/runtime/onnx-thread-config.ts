let intraOpNumThreads = 1;
let interOpNumThreads = 1;

export function setOnnxThreadConfig(intra: number, inter: number): void {
  intraOpNumThreads = Math.max(1, Math.min(4, intra));
  interOpNumThreads = Math.max(1, Math.min(2, inter));
}

export function getOnnxThreadConfig(): { intraOpNumThreads: number; interOpNumThreads: number } {
  return { intraOpNumThreads, interOpNumThreads };
}
