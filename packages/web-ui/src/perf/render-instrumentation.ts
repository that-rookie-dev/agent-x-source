export interface RenderPerfSnapshot {
  framesObserved: number;
  longFrames: number;
  maxFrameMs: number;
  avgFrameMs: number;
  eventsDelivered: number;
  eventsCoalesced: number;
  commitsScheduled: number;
}

const perfState: RenderPerfSnapshot = {
  framesObserved: 0,
  longFrames: 0,
  maxFrameMs: 0,
  avgFrameMs: 0,
  eventsDelivered: 0,
  eventsCoalesced: 0,
  commitsScheduled: 0,
};

let frameLoopStarted = false;
let lastFrameTs = 0;

function recordFrame(deltaMs: number): void {
  perfState.framesObserved += 1;
  if (deltaMs > 16.7) perfState.longFrames += 1;
  if (deltaMs > perfState.maxFrameMs) perfState.maxFrameMs = deltaMs;
  const n = perfState.framesObserved;
  perfState.avgFrameMs = perfState.avgFrameMs + (deltaMs - perfState.avgFrameMs) / n;
}

export function ensureRenderInstrumentation(): void {
  if (frameLoopStarted || typeof window === 'undefined') return;
  frameLoopStarted = true;
  lastFrameTs = performance.now();
  const tick = (now: number) => {
    recordFrame(now - lastFrameTs);
    lastFrameTs = now;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

export function recordTelemetryDelivered(count = 1): void {
  perfState.eventsDelivered += count;
}

export function recordTelemetryCoalesced(count = 1): void {
  perfState.eventsCoalesced += count;
}

export function recordRenderCommit(): void {
  perfState.commitsScheduled += 1;
}

export function getRenderPerfSnapshot(): RenderPerfSnapshot {
  return { ...perfState };
}

export function resetRenderPerfSnapshot(): void {
  perfState.framesObserved = 0;
  perfState.longFrames = 0;
  perfState.maxFrameMs = 0;
  perfState.avgFrameMs = 0;
  perfState.eventsDelivered = 0;
  perfState.eventsCoalesced = 0;
  perfState.commitsScheduled = 0;
}
