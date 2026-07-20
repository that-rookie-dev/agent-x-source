/**
 * Cortex camera — pan / zoom-to-cursor / inertia / fit / fly-to.
 *
 * Pure math over a {x, y, scale} view transform; the renderer applies it to
 * the Pixi world container every frame. No physics library — motion comes
 * from critically-damped exponential easing, which cannot overshoot or jitter.
 */

export interface CameraState {
  /** World coordinate at the screen center. */
  x: number;
  y: number;
  /** Screen pixels per world unit. */
  scale: number;
}

const MIN_SCALE = 0.02;
const MAX_SCALE = 40;

export class Camera {
  /** Current (rendered) state. */
  x = 0;
  y = 0;
  scale = 1;

  /** Target state — the render state eases toward this. */
  private tx = 0;
  private ty = 0;
  private tscale = 1;

  /** Pan inertia velocity (world units / s). */
  private vx = 0;
  private vy = 0;

  screenWidth = 1;
  screenHeight = 1;

  resize(width: number, height: number): void {
    this.screenWidth = Math.max(1, width);
    this.screenHeight = Math.max(1, height);
  }

  screenToWorld(sx: number, sy: number): { x: number; y: number } {
    return {
      x: this.x + (sx - this.screenWidth / 2) / this.scale,
      y: this.y + (sy - this.screenHeight / 2) / this.scale,
    };
  }

  worldToScreen(wx: number, wy: number): { x: number; y: number } {
    return {
      x: (wx - this.x) * this.scale + this.screenWidth / 2,
      y: (wy - this.y) * this.scale + this.screenHeight / 2,
    };
  }

  /** Visible world-space rectangle (with optional margin factor). */
  visibleBounds(margin = 0): { xmin: number; xmax: number; ymin: number; ymax: number } {
    const halfW = (this.screenWidth / 2 / this.scale) * (1 + margin);
    const halfH = (this.screenHeight / 2 / this.scale) * (1 + margin);
    return { xmin: this.x - halfW, xmax: this.x + halfW, ymin: this.y - halfH, ymax: this.y + halfH };
  }

  /** Immediate pan by screen-pixel delta (during drag). */
  panBy(dxScreen: number, dyScreen: number): void {
    const dx = -dxScreen / this.scale;
    const dy = -dyScreen / this.scale;
    this.x += dx; this.y += dy;
    this.tx = this.x; this.ty = this.y;
  }

  /** Record drag velocity so releasing the pointer glides. */
  setPanVelocity(vxScreen: number, vyScreen: number): void {
    this.vx = -vxScreen / this.scale;
    this.vy = -vyScreen / this.scale;
  }

  stop(): void {
    this.vx = 0; this.vy = 0;
    this.tx = this.x; this.ty = this.y; this.tscale = this.scale;
  }

  /** Zoom toward a screen point (wheel / pinch). */
  zoomAt(sx: number, sy: number, factor: number): void {
    const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, this.tscale * factor));
    const anchor = this.screenToWorld(sx, sy);
    // Keep the world point under the cursor stationary at the target scale.
    const ratio = this.tscale / next;
    this.tx = anchor.x + (this.tx - anchor.x) * ratio;
    this.ty = anchor.y + (this.ty - anchor.y) * ratio;
    this.tscale = next;
    this.vx = 0; this.vy = 0;
  }

  zoomCentered(factor: number): void {
    this.zoomAt(this.screenWidth / 2, this.screenHeight / 2, factor);
  }

  /** Ease camera to frame a world-space bounding box. */
  fitBounds(xmin: number, ymin: number, xmax: number, ymax: number, padding = 0.15): void {
    const w = Math.max(1e-3, xmax - xmin);
    const h = Math.max(1e-3, ymax - ymin);
    const scale = Math.min(
      MAX_SCALE,
      Math.max(MIN_SCALE, Math.min(this.screenWidth / (w * (1 + padding * 2)), this.screenHeight / (h * (1 + padding * 2)))),
    );
    this.tx = (xmin + xmax) / 2;
    this.ty = (ymin + ymax) / 2;
    this.tscale = scale;
    this.vx = 0; this.vy = 0;
  }

  /** Fly to a world point at a given scale (search result, node hop). */
  flyTo(wx: number, wy: number, scale?: number): void {
    this.tx = wx;
    this.ty = wy;
    if (scale != null) this.tscale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
    this.vx = 0; this.vy = 0;
  }

  /**
   * Advance easing + inertia. Returns true while the camera is still moving
   * (renderer uses this to know when viewport refetches can fire).
   */
  update(dtSeconds: number): boolean {
    const dt = Math.min(dtSeconds, 0.05);

    // Inertia glide with exponential friction.
    if (Math.abs(this.vx) > 0.01 || Math.abs(this.vy) > 0.01) {
      this.tx += this.vx * dt;
      this.ty += this.vy * dt;
      const friction = Math.exp(-4.2 * dt);
      this.vx *= friction;
      this.vy *= friction;
    } else {
      this.vx = 0; this.vy = 0;
    }

    // Critically-damped approach to target (frame-rate independent).
    const k = 1 - Math.exp(-10 * dt);
    this.x += (this.tx - this.x) * k;
    this.y += (this.ty - this.y) * k;
    this.scale += (this.tscale - this.scale) * k;

    const moving =
      Math.abs(this.tx - this.x) * this.scale > 0.1 ||
      Math.abs(this.ty - this.y) * this.scale > 0.1 ||
      Math.abs(this.tscale - this.scale) / this.scale > 0.001 ||
      this.vx !== 0 || this.vy !== 0;

    if (!moving) {
      this.x = this.tx; this.y = this.ty; this.scale = this.tscale;
    }
    return moving;
  }
}
