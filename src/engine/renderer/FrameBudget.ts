/**
 * FrameBudget — lightweight frame-timing utility for the RAF render loop.
 *
 * Tracks per-frame render time and derives a rolling FPS counter that updates
 * once per second.  The 120 fps budget threshold (8 ms) is exposed as a
 * constant so callers can decide how to react to budget overruns.
 */

/** Frame-time budget for 120 fps in milliseconds. */
export const FRAME_BUDGET_MS = 8;

export interface FrameResult {
  /** Wall-clock time spent inside the render call, in milliseconds. */
  frameTime: number;
  /** Smoothed FPS value, updated once per second (0 until first update). */
  fps: number;
}

export class FrameBudget {
  private lastFrameTime = 0;
  private frameCount = 0;
  private readonly fpsUpdateInterval = 1000; // ms between FPS recalculations
  private lastFpsUpdate = 0;
  private currentFps = 0;

  /**
   * Call immediately before the render work starts.
   * Returns a timestamp that must be passed to `endFrame()`.
   */
  startFrame(): number {
    return performance.now();
  }

  /**
   * Call immediately after the render work ends.
   * Logs a console warning when the frame exceeds the 120 fps budget (8 ms).
   */
  endFrame(startTime: number): FrameResult {
    const frameTime = performance.now() - startTime;
    this.lastFrameTime = frameTime;
    this.frameCount++;

    const now = performance.now();
    if (now - this.lastFpsUpdate >= this.fpsUpdateInterval) {
      // Guard against division by zero on the very first interval
      const elapsed = now - this.lastFpsUpdate;
      this.currentFps = elapsed > 0
        ? Math.round(this.frameCount * 1000 / elapsed)
        : 0;
      this.frameCount = 0;
      this.lastFpsUpdate = now;
    }

    if (frameTime > FRAME_BUDGET_MS) {
      console.warn(`[FrameBudget] Frame over budget: ${frameTime.toFixed(1)} ms (budget ${FRAME_BUDGET_MS} ms)`);
    }

    return { frameTime, fps: this.currentFps };
  }

  /** Last measured frame time in milliseconds. */
  getLastFrameTime(): number {
    return this.lastFrameTime;
  }

  /** Current smoothed FPS (updates once per second). */
  getCurrentFps(): number {
    return this.currentFps;
  }
}
